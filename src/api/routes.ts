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
import { handleRegister, handleLogin, handleMe, handleRotateApiKey } from './auth-routes.js';
import type { AuthenticatedRequest } from './auth-middleware.js';
import { handleCopyTradingRoute, type CopyTradingHandlers } from './copy-trading-routes.js';
import { handleBacktest } from './backtest-route-handler.js';
import { handleReferralRoutes } from './referral-routes.js';
import { handleMarketplaceRoutes } from './marketplace-routes.js';
import { handleTradingViewRoutes } from './tradingview-webhook-routes.js';
import { handlePipelineRoutes } from './pipeline-routes.js';
import { handlePortfolioRoutes } from './portfolio-routes.js';
import { handleSignalRoutes } from './signal-routes.js';
import { handleDocsRoutes } from './docs-routes.js';
import { handleOnboardingRoutes } from './onboarding-routes.js';
import { handlePolymarketStatsRoutes } from './polymarket-stats-routes.js';
import { handleOpenClawRequest, type OpenClawDeps } from '../openclaw/api-endpoints.js';
import { checkApiRateLimit } from './api-rate-limiter.js';
import { handleAnalyticsRoutes } from './analytics-routes.js';
import { handleAlertHistoryRoutes } from './alert-history-routes.js';

// ─── OpenClaw deps setter (called from app.ts after bootstrap) ───────────────
let _openClawDeps: OpenClawDeps | null = null;
export function setOpenClawDeps(deps: OpenClawDeps): void { _openClawDeps = deps; }

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
  copyTradingHandlers?: CopyTradingHandlers,
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

  // API docs bypass metrics (informational, no auth required)
  if (pathname === '/api/docs' || pathname === '/api/docs/openapi.json') {
    handleDocsRoutes(req, res, pathname);
    return;
  }

  // Per-user rate limiting (skips health/metrics/docs above)
  if (!checkApiRateLimit(req as any, res)) return;

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
    } else if (pathname === '/api/auth/register') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      if (!userStore) { sendJson(res, 503, { error: 'User store not configured' }); return; }
      await handleRegister(req, res, userStore);
    } else if (pathname === '/api/auth/login') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      if (!userStore) { sendJson(res, 503, { error: 'User store not configured' }); return; }
      await handleLogin(req, res, userStore);
    } else if (pathname === '/api/auth/me') {
      if (method !== 'GET') { sendMethodNotAllowed(res); return; }
      if (!userStore) { sendJson(res, 503, { error: 'User store not configured' }); return; }
      handleMe(req as AuthenticatedRequest, res, userStore);
    } else if (pathname === '/api/auth/api-key') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      if (!userStore) { sendJson(res, 503, { error: 'User store not configured' }); return; }
      handleRotateApiKey(req as AuthenticatedRequest, res, userStore);
    } else if (pathname === '/api/backtest') {
      if (method !== 'POST') { sendMethodNotAllowed(res); return; }
      await handleBacktest(req, res);
    } else if (pathname.startsWith('/api/marketplace/')) {
      const authReq = req as AuthenticatedRequest;
      const user = authReq.user;
      if (!user) { sendJson(res, 401, { error: 'Unauthorized' }); return; }
      const handled = await handleMarketplaceRoutes(req, res, user.id, user.tier);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/referral/')) {
      const handled = await handleReferralRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (copyTradingHandlers && (
      pathname === '/api/leaders' ||
      pathname.startsWith('/api/leaders/') ||
      pathname === '/api/copy/my' ||
      pathname.startsWith('/api/copy/')
    )) {
      const handled = await handleCopyTradingRoute(req, res, pathname, method, copyTradingHandlers);
      if (!handled) sendNotFound(res);
    } else if (
      pathname.startsWith('/api/webhooks/tradingview/') ||
      pathname === '/api/tv/generate-secret' ||
      pathname === '/api/tv/my-webhook'
    ) {
      if (!userStore) { sendJson(res, 503, { error: 'User store not configured' }); return; }
      const handled = await handleTradingViewRoutes(req, res, pathname, userStore);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/pipeline/') || pathname === '/api/pipeline/status') {
      const handled = await handlePipelineRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/portfolio/')) {
      const handled = await handlePortfolioRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/signals/')) {
      const handled = await handleSignalRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/onboarding/')) {
      const handled = await handleOnboardingRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/polymarket/')) {
      const handled = await handlePolymarketStatsRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/analytics/')) {
      const handled = handleAnalyticsRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/alerts/')) {
      const handled = handleAlertHistoryRoutes(req, res, pathname, method);
      if (!handled) sendNotFound(res);
    } else if (pathname.startsWith('/api/openclaw/')) {
      if (!_openClawDeps) { sendJson(res, 503, { error: 'OpenClaw AI not configured' }); return; }
      // Remap /api/openclaw/* → /openclaw/* for internal handler
      const subPath = pathname.replace('/api/openclaw/', '/openclaw/');
      await handleOpenClawRequest(req, res, _openClawDeps, subPath);
    } else {
      sendNotFound(res);
    }
  }, engine.isRunning());
}
