// HTTP server for dashboard: serves static files + JSON API endpoints
// Pure node:http + node:fs — no Express
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardDataProvider } from './dashboard-data.js';
import type { UserStore } from '../users/user-store.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';

/** Map file extensions to MIME content-types */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
};

const PUBLIC_DIR = join(fileURLToPath(import.meta.url), '..', 'public');

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

// ── AI Insights (Sprint 49) ──────────────────────────────────────────────

function getAiInsights() {
  return {
    signals: [
      { id: 'sig_1', market: 'POLY-TRUMP-2026', action: 'buy', strength: 'strong', confidence: 0.87, reasoning: 'Probability mispricing detected vs polling aggregates', strategy: 'polymarket-arb', timestamp: Date.now() - 300_000 },
      { id: 'sig_2', market: 'BTC-USD', action: 'hold', strength: 'moderate', confidence: 0.62, reasoning: 'Consolidation phase, waiting for breakout confirmation', strategy: 'momentum-scalper', timestamp: Date.now() - 900_000 },
      { id: 'sig_3', market: 'ETH-USD', action: 'sell', strength: 'weak', confidence: 0.54, reasoning: 'Approaching resistance with declining volume', strategy: 'mean-reversion', timestamp: Date.now() - 1_800_000 },
    ],
    anomalies: { detected: false, severity: 'none', items: [] },
    health: { assessment: 'healthy', confidence: 0.91, insights: ['All strategies operating within normal parameters', 'Win rate trending upward over last 24h'] },
    aiStatus: { gateway: 'Ollama', model: 'llama3.1:8b', lastCallMs: 342, totalCalls: 156, quotaUsed: 23 },
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
export function createDashboardServer(port: number, dataProvider: DashboardDataProvider, userStore?: UserStore): Server {
  const analytics = userStore ? new AdminAnalytics(userStore) : null;
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Only handle GET requests
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
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

      // GET /dashboard/api/ai-insights — AI trading insights summary
      if (url === '/dashboard/api/ai-insights') {
        sendJson(res, 200, getAiInsights());
        return;
      }

      // Static file serving — map / to index.html
      const staticPath = url === '/' ? '/index.html' : url;
      // Prevent directory traversal
      const safePath = join(PUBLIC_DIR, staticPath.replace(/\.\./g, ''));
      await serveStatic(res, safePath);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: 'Internal Server Error', message });
    }
  });

  server.listen(port, () => {
    console.log(`[Dashboard] Server listening on http://localhost:${port}`);
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
