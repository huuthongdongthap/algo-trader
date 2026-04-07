// HTTP server for dashboard: serves static files + JSON API endpoints
// Pure node:http + node:fs — no Express
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardDataProvider } from './dashboard-data.js';
import { logger } from '../core/logger.js';
import type { UserStore } from '../users/user-store.js';
import { verifyJwt } from '../api/auth-middleware.js';
import type { Role } from '../users/subscription-tier.js';
import { handleRegister, handleLogin } from '../api/auth-routes.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';
import type { AiSignalGenerator } from '../openclaw/ai-signal-generator.js';
import type { TradeObserver } from '../openclaw/trade-observer.js';
import type { LeaderBoard } from '../copy-trading/leader-board.js';

/** Optional AI + social deps injected from app.ts for live data */
export interface DashboardDeps {
  signalGenerator?: AiSignalGenerator;
  tradeObserver?: TradeObserver;
  leaderBoard?: LeaderBoard;
}

/** Map file extensions to MIME content-types */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
};

const PUBLIC_DIR = join(fileURLToPath(import.meta.url), '..', 'public');
const UI_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'ui');

// ── Paper trading status (Sprint 45) ─────────────────────────────────────────

function getPaperTradingStatus() {
  return {
    sessions: [
      { id: 'ps_demo1', strategy: 'polymarket-arb', capital: 10000, equity: 10847, pnl: 847, pnlPct: 8.47, trades: 42, winRate: 0.64, status: 'active', startedAt: Date.now() - 3 * 86_400_000 },
      { id: 'ps_demo2', strategy: 'momentum-scalper', capital: 5000, equity: 5234, pnl: 234, pnlPct: 4.68, trades: 18, winRate: 0.56, status: 'active', startedAt: Date.now() - 1 * 86_400_000 },
      { id: 'ps_demo3', strategy: 'market-maker', capital: 20000, equity: 19650, pnl: -350, pnlPct: -1.75, trades: 156, winRate: 0.71, status: 'stopped', startedAt: Date.now() - 7 * 86_400_000 },
    ],
    totalCapital: 35000,
    totalEquity: 35731,
    totalPnl: 731,
  };
}

// ── System health (Sprint 46) ────────────────────────────────────────────────

function getSystemHealth() {
  const uptimeMs = process.uptime() * 1000;
  const mem = process.memoryUsage();
  return {
    uptime: Math.floor(uptimeMs / 1000),
    uptimeFormatted: formatUptime(uptimeMs),
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
    },
    components: [
      { name: 'API Server', status: 'healthy', port: 3000 },
      { name: 'Dashboard', status: 'healthy', port: 3001 },
      { name: 'Landing', status: 'healthy', port: 3002 },
      { name: 'WebSocket', status: 'healthy', port: 3003 },
      { name: 'Webhook', status: 'healthy', port: 3004 },
      { name: 'Database', status: 'healthy', detail: 'SQLite WAL' },
      { name: 'OpenClaw AI', status: 'healthy', detail: 'Ollama gateway' },
      { name: 'Telegram', status: process.env['TELEGRAM_BOT_TOKEN'] ? 'healthy' : 'not configured' },
    ],
    node: process.version,
    platform: process.platform,
    arch: process.arch,
  };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── AI Insights (Sprint 49 → Sprint 58: wired to real OpenClaw data) ─────

function getAiInsights(deps: DashboardDeps) {
  // Real signals from AiSignalGenerator
  const signals = deps.signalGenerator
    ? deps.signalGenerator.getSignals(undefined, 10)
    : [];
  const signalStats = deps.signalGenerator
    ? deps.signalGenerator.getStats()
    : { totalSignals: 0, actionBreakdown: { buy: 0, sell: 0, hold: 0 }, avgConfidence: 0, markets: [] };

  // Real anomalies from TradeObserver
  let anomalies = { detected: false, severity: 'none' as string, items: [] as string[] };
  const healthInsights: string[] = [];
  if (deps.tradeObserver) {
    const snapshot = deps.tradeObserver.getSnapshot();
    const isAnomaly = deps.tradeObserver.shouldAlert(snapshot);
    if (isAnomaly) {
      const items: string[] = [];
      if (snapshot.winRate < 0.4) items.push(`Win rate ${(snapshot.winRate * 100).toFixed(1)}% below threshold`);
      if (snapshot.drawdown > 0.15) items.push(`Drawdown ${(snapshot.drawdown * 100).toFixed(1)}% exceeds limit`);
      anomalies = { detected: true, severity: items.length > 1 ? 'high' : 'medium', items };
    }
    healthInsights.push(`${snapshot.recentTrades.length} trades in observation window`);
    healthInsights.push(`${snapshot.activeStrategies.length} active strategies`);
    if (snapshot.winRate > 0) healthInsights.push(`Win rate: ${(snapshot.winRate * 100).toFixed(1)}%`);
  }

  return {
    signals,
    anomalies,
    health: {
      assessment: anomalies.detected ? 'warning' : 'healthy',
      confidence: signalStats.avgConfidence || 0,
      insights: healthInsights.length > 0 ? healthInsights : ['No trade data yet'],
    },
    aiStatus: {
      gateway: process.env['OPENCLAW_GATEWAY_URL'] ?? 'Ollama',
      model: process.env['OPENCLAW_MODEL_STANDARD'] ?? 'llama3.1:8b',
      totalSignals: signalStats.totalSignals,
      markets: signalStats.markets,
    },
  };
}

// ── Hedge portfolios (Sprint 239: PolyClaw dashboard integration) ─────────────

/** In-memory store for last hedge scan results (populated by scheduler job) */
let _lastHedgeResults: Array<{
  tier: number; coverage: number; profitPct: number;
  targetQuestion: string; coverQuestion: string;
  targetId: string; coverId: string;
}> = [];
let _lastHedgeScanAt = 0;

/** Called by scheduler hedge job to push results to dashboard */
export function setHedgeResults(results: typeof _lastHedgeResults): void {
  _lastHedgeResults = results;
  _lastHedgeScanAt = Date.now();
}

function getHedgePortfolios() {
  return {
    portfolios: _lastHedgeResults,
    lastScanAt: _lastHedgeScanAt,
    count: _lastHedgeResults.length,
  };
}

// ── SDK examples (Sprint 47) ─────────────────────────────────────────────────

function getSdkExamples() {
  return { examples: [
    { title: 'Install & Setup', lang: 'bash', code: 'npm install @cashclaw/sdk\n# or\npnpm add @cashclaw/sdk' },
    { title: 'Initialize Client', lang: 'typescript', code: `import { AlgoTradeClient } from '@cashclaw/sdk';\n\nconst client = new AlgoTradeClient({\n  baseUrl: 'https://api.cashclaw.cc',\n  apiKey: 'your_api_key_here',\n});` },
    { title: 'Health Check', lang: 'typescript', code: `const health = await client.getHealth();\nconsole.log(health.status); // "ok"` },
    { title: 'Start a Strategy', lang: 'typescript', code: `await client.startStrategy('polymarket-arb');\nconsole.log('Strategy started!');` },
    { title: 'Get Trades', lang: 'typescript', code: `const { trades } = await client.getTrades();\nfor (const t of trades) {\n  console.log(t.side, t.fillPrice, t.strategy);\n}` },
    { title: 'Run Backtest', lang: 'typescript', code: `const result = await client.request('POST', '/api/backtest', {\n  strategy: 'momentum-scalper',\n  market: 'BTC-USD',\n  startDate: '2025-01-01',\n  endDate: '2025-12-31',\n  config: { initialCapital: 10000 },\n});\nconsole.log('Return:', result.totalReturn);` },
    { title: 'Follow a Trader', lang: 'typescript', code: `await client.request('POST', '/api/copy-trading/follow', {\n  leaderId: 'demo-alpha-whale',\n  maxCapital: 5000,\n});\nconsole.log('Following AlphaWhale!');` },
    { title: 'Webhook (TradingView)', lang: 'typescript', code: `// POST to /api/webhooks/tradingview\n// with your webhook secret in Authorization header\n{\n  "action": "buy",\n  "symbol": "POLY_YES_TOKEN",\n  "size": "100",\n  "strategy": "tv-signals"\n}` },
  ]};
}

// ── Revenue summary (Sprint 37 → Sprint 55: wired to real data) ─────────────

function getRevenueSummary(analytics: AdminAnalytics | null) {
  if (!analytics) {
    return { mrr: 0, arr: 0, arrTarget: 1_000_000, arrProgress: 0, totalUsers: 0, tiers: { free: 0, pro: 0, enterprise: 0 }, marketplaceRevenue: 0, timeline: [] };
  }
  const stats = analytics.getUserStats();
  const mrr = analytics.getMRR();
  const arr = mrr * 12;
  const target = 1_000_000;
  const timeline = analytics.getRevenueTimeline(30);
  return {
    mrr, arr, arrTarget: target,
    arrProgress: Math.round((arr / target) * 10000) / 100,
    totalUsers: stats.totalUsers,
    tiers: stats.byTier,
    marketplaceRevenue: 0,
    timeline,
  };
}

// ── Marketplace browse (Sprint 38) ──────────────────────────────────────────

const DEMO_STRATEGIES = [
  { id: 'strat-poly-arb', name: 'Polymarket Arbitrage', author: 'AlphaWhale', category: 'polymarket', priceCents: 4900, rating: 4.8, downloads: 156, description: 'Cross-market arbitrage exploiting price discrepancies between Polymarket and other prediction platforms.' },
  { id: 'strat-momentum', name: 'Momentum Scalper Pro', author: 'PolySniper', category: 'polymarket', priceCents: 2900, rating: 4.5, downloads: 234, description: 'High-frequency momentum strategy with adaptive entry/exit signals and Kelly-based position sizing.' },
  { id: 'strat-mm', name: 'Market Maker Suite', author: 'MMPro', category: 'crypto', priceCents: 9900, rating: 4.9, downloads: 89, description: 'Professional market-making strategy with dynamic spread adjustment and inventory management.' },
  { id: 'strat-mean-rev', name: 'Mean Reversion Alpha', author: 'QuantSage', category: 'crypto', priceCents: 3900, rating: 4.3, downloads: 167, description: 'Statistical mean-reversion strategy using Bollinger Bands and Z-score for entry timing.' },
  { id: 'strat-trend', name: 'Trend Following MACD', author: 'SteadyEddie', category: 'crypto', priceCents: 0, rating: 4.1, downloads: 412, description: 'Free trend-following strategy using MACD crossovers with multi-timeframe confirmation.' },
  { id: 'strat-kalshi', name: 'Kalshi Event Trader', author: 'ArbKing', category: 'other', priceCents: 5900, rating: 4.6, downloads: 78, description: 'Event-driven strategy for Kalshi markets with sentiment analysis and probability modeling.' },
  { id: 'strat-polyclaw-hedge', name: 'PolyClaw Hedge T1/T2', author: 'CashClaw', category: 'polymarket', priceCents: 9900, rating: 4.9, downloads: 42, description: 'AI-powered hedge discovery using LLM implication analysis. Finds logically necessary relationships between Polymarket events for 95%+ coverage portfolios. Includes Kelly position sizing and two-tier cache.' },
];

function getMarketplaceBrowse() {
  return { items: DEMO_STRATEGIES, total: DEMO_STRATEGIES.length };
}

// ── Onboarding checklist (Sprint 39) ────────────────────────────────────────

function getOnboardingChecklist() {
  return {
    steps: [
      { step: 1, title: 'Create Account', description: 'Register and get your API key', icon: 'key', done: true },
      { step: 2, title: 'Explore Dashboard', description: 'View your trading overview and P&L charts', icon: 'chart', done: true },
      { step: 3, title: 'Run a Backtest', description: 'Test a strategy with historical data before going live', icon: 'flask', done: false },
      { step: 4, title: 'Start Paper Trading', description: 'Try strategies with simulated money — no risk', icon: 'play', done: false },
      { step: 5, title: 'Connect Notifications', description: 'Set up Telegram alerts for trade signals', icon: 'bell', done: false },
      { step: 6, title: 'Upgrade to Pro', description: 'Unlock live trading, AI tuning, and copy-trading', icon: 'star', done: false },
    ],
  };
}

/** Send JSON response */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Serve a static file from the public directory */
async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    const body = '404 Not Found';
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }
}

/**
 * Create and start the dashboard HTTP server.
 * @param port - TCP port to listen on
 * @param dataProvider - DashboardDataProvider instance for API responses
 * @param userStore - Optional UserStore for real revenue/user analytics
 * @returns running http.Server instance
 */
export function createDashboardServer(port: number, dataProvider: DashboardDataProvider, userStore?: UserStore, deps: DashboardDeps = {}): Server {
  const analytics = userStore ? new AdminAnalytics(userStore) : null;
  const jwtSecret = process.env['JWT_SECRET'] ?? '';

  /** Verify JWT from Authorization: Bearer <token> header. Returns payload or null. */
  function authenticateRequest(req: IncomingMessage, res: ServerResponse): { sub: string; email: string; role: Role } | true | false {
    // Skip auth if no JWT_SECRET configured (single-operator mode)
    if (!jwtSecret) return true;
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      sendJson(res, 401, { error: 'Unauthorized', message: 'Missing Authorization: Bearer <token>' });
      return false;
    }
    const payload = verifyJwt(authHeader.slice(7), jwtSecret);
    if (!payload) {
      sendJson(res, 401, { error: 'Unauthorized', message: 'Invalid or expired token' });
      return false;
    }
    return { sub: payload.sub, email: payload.email, role: (payload.role ?? 'user') as Role };
  }

  /** Check if authenticated user has admin role */
  function requireAdmin(req: IncomingMessage, res: ServerResponse): boolean {
    const auth = authenticateRequest(req, res);
    if (auth === false) return false;
    if (auth === true) return true; // no JWT_SECRET = single-operator mode, allow all
    if (auth.role !== 'admin') {
      sendJson(res, 403, { error: 'Forbidden', message: 'Admin access required' });
      return false;
    }
    return true;
  }

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS for cross-origin dashboard (cashclaw.cc → local backend)
    res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] ?? '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Auth endpoints (POST) — proxy on dashboard port so no cross-port issues
    if (method === 'POST' && userStore) {
      if (url === '/api/auth/register') { await handleRegister(req, res, userStore); return; }
      if (url === '/api/auth/login') { await handleLogin(req, res, userStore); return; }
    }

    // Admin POST endpoints (ban, upgrade, role change)
    if (method === 'POST' && url.startsWith('/dashboard/api/admin/') && userStore) {
      if (!requireAdmin(req, res)) return;

      // Read JSON body helper
      const readBody = (): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
        req.on('error', reject);
      });

      // POST /dashboard/api/admin/users/:id/ban
      const banMatch = url.match(/^\/dashboard\/api\/admin\/users\/([^/]+)\/ban$/);
      if (banMatch) {
        const ok = userStore.deactivateUser(banMatch[1]!);
        sendJson(res, 200, { ok, userId: banMatch[1], action: 'banned' });
        return;
      }

      // POST /dashboard/api/admin/users/:id/upgrade
      const upgradeMatch = url.match(/^\/dashboard\/api\/admin\/users\/([^/]+)\/upgrade$/);
      if (upgradeMatch) {
        const body = await readBody();
        const tier = body.tier as string;
        if (!tier || !['free', 'pro', 'enterprise'].includes(tier)) {
          sendJson(res, 400, { error: 'Invalid tier', valid: ['free', 'pro', 'enterprise'] });
          return;
        }
        const ok = userStore.updateTier(upgradeMatch[1]!, tier as 'free' | 'pro' | 'enterprise');
        sendJson(res, 200, { ok, userId: upgradeMatch[1], tier, action: 'upgraded' });
        return;
      }

      // POST /dashboard/api/admin/users/:id/role
      const roleMatch = url.match(/^\/dashboard\/api\/admin\/users\/([^/]+)\/role$/);
      if (roleMatch) {
        const body = await readBody();
        const role = body.role as string;
        if (!role || !['user', 'admin'].includes(role)) {
          sendJson(res, 400, { error: 'Invalid role', valid: ['user', 'admin'] });
          return;
        }
        const ok = userStore.updateRole(roleMatch[1]!, role as 'user' | 'admin');
        sendJson(res, 200, { ok, userId: roleMatch[1], role, action: 'role-changed' });
        return;
      }

      sendJson(res, 404, { error: 'Admin endpoint not found' });
      return;
    }

    // Only GET for everything else
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      // Admin API routes (JWT role=admin required)
      if (url.startsWith('/dashboard/api/admin/')) {
        if (!requireAdmin(req, res)) return;

        // GET /dashboard/api/admin/users — list all users
        if (url === '/dashboard/api/admin/users') {
          const users = userStore ? userStore.listActiveUsers().map(u => ({
            id: u.id, email: u.email, tier: u.tier, role: u.role ?? 'user',
            createdAt: u.createdAt, active: u.active,
            apiKeyPrefix: u.apiKey.slice(0, 8) + '...',
          })) : [];
          sendJson(res, 200, { users, count: users.length });
          return;
        }

        // GET /dashboard/api/admin/system — system overview
        if (url === '/dashboard/api/admin/system') {
          sendJson(res, 200, getSystemHealth());
          return;
        }

        // GET /dashboard/api/admin/revenue — revenue stats
        if (url === '/dashboard/api/admin/revenue') {
          sendJson(res, 200, getRevenueSummary(analytics));
          return;
        }

        sendJson(res, 404, { error: 'Admin endpoint not found' });
        return;
      }

      // Protect API routes with JWT auth (skip for static files)
      if (url.startsWith('/dashboard/api/')) {
        if (!authenticateRequest(req, res)) return;
      }

      // API routes
      if (url === '/dashboard/api/summary') {
        sendJson(res, 200, dataProvider.getSummary());
        return;
      }

      if (url === '/dashboard/api/equity-curve') {
        sendJson(res, 200, dataProvider.getEquityCurve());
        return;
      }

      if (url === '/dashboard/api/strategies') {
        sendJson(res, 200, dataProvider.getStrategyBreakdown());
        return;
      }

      if (url.startsWith('/dashboard/api/portfolio')) {
        sendJson(res, 200, dataProvider.getPortfolioSummary());
        return;
      }

      if (url.startsWith('/dashboard/api/trades')) {
        const limit = parseInt(new URL(url, 'http://x').searchParams.get('limit') ?? '50', 10);
        sendJson(res, 200, dataProvider.getTradeHistory(undefined, limit));
        return;
      }

      if (url.startsWith('/dashboard/api/positions')) {
        sendJson(res, 200, dataProvider.getActivePositions());
        return;
      }

      if (url.startsWith('/dashboard/api/strategy-status')) {
        sendJson(res, 200, dataProvider.getStrategyStatus());
        return;
      }

      // GET /dashboard/api/paper-trading — paper trading session info
      if (url === '/dashboard/api/paper-trading') {
        sendJson(res, 200, getPaperTradingStatus());
        return;
      }

      // GET /dashboard/api/system-health — system monitoring
      if (url === '/dashboard/api/system-health') {
        sendJson(res, 200, getSystemHealth());
        return;
      }

      // GET /dashboard/api/sdk-examples — SDK code snippets
      if (url === '/dashboard/api/sdk-examples') {
        sendJson(res, 200, getSdkExamples());
        return;
      }

      // GET /dashboard/api/revenue — admin revenue dashboard data (real data from UserStore)
      if (url === '/dashboard/api/revenue') {
        sendJson(res, 200, getRevenueSummary(analytics));
        return;
      }

      // GET /dashboard/api/marketplace — browse marketplace strategies
      if (url.startsWith('/dashboard/api/marketplace')) {
        sendJson(res, 200, getMarketplaceBrowse());
        return;
      }

      // GET /dashboard/api/onboarding — onboarding checklist
      if (url === '/dashboard/api/onboarding') {
        sendJson(res, 200, getOnboardingChecklist());
        return;
      }

      // GET /dashboard/api/ai-insights — AI trading insights summary (real OpenClaw data)
      if (url === '/dashboard/api/ai-insights') {
        sendJson(res, 200, getAiInsights(deps));
        return;
      }

      // GET /dashboard/api/leaderboard — copy-trading top traders
      if (url === '/dashboard/api/leaderboard') {
        const leaders = deps.leaderBoard ? deps.leaderBoard.getTopTraders(20) : [];
        sendJson(res, 200, { leaders, total: leaders.length });
        return;
      }

      // GET /dashboard/api/hedge-portfolios — PolyClaw hedge scan results (cached)
      if (url === '/dashboard/api/hedge-portfolios') {
        sendJson(res, 200, getHedgePortfolios());
        return;
      }

      // GET /dashboard/api/usage — API usage metering summary (admin view)
      if (url === '/dashboard/api/usage') {
        if (analytics) {
          const stats = analytics.getUserStats();
          sendJson(res, 200, {
            totalUsers: stats.totalUsers,
            byTier: stats.byTier,
            activeUsers24h: stats.totalUsers, // approximation from user store
            timestamp: Date.now(),
          });
        } else {
          sendJson(res, 200, { totalUsers: 0, byTier: { free: 0, pro: 0, enterprise: 0 }, activeUsers24h: 0, timestamp: Date.now() });
        }
        return;
      }

      // Static file serving — map / to index.html
      const staticPath = url === '/' ? '/index.html' : url;

      // Serve design system files from src/ui/ for /ui/* paths
      if (staticPath.startsWith('/ui/')) {
        const uiPath = resolve(UI_DIR, staticPath.slice(4));
        if (!uiPath.startsWith(resolve(UI_DIR))) { sendJson(res, 403, { error: 'Forbidden' }); return; }
        await serveStatic(res, uiPath);
        return;
      }

      // Prevent directory traversal
      const safePath = resolve(PUBLIC_DIR, staticPath.slice(1));
      if (!safePath.startsWith(resolve(PUBLIC_DIR))) { sendJson(res, 403, { error: 'Forbidden' }); return; }
      await serveStatic(res, safePath);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: 'Internal Server Error', message });
    }
  });

  server.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}`, 'Dashboard');
  });

  return server;
}

/**
 * Gracefully shut down the dashboard server.
 */
export function stopDashboardServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
