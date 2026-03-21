// REST API route handlers for algo-trade RaaS remote control
// Each handler receives (req, res, engine) - pure Node.js, no framework
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TradingEngine } from '../engine/engine.js';
import type { StrategyName } from '../core/types.js';

const VALID_STRATEGIES = new Set<string>([
  'cross-market-arb',
  'market-maker',
  'grid-trading',
  'dca-bot',
  'funding-rate-arb',
]);

/** Server start time for uptime calculation */
const SERVER_START = Date.now();

// ─── Response helpers ────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not Found' });
}

function sendMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method Not Allowed' });
}

// ─── Body parser ─────────────────────────────────────────────────────────────

/** Read and parse JSON body from POST requests */
async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Route handlers ──────────────────────────────────────────────────────────

/** GET /api/health - public health check */
export function handleHealth(_req: IncomingMessage, res: ServerResponse): void {
  sendJson(res, 200, {
    status: 'ok',
    timestamp: Date.now(),
    uptime: Date.now() - SERVER_START,
  });
}

/** GET /api/status - engine status including strategies and trade count */
export function handleStatus(_req: IncomingMessage, res: ServerResponse, engine: TradingEngine): void {
  const status = engine.getStatus();
  sendJson(res, 200, {
    ...status,
    uptime: Date.now() - SERVER_START,
  });
}

/** GET /api/trades - recent trade log (last 100) */
export function handleTrades(_req: IncomingMessage, res: ServerResponse, engine: TradingEngine): void {
  const trades = engine.getExecutor().getTradeLog().slice(-100);
  sendJson(res, 200, { trades, count: trades.length });
}

/** GET /api/pnl - P&L summary derived from trade log */
export function handlePnl(_req: IncomingMessage, res: ServerResponse, engine: TradingEngine): void {
  const trades = engine.getExecutor().getTradeLog();

  // Aggregate fees and trade counts per strategy from trade log
  let totalFees = 0;
  const byStrategy: Record<string, number> = {};

  for (const t of trades) {
    totalFees += parseFloat(t.fees);
    byStrategy[t.strategy] = (byStrategy[t.strategy] ?? 0) + 1;
  }

  sendJson(res, 200, {
    totalFees: totalFees.toFixed(6),
    tradeCount: trades.length,
    tradesByStrategy: byStrategy,
  });
}

/** POST /api/strategy/start - start a named strategy */
export async function handleStrategyStart(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
): Promise<void> {
  let body: { name?: string };
  try {
    body = await readJsonBody<{ name?: string }>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { name } = body;
  if (!name || !VALID_STRATEGIES.has(name)) {
    sendJson(res, 400, {
      error: 'Invalid strategy name',
      valid: [...VALID_STRATEGIES],
    });
    return;
  }

  try {
    await engine.getRunner().startStrategy(name as StrategyName);
    sendJson(res, 200, { ok: true, strategy: name, action: 'started' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to start strategy', message });
  }
}

/** POST /api/strategy/stop - stop a named strategy */
export async function handleStrategyStop(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
): Promise<void> {
  let body: { name?: string };
  try {
    body = await readJsonBody<{ name?: string }>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { name } = body;
  if (!name || !VALID_STRATEGIES.has(name)) {
    sendJson(res, 400, {
      error: 'Invalid strategy name',
      valid: [...VALID_STRATEGIES],
    });
    return;
  }

  try {
    await engine.getRunner().stopStrategy(name as StrategyName);
    sendJson(res, 200, { ok: true, strategy: name, action: 'stopped' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to stop strategy', message });
  }
}

// ─── Main router ─────────────────────────────────────────────────────────────

/** Route incoming request to appropriate handler */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
  pathname: string,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (pathname === '/api/health') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleHealth(req, res);
    return;
  }

  if (pathname === '/api/status') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleStatus(req, res, engine);
    return;
  }

  if (pathname === '/api/trades') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleTrades(req, res, engine);
    return;
  }

  if (pathname === '/api/pnl') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handlePnl(req, res, engine);
    return;
  }

  if (pathname === '/api/strategy/start') {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    await handleStrategyStart(req, res, engine);
    return;
  }

  if (pathname === '/api/strategy/stop') {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    await handleStrategyStop(req, res, engine);
    return;
  }

  sendNotFound(res);
}
