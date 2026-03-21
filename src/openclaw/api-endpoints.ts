// OpenClaw REST API endpoint handlers
// Routes: POST /openclaw/analyze, POST /openclaw/tune,
//         GET  /openclaw/report, GET /openclaw/status, GET /openclaw/history

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiRouter } from './ai-router.js';
import { loadOpenClawConfig } from './openclaw-config.js';
import { isAutoTuningEnabled, setAutoTuningEnabled } from './auto-tuning-job.js';
import { checkOllamaHealth, autoSelectModels } from './ollama-health-check.js';
import { recordAiCall, getAiUsage, canMakeAiCall, getAllAiUsage } from './ai-usage-meter.js';
import type { Tier } from '../users/subscription-tier.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TuningDecision {
  timestamp: number;
  strategy: string;
  mode: string;
  suggestion: string;
  model: string;
}

export interface OpenClawDeps {
  controller?: AiRouter;
  observer?: { active: boolean; startedAt?: number };
  tuner?: AiRouter;
  history: TuningDecision[];
  /** Optional: tuning history for audit trail endpoint */
  tuningHistory?: { getAll(): unknown[]; getEffectivenessReport(): unknown };
  /** Optional: tuning executor for rollback endpoint */
  tuningExecutor?: { rollback(strategy: string): boolean };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, { error: message });
}

async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

interface AuthedIncoming extends IncomingMessage {
  user?: { id: string; email: string; tier: Tier };
}

/** Check AI quota before processing. Returns false (sends 429) if exceeded. */
function checkAiQuota(req: AuthedIncoming, res: ServerResponse): boolean {
  const user = req.user;
  if (!user) return true; // unauthenticated — let auth middleware handle
  const quota = canMakeAiCall(user.id, user.tier);
  if (!quota.allowed) {
    sendJson(res, 429, {
      error: 'AI quota exceeded',
      message: `Your "${user.tier}" plan allows ${quota.limit} AI calls/month. Upgrade for more.`,
      limit: quota.limit,
      remaining: 0,
      upgradeUrl: 'https://cashclaw.cc/pricing',
    });
    return false;
  }
  return true;
}

/** Record an AI call after successful response */
function trackAiCall(req: AuthedIncoming, tokens: number): void {
  if (req.user) recordAiCall(req.user.id, tokens);
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/** POST /openclaw/analyze — trigger AI analysis, return insights JSON */
async function handleAnalyze(_req: IncomingMessage, res: ServerResponse, deps: OpenClawDeps): Promise<void> {
  const router = deps.controller ?? new AiRouter();
  try {
    const r = await router.chat({
      prompt: 'Analyze recent algorithmic trading activity. Identify performance trends, risk signals, and actionable insights.',
      systemPrompt: 'You are an expert algorithmic trading analyst. Return structured, concise insights.',
      complexity: 'complex',
      maxTokens: 512,
    });
    sendJson(res, 200, { ok: true, insights: r.content, model: r.model, tokensUsed: r.tokensUsed, latencyMs: r.latencyMs, timestamp: Date.now() });
  } catch (err) {
    sendError(res, 502, `AI analysis failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** POST /openclaw/tune — trigger AI tuning for strategy { name, mode } */
async function handleTune(req: IncomingMessage, res: ServerResponse, deps: OpenClawDeps): Promise<void> {
  let body: { name?: string; mode?: string };
  try {
    body = await readJsonBody<{ name?: string; mode?: string }>(req);
  } catch {
    sendError(res, 400, 'Invalid JSON body');
    return;
  }

  const { name, mode = 'manual' } = body;
  if (!name || typeof name !== 'string') {
    sendError(res, 400, 'Missing required field: name (strategy name)');
    return;
  }

  const router = deps.tuner ?? deps.controller ?? new AiRouter();
  try {
    const r = await router.chat({
      prompt: `Provide parameter tuning for the "${name}" strategy. Mode: ${mode}. Include entry/exit thresholds, position sizing, and stop-loss levels.`,
      systemPrompt: 'You are a quant trading specialist. Be specific with numeric values.',
      complexity: 'complex',
      maxTokens: 600,
    });
    const decision: TuningDecision = { timestamp: Date.now(), strategy: name, mode, suggestion: r.content, model: r.model };
    deps.history.push(decision);
    sendJson(res, 200, { ok: true, strategy: name, mode, suggestions: r.content, model: r.model, tokensUsed: r.tokensUsed, latencyMs: r.latencyMs, timestamp: decision.timestamp });
  } catch (err) {
    sendError(res, 502, `AI tuning failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** GET /openclaw/report?period=daily — get AI performance report */
async function handleReport(req: IncomingMessage, res: ServerResponse, deps: OpenClawDeps): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const period = url.searchParams.get('period') ?? 'daily';
  if (period !== 'daily' && period !== 'weekly') {
    sendError(res, 400, 'Invalid period. Use: daily or weekly');
    return;
  }

  const router = deps.controller ?? new AiRouter();
  try {
    const r = await router.chat({
      prompt: `Generate a ${period} trading performance report with trade count, P&L summary, win rate, best/worst strategies, and recommendations.`,
      systemPrompt: 'You are a trading performance analyst. Structure the report with clear sections.',
      complexity: 'standard',
      maxTokens: 800,
    });
    sendJson(res, 200, { ok: true, period, report: r.content, model: r.model, tokensUsed: r.tokensUsed, latencyMs: r.latencyMs, timestamp: Date.now() });
  } catch (err) {
    sendError(res, 502, `Report generation failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** GET /openclaw/status — OpenClaw health and configuration stats */
function handleStatus(_req: IncomingMessage, res: ServerResponse, deps: OpenClawDeps): void {
  const config = loadOpenClawConfig();
  sendJson(res, 200, {
    ok: true,
    gateway: { url: config.gatewayUrl, authenticated: !!config.apiKey, timeoutMs: config.timeout },
    routing: config.routing,
    observer: deps.observer ?? { active: false },
    historyCount: deps.history.length,
    timestamp: Date.now(),
  });
}

/** GET /openclaw/history — tuning decision history (last 50, newest first) */
function handleHistory(_req: IncomingMessage, res: ServerResponse, deps: OpenClawDeps): void {
  const entries = deps.history.slice(-50).reverse();
  sendJson(res, 200, { ok: true, count: entries.length, decisions: entries });
}

// ─── Main router ──────────────────────────────────────────────────────────────

/** Route /openclaw/* requests to the appropriate handler */
export async function handleOpenClawRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: OpenClawDeps,
  pathname: string,
): Promise<void> {
  const method = req.method ?? 'GET';

  const authedReq = req as AuthedIncoming;

  if (pathname === '/openclaw/analyze') {
    if (method !== 'POST') { sendError(res, 405, 'Method Not Allowed'); return; }
    if (!checkAiQuota(authedReq, res)) return;
    await handleAnalyze(req, res, deps);
    trackAiCall(authedReq, 512);
    return;
  }
  if (pathname === '/openclaw/tune') {
    if (method !== 'POST') { sendError(res, 405, 'Method Not Allowed'); return; }
    if (!checkAiQuota(authedReq, res)) return;
    await handleTune(req, res, deps);
    trackAiCall(authedReq, 600);
    return;
  }
  if (pathname === '/openclaw/report') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    if (!checkAiQuota(authedReq, res)) return;
    await handleReport(req, res, deps);
    trackAiCall(authedReq, 800);
    return;
  }
  if (pathname === '/openclaw/usage') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    if (authedReq.user) {
      const usage = getAiUsage(authedReq.user.id);
      const quota = canMakeAiCall(authedReq.user.id, authedReq.user.tier);
      sendJson(res, 200, { ok: true, usage, quota });
    } else {
      // Admin view: all usage
      sendJson(res, 200, { ok: true, allUsage: getAllAiUsage() });
    }
    return;
  }
  if (pathname === '/openclaw/status') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    handleStatus(req, res, deps);
    return;
  }
  if (pathname === '/openclaw/history') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    handleHistory(req, res, deps);
    return;
  }
  if (pathname === '/openclaw/auto-tune') {
    if (method === 'GET') {
      sendJson(res, 200, { ok: true, enabled: isAutoTuningEnabled() });
      return;
    }
    if (method === 'POST') {
      let body: { enabled?: boolean };
      try { body = await readJsonBody<{ enabled?: boolean }>(req); }
      catch { sendError(res, 400, 'Invalid JSON body'); return; }
      if (typeof body.enabled !== 'boolean') {
        sendError(res, 400, 'Missing required field: enabled (boolean)');
        return;
      }
      setAutoTuningEnabled(body.enabled);
      sendJson(res, 200, { ok: true, enabled: body.enabled });
      return;
    }
    sendError(res, 405, 'Method Not Allowed');
    return;
  }

  if (pathname === '/openclaw/tuning-history') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    if (!deps.tuningHistory) { sendError(res, 503, 'Tuning history not configured'); return; }
    sendJson(res, 200, {
      ok: true,
      records: deps.tuningHistory.getAll(),
      effectiveness: deps.tuningHistory.getEffectivenessReport(),
    });
    return;
  }
  if (pathname === '/openclaw/rollback') {
    if (method !== 'POST') { sendError(res, 405, 'Method Not Allowed'); return; }
    if (!deps.tuningExecutor) { sendError(res, 503, 'Tuning executor not configured'); return; }
    let body: { strategy?: string };
    try { body = await readJsonBody<{ strategy?: string }>(req); }
    catch { sendError(res, 400, 'Invalid JSON body'); return; }
    if (!body.strategy) { sendError(res, 400, 'Missing required field: strategy'); return; }
    const success = deps.tuningExecutor.rollback(body.strategy);
    sendJson(res, success ? 200 : 404, { ok: success, strategy: body.strategy, message: success ? 'Rolled back' : 'No snapshot available' });
    return;
  }

  if (pathname === '/openclaw/ollama-health') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    const config = loadOpenClawConfig();
    const ollamaUrl = config.gatewayUrl.replace('/v1', '');
    const health = await checkOllamaHealth(ollamaUrl);
    const recommended = health.healthy ? autoSelectModels(health.models) : null;
    sendJson(res, health.healthy ? 200 : 503, { ok: health.healthy, ...health, recommendedModels: recommended });
    return;
  }

  sendError(res, 404, 'Not Found');
}
