/**
 * Dashboard API route handlers
 * Handles all /dashboard/api/* and /api/auth/* routes
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardDataProvider } from './dashboard-data.js';
import type { UserStore } from '../users/user-store.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';
import { handleRegister, handleLogin } from '../api/auth-routes.js';
import { authenticateRequest, requireAdmin } from './dashboard-middleware.js';
import { sendJson } from './dashboard-utils.js';
import type { DashboardDeps } from './dashboard-server.js';
import {
  getPaperTradingStatus,
  getSdkExamples,
  getMarketplaceBrowse,
  getOnboardingChecklist,
} from './dashboard-demo-data.js';

// ── System health (Sprint 46) ────────────────────────────────────────────────

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function getSystemHealth() {
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

// ── AI Insights (Sprint 49 → Sprint 58: wired to real OpenClaw data) ─────────

export function getAiInsights(deps: DashboardDeps) {
  const signals = deps.signalGenerator
    ? deps.signalGenerator.getSignals(undefined, 10)
    : [];
  const signalStats = deps.signalGenerator
    ? deps.signalGenerator.getStats()
    : { totalSignals: 0, actionBreakdown: { buy: 0, sell: 0, hold: 0 }, avgConfidence: 0, markets: [] };

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

// ── Revenue summary (Sprint 37 → Sprint 55: wired to real data) ──────────────

export function getRevenueSummary(analytics: AdminAnalytics | null) {
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

/** Read JSON body from request */
export function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    req.on('error', reject);
  });
}

export interface RouteContext {
  url: string;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  dataProvider: DashboardDataProvider;
  analytics: AdminAnalytics | null;
  userStore?: UserStore;
  jwtSecret: string;
  deps: DashboardDeps;
}

/** Handle auth endpoints proxied on dashboard port */
export async function handleAuthRoutes(ctx: RouteContext): Promise<boolean> {
  const { url, method, req, res, userStore } = ctx;
  if (method === 'POST' && userStore) {
    if (url === '/api/auth/register') { await handleRegister(req, res, userStore); return true; }
    if (url === '/api/auth/login') { await handleLogin(req, res, userStore); return true; }
  }
  return false;
}

/** Handle admin POST endpoints (ban, upgrade, role) */
export async function handleAdminPostRoutes(ctx: RouteContext): Promise<boolean> {
  const { url, method, req, res, userStore, jwtSecret } = ctx;
  if (method !== 'POST' || !url.startsWith('/dashboard/api/admin/') || !userStore) return false;
  if (!requireAdmin(req, res, jwtSecret)) return true; // auth failed — response already sent

  const banMatch = url.match(/^\/dashboard\/api\/admin\/users\/([^/]+)\/ban$/);
  if (banMatch) {
    const ok = userStore.deactivateUser(banMatch[1]!);
    sendJson(res, 200, { ok, userId: banMatch[1], action: 'banned' });
    return true;
  }

  const upgradeMatch = url.match(/^\/dashboard\/api\/admin\/users\/([^/]+)\/upgrade$/);
  if (upgradeMatch) {
    const body = await readBody(req);
    const tier = body.tier as string;
    if (!tier || !['free', 'pro', 'enterprise'].includes(tier)) {
      sendJson(res, 400, { error: 'Invalid tier', valid: ['free', 'pro', 'enterprise'] });
      return true;
    }
    const ok = userStore.updateTier(upgradeMatch[1]!, tier as 'free' | 'pro' | 'enterprise');
    sendJson(res, 200, { ok, userId: upgradeMatch[1], tier, action: 'upgraded' });
    return true;
  }

  const roleMatch = url.match(/^\/dashboard\/api\/admin\/users\/([^/]+)\/role$/);
  if (roleMatch) {
    const body = await readBody(req);
    const role = body.role as string;
    if (!role || !['user', 'admin'].includes(role)) {
      sendJson(res, 400, { error: 'Invalid role', valid: ['user', 'admin'] });
      return true;
    }
    const ok = userStore.updateRole(roleMatch[1]!, role as 'user' | 'admin');
    sendJson(res, 200, { ok, userId: roleMatch[1], role, action: 'role-changed' });
    return true;
  }

  sendJson(res, 404, { error: 'Admin endpoint not found' });
  return true;
}

/** Handle admin GET endpoints */
export function handleAdminGetRoutes(ctx: RouteContext): boolean {
  const { url, req, res, userStore, analytics, jwtSecret } = ctx;
  if (!url.startsWith('/dashboard/api/admin/')) return false;
  if (!requireAdmin(req, res, jwtSecret)) return true;

  if (url === '/dashboard/api/admin/users') {
    const users = userStore ? userStore.listActiveUsers().map(u => ({
      id: u.id, email: u.email, tier: u.tier, role: u.role ?? 'user',
      createdAt: u.createdAt, active: u.active,
      apiKeyPrefix: u.apiKey.slice(0, 8) + '...',
    })) : [];
    sendJson(res, 200, { users, count: users.length });
    return true;
  }

  if (url === '/dashboard/api/admin/system') {
    sendJson(res, 200, getSystemHealth());
    return true;
  }

  if (url === '/dashboard/api/admin/revenue') {
    sendJson(res, 200, getRevenueSummary(analytics));
    return true;
  }

  sendJson(res, 404, { error: 'Admin endpoint not found' });
  return true;
}

/** Handle public/authenticated dashboard API GET routes */
export function handleApiGetRoutes(ctx: RouteContext): boolean {
  const { url, req, res, dataProvider, analytics, deps, jwtSecret } = ctx;

  if (!url.startsWith('/dashboard/api/')) return false;
  if (!authenticateRequest(req, res, jwtSecret)) return true;

  if (url === '/dashboard/api/summary') {
    sendJson(res, 200, dataProvider.getSummary()); return true;
  }
  if (url === '/dashboard/api/equity-curve') {
    sendJson(res, 200, dataProvider.getEquityCurve()); return true;
  }
  if (url === '/dashboard/api/strategies') {
    sendJson(res, 200, dataProvider.getStrategyBreakdown()); return true;
  }
  if (url.startsWith('/dashboard/api/portfolio')) {
    sendJson(res, 200, dataProvider.getPortfolioSummary()); return true;
  }
  if (url.startsWith('/dashboard/api/trades')) {
    const limit = parseInt(new URL(url, 'http://x').searchParams.get('limit') ?? '50', 10);
    sendJson(res, 200, dataProvider.getTradeHistory(undefined, limit)); return true;
  }
  if (url.startsWith('/dashboard/api/positions')) {
    sendJson(res, 200, dataProvider.getActivePositions()); return true;
  }
  if (url.startsWith('/dashboard/api/strategy-status')) {
    sendJson(res, 200, dataProvider.getStrategyStatus()); return true;
  }
  if (url === '/dashboard/api/paper-trading') {
    sendJson(res, 200, getPaperTradingStatus()); return true;
  }
  if (url === '/dashboard/api/system-health') {
    sendJson(res, 200, getSystemHealth()); return true;
  }
  if (url === '/dashboard/api/sdk-examples') {
    sendJson(res, 200, getSdkExamples()); return true;
  }
  if (url === '/dashboard/api/revenue') {
    sendJson(res, 200, getRevenueSummary(analytics)); return true;
  }
  if (url.startsWith('/dashboard/api/marketplace')) {
    sendJson(res, 200, getMarketplaceBrowse()); return true;
  }
  if (url === '/dashboard/api/onboarding') {
    sendJson(res, 200, getOnboardingChecklist()); return true;
  }
  if (url === '/dashboard/api/ai-insights') {
    sendJson(res, 200, getAiInsights(deps)); return true;
  }
  if (url === '/dashboard/api/leaderboard') {
    const leaders = deps.leaderBoard ? deps.leaderBoard.getTopTraders(20) : [];
    sendJson(res, 200, { leaders, total: leaders.length }); return true;
  }
  if (url === '/dashboard/api/hedge-portfolios') {
    // hedgePortfolios state is managed in dashboard-server.ts and passed via deps
    sendJson(res, 200, deps.getHedgePortfolios ? deps.getHedgePortfolios() : { portfolios: [], lastScanAt: 0, count: 0 }); return true;
  }
  if (url === '/dashboard/api/usage') {
    if (analytics) {
      const stats = analytics.getUserStats();
      sendJson(res, 200, { totalUsers: stats.totalUsers, byTier: stats.byTier, activeUsers24h: stats.totalUsers, timestamp: Date.now() });
    } else {
      sendJson(res, 200, { totalUsers: 0, byTier: { free: 0, pro: 0, enterprise: 0 }, activeUsers24h: 0, timestamp: Date.now() });
    }
    return true;
  }

  return false;
}
