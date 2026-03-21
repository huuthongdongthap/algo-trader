// OpenClaw REST API endpoint handlers
// Routes: POST /openclaw/analyze, POST /openclaw/tune,
//         GET  /openclaw/report, GET /openclaw/status, GET /openclaw/history

import type { IncomingMessage, ServerResponse } from 'node:http';
import { AiRouter } from './ai-router.js';
import { loadOpenClawConfig } from './openclaw-config.js';

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

  if (pathname === '/openclaw/analyze') {
    if (method !== 'POST') { sendError(res, 405, 'Method Not Allowed'); return; }
    await handleAnalyze(req, res, deps);
    return;
  }
  if (pathname === '/openclaw/tune') {
    if (method !== 'POST') { sendError(res, 405, 'Method Not Allowed'); return; }
    await handleTune(req, res, deps);
    return;
  }
  if (pathname === '/openclaw/report') {
    if (method !== 'GET') { sendError(res, 405, 'Method Not Allowed'); return; }
    await handleReport(req, res, deps);
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

  sendError(res, 404, 'Not Found');
}
