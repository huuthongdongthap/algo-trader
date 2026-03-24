#!/usr/bin/env node
// Lightweight stats API server for M1 Max — serves real data to cashclaw.cc dashboard
// Endpoints: /api/health, /api/stats, /api/signals, /api/trades, /api/system
// Usage: node scripts/stats-server.mjs [port] [db-path]

import { createServer } from 'node:http';
import { execSync } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';

const PORT = parseInt(process.argv[2] || '3000', 10);
const DB_PATH = process.argv[3] || 'data/algo-trade.db';
const LLM_URL = process.env.LLM_URL || 'http://localhost:11435';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cashclaw-admin-2026';
const LICENSE_SECRET = process.env.LICENSE_SECRET || 'change-me-in-production';

let db;
async function getDb() {
  if (db) return db;
  const Database = (await import('better-sqlite3')).default;
  db = new Database(DB_PATH, { readonly: true });
  return db;
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  });
  res.end(JSON.stringify(data));
}

// System metrics
function getSystemStats() {
  try {
    const uptime = parseFloat(execSync('sysctl -n kern.boottime', { encoding: 'utf8' }).match(/sec = (\d+)/)?.[1] || '0');
    const uptimeDays = ((Date.now() / 1000 - uptime) / 86400).toFixed(1);
    const memPressure = execSync('memory_pressure 2>/dev/null | head -1', { encoding: 'utf8', timeout: 3000 }).trim();
    const cpuBrand = execSync('sysctl -n machdep.cpu.brand_string', { encoding: 'utf8' }).trim();
    const memSize = parseInt(execSync('sysctl -n hw.memsize', { encoding: 'utf8' })) / (1024 ** 3);
    return {
      chip: cpuBrand,
      ram: `${memSize.toFixed(0)}GB`,
      uptime: `${uptimeDays} days`,
      memPressure: memPressure || 'normal',
      os: execSync('sw_vers -productVersion', { encoding: 'utf8' }).trim(),
    };
  } catch {
    return { chip: 'Unknown', ram: 'Unknown', uptime: 'Unknown', memPressure: 'Unknown', os: 'Unknown' };
  }
}

// LLM status
async function getLlmStatus() {
  try {
    const res = await fetch(`${LLM_URL}/v1/models`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { status: 'error', models: [] };
    const data = await res.json();
    const models = data.data?.map(m => m.id) || [];
    return { status: 'online', models, url: LLM_URL };
  } catch {
    return { status: 'offline', models: [], url: LLM_URL };
  }
}

// Trade stats from paper_trades_v3
async function getTradeStats() {
  try {
    const d = await getDb();
    const total = d.prepare('SELECT COUNT(*) as c FROM paper_trades_v3').get();
    const actionable = d.prepare("SELECT COUNT(*) as c FROM paper_trades_v3 WHERE direction != 'SKIP'").get();
    const resolved = d.prepare('SELECT COUNT(*) as c FROM paper_trades_v3 WHERE resolved = 1').get();
    const correct = d.prepare('SELECT COUNT(*) as c FROM paper_trades_v3 WHERE correct = 1').get();
    const avgEdge = d.prepare("SELECT AVG(ABS(edge)) as e FROM paper_trades_v3 WHERE direction != 'SKIP'").get();

    // Batch breakdown
    const batches = d.prepare(`
      SELECT
        CASE WHEN strategy = 'blind_event_only' AND condition_id != '' THEN 'batch2+3' ELSE 'batch1' END as batch,
        COUNT(*) as total,
        SUM(CASE WHEN direction != 'SKIP' THEN 1 ELSE 0 END) as actionable,
        AVG(CASE WHEN direction != 'SKIP' THEN ABS(edge) ELSE NULL END) as avgEdge
      FROM paper_trades_v3
      GROUP BY batch
    `).all();

    const accuracy = resolved.c > 0 ? (correct.c / resolved.c) : null;

    return {
      totalTrades: total.c,
      actionable: actionable.c,
      resolved: resolved.c,
      correct: correct.c,
      accuracy: accuracy !== null ? `${(accuracy * 100).toFixed(1)}%` : 'pending',
      avgEdge: `${((avgEdge.e || 0) * 100).toFixed(1)}%`,
      batches,
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Recent signals (latest 20 actionable trades)
async function getSignals() {
  try {
    const d = await getDb();
    return d.prepare(`
      SELECT id, timestamp, market_question as description, market_prob as marketProb,
             our_prob as ourProb, edge, direction, confidence, reasoning, category,
             condition_id as conditionId, slug
      FROM paper_trades_v3
      WHERE direction != 'SKIP'
      ORDER BY id DESC LIMIT 20
    `).all();
  } catch { return []; }
}

// All trades
async function getTrades() {
  try {
    const d = await getDb();
    return d.prepare(`
      SELECT id, timestamp, market_question as description, market_prob as marketProb,
             our_prob as ourProb, edge, direction, confidence, resolved, outcome, correct,
             condition_id as conditionId
      FROM paper_trades_v3
      ORDER BY id DESC LIMIT 100
    `).all();
  } catch { return []; }
}

// Resolution status
async function getResolutions() {
  try {
    const d = await getDb();
    const resolved = d.prepare('SELECT * FROM paper_trades_v3 WHERE resolved = 1').all();
    const pending = d.prepare("SELECT COUNT(*) as c FROM paper_trades_v3 WHERE resolved = 0 AND direction != 'SKIP'").get();

    let totalBrier = 0, totalPnl = 0;
    for (const t of resolved) {
      const actual = t.outcome === 'YES' ? 1 : 0;
      totalBrier += (t.our_prob - actual) ** 2;
      const dir = t.direction.toUpperCase();
      if (dir.includes('YES')) totalPnl += (t.outcome === 'YES' ? 10 : 0) - (10 * t.market_prob);
      else if (dir.includes('NO')) totalPnl += (t.outcome === 'NO' ? 10 : 0) - (10 * (1 - t.market_prob));
    }

    return {
      resolved: resolved.length,
      pending: pending.c,
      correct: resolved.filter(r => r.correct === 1).length,
      accuracy: resolved.length > 0 ? `${(resolved.filter(r => r.correct === 1).length / resolved.length * 100).toFixed(1)}%` : 'N/A',
      brierScore: resolved.length > 0 ? (totalBrier / resolved.length).toFixed(4) : 'N/A',
      simulatedPnl: `$${totalPnl.toFixed(2)}`,
    };
  } catch { return {}; }
}

// ── License helpers ──
function toBase64Url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return Buffer.from(pad === 0 ? padded : padded + '='.repeat(4 - pad), 'base64');
}

function validateLicenseKey(key, secret) {
  const dotIdx = key.lastIndexOf('.');
  if (dotIdx === -1) return { valid: false, error: 'Malformed key' };
  const payloadPart = key.slice(0, dotIdx);
  const sigPart = key.slice(dotIdx + 1);
  const expected = toBase64Url(createHmac('sha256', secret).update(payloadPart).digest());
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(sigPart, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, error: 'Invalid signature' };
  const payload = JSON.parse(fromBase64Url(payloadPart).toString('utf8'));
  if (Date.now() > payload.expiresAt) return { valid: false, error: 'License expired', payload };
  const daysLeft = Math.floor((payload.expiresAt - Date.now()) / 86400000);
  return { valid: true, tier: payload.tier, features: payload.features, remainingDays: daysLeft, expiresAt: new Date(payload.expiresAt).toISOString() };
}

function generateLicenseKey(userId, tier, days, secret) {
  const TIERS = { free: { max: 1, trades: 5, feat: [] }, pro: { max: 10, trades: -1, feat: ['backtesting','multi-market'] }, enterprise: { max: -1, trades: -1, feat: ['backtesting','optimizer','webhook','multi-market'] } };
  const t = TIERS[tier] || TIERS.pro;
  const now = Date.now();
  const payload = { userId, tier, features: t.feat, maxMarkets: t.max, maxTradesPerDay: t.trades, issuedAt: now, expiresAt: now + days * 86400000 };
  const pp = toBase64Url(JSON.stringify(payload));
  const sig = toBase64Url(createHmac('sha256', secret).update(pp).digest());
  return { key: `${pp}.${sig}`, userId, tier, days, expiresAt: new Date(payload.expiresAt).toISOString(), maxMarkets: t.max, maxTradesPerDay: t.trades };
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => { try { resolve(JSON.parse(data)); } catch { reject(); } });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, 200, {}); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (path === '/' || path === '') {
    res.writeHead(302, { 'Location': 'https://cashclaw.cc/dashboard' });
    res.end();
    return;
  }

  if (path === '/api/health') {
    json(res, 200, { status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
  } else if (path === '/api/stats') {
    const [system, llm, trades, resolutions] = await Promise.all([
      getSystemStats(), getLlmStatus(), getTradeStats(), getResolutions(),
    ]);
    json(res, 200, { system, llm, trades, resolutions, timestamp: new Date().toISOString() });
  } else if (path === '/api/system') {
    json(res, 200, await getSystemStats());
  } else if (path === '/api/signals') {
    json(res, 200, await getSignals());
  } else if (path === '/api/trades') {
    json(res, 200, await getTrades());
  } else if (path === '/api/resolutions') {
    json(res, 200, await getResolutions());
  // ── License validation (public) ──
  } else if (path === '/api/license/validate' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const key = body.key;
      if (!key) { json(res, 400, { error: 'Missing key' }); return; }
      const result = validateLicenseKey(key, LICENSE_SECRET);
      json(res, 200, result);
    } catch { json(res, 400, { error: 'Invalid request' }); }

  // ── Admin endpoints (password protected) ──
  } else if (path.startsWith('/api/admin/')) {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace('Bearer ', '');
    if (token !== ADMIN_PASSWORD) {
      json(res, 401, { error: 'Unauthorized — set admin password in Settings' });
      return;
    }

    if (path === '/api/admin/license/issue' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const userId = body.userId || `customer_${Date.now()}`;
        const tier = body.tier || 'pro';
        const days = parseInt(body.days || '30', 10);
        const key = generateLicenseKey(userId, tier, days, LICENSE_SECRET);
        json(res, 201, key);
      } catch { json(res, 400, { error: 'Invalid request' }); }

    } else if (path === '/api/admin/licenses' && req.method === 'GET') {
      json(res, 200, { licenses: [], count: 0, note: 'License DB not connected to stats server. Use CLI: node scripts/generate-license.mjs' });

    } else {
      json(res, 404, { error: 'Admin endpoint not found' });
    }

  } else {
    json(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n📊 AlgoTrade Stats Server`);
  console.log(`   Port: ${PORT}`);
  console.log(`   DB:   ${DB_PATH}`);
  console.log(`   LLM:  ${LLM_URL}`);
  console.log(`\n   Endpoints:`);
  console.log(`   GET /api/health       — health check`);
  console.log(`   GET /api/stats        — all stats (system + trades + resolutions)`);
  console.log(`   GET /api/signals      — latest 20 actionable signals`);
  console.log(`   GET /api/trades       — last 100 trades`);
  console.log(`   GET /api/resolutions  — resolution status + accuracy`);
  console.log(`\n   Dashboard: https://cashclaw.cc/dashboard`);
  console.log(`   Set Bot API URL to: http://YOUR_IP:${PORT}\n`);
});
