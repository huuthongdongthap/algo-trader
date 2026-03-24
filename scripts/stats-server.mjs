#!/usr/bin/env node
// Lightweight stats API server for M1 Max — serves real data to cashclaw.cc dashboard
// Endpoints: /api/health, /api/stats, /api/signals, /api/trades, /api/system
// Usage: node scripts/stats-server.mjs [port] [db-path]

import { createServer } from 'node:http';
import { execSync } from 'node:child_process';

const PORT = parseInt(process.argv[2] || '3000', 10);
const DB_PATH = process.argv[3] || 'data/algo-trade.db';
const LLM_URL = process.env.LLM_URL || 'http://localhost:11435';

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
