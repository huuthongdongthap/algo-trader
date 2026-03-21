// REST API route handlers for algo-trade RaaS remote control
// Each handler receives (req, res, engine) - pure Node.js, no framework
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TradingEngine } from '../engine/engine.js';
import type { UserStore } from '../users/user-store.js';
import { handleCheckout, handlePolarWebhookRoute } from './polar-billing-routes.js';
import { handleHealthEnriched } from './health-route.js';
import { handleMetrics } from './metrics-route.js';
import { withRequestMetrics } from './request-metrics-middleware.js';
import { handleStrategyStart, handleStrategyStop } from './strategy-route-handlers.js';

// ─── Response helpers ─────────────────────────────────────────────────────────

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

// ─── Route handlers ───────────────────────────────────────────────────────────

/** GET /api/health - enriched health check (delegates to health-route.ts) */
export { handleHealthEnriched as handleHealth };

/** GET /api/metrics - Prometheus text format (delegates to metrics-route.ts) */
export { handleMetrics };

/** POST /api/strategy/start|stop - delegated to strategy-route-handlers.ts */
export { handleStrategyStart, handleStrategyStop };

const STATUS_START = Date.now();

/** GET /api/status - engine status + uptime */
export function handleStatus(_req: IncomingMessage, res: ServerResponse, engine: TradingEngine): void {
  sendJson(res, 200, { ...engine.getStatus(), uptime: Date.now() - STATUS_START });
}

/** GET /api/trades - recent trade log (last 100) */
export function handleTrades(_req: IncomingMessage, res: ServerResponse, engine: TradingEngine): void {
  const trades = engine.getExecutor().getTradeLog().slice(-100);
  sendJson(res, 200, { trades, count: trades.length });
}

/** GET /api/pnl - P&L summary derived from trade log */
export function handlePnl(_req: IncomingMessage, res: ServerResponse, engine: TradingEngine): void {
  const trades = engine.getExecutor().getTradeLog();
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

// ─── Main router ──────────────────────────────────────────────────────────────

/** Route incoming request to appropriate handler */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
  pathname: string,
  userStore?: UserStore,
): Promise<void> {
  const method = req.method ?? 'GET';

  // Health and metrics bypass metrics middleware to avoid circularity
  if (pathname === '/api/health') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleHealthEnriched(req, res, engine);
    return;
  }

  if (pathname === '/api/metrics') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleMetrics(req, res);
    return;
  }

  // All other routes tracked via request metrics middleware
  await withRequestMetrics(req, res, pathname, async () => {
    if (pathname === '/api/status') {
      if (method !== 'GET') { sendMethodNotAllowed(res); return; }
      handleStatus(req, res, engine);
    } else if (pathname === '/api/trades') {
      if (method !== 'GET') { sendMethodNotAllowed(res); return; }
      handleTrades(req, res, engine);
    } else if (pathname === '/api/pnl') {
      if (method !== 'GET') { sendMethodNotAllowed(res); return; }
      handlePnl(req, res, engine);
    } else if (pathname === '/api/strategy/start') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      await handleStrategyStart(req, res, engine);
    } else if (pathname === '/api/strategy/stop') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      await handleStrategyStop(req, res, engine);
    } else if (pathname === '/api/checkout') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      if (!userStore) { sendJson(res, 503, { error: 'Billing not configured' }); return; }
      await handleCheckout(req, res, userStore);
    } else if (pathname === '/api/webhooks/polar') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      if (!userStore) { sendJson(res, 503, { error: 'Billing not configured' }); return; }
      await handlePolarWebhookRoute(req, res, userStore);
    } else {
      sendNotFound(res);
    }
  }, engine.isRunning());
}
