/**
 * Shared helper functions for dashboard route handlers
 * Imported by dashboard-routes.ts, dashboard-admin-routes.ts, dashboard-api-get-routes.ts
 */
import type { IncomingMessage } from 'node:http';
import { AdminAnalytics } from '../admin/admin-analytics.js';
import type { DashboardDeps } from './dashboard-server.js';

// ── System health ────────────────────────────────────────────────────────────

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

// ── Revenue summary ──────────────────────────────────────────────────────────

export function getRevenueSummary(analytics: AdminAnalytics | null) {
  if (!analytics) {
    return { mrr: 0, arr: 0, arrTarget: 1_000_000, arrProgress: 0, totalUsers: 0, tiers: { free: 0, pro: 0, enterprise: 0 }, marketplaceRevenue: 0, timeline: [] };
  }
  const stats = analytics.getUserStats();
  const mrr = analytics.getMRR();
  const arr = mrr * 12;
  const timeline = analytics.getRevenueTimeline(30);
  return {
    mrr, arr, arrTarget: 1_000_000,
    arrProgress: Math.round((arr / 1_000_000) * 10000) / 100,
    totalUsers: stats.totalUsers,
    tiers: stats.byTier,
    marketplaceRevenue: 0,
    timeline,
  };
}

// ── AI Insights ──────────────────────────────────────────────────────────────

export function getAiInsights(deps: DashboardDeps) {
  const signals = deps.signalGenerator ? deps.signalGenerator.getSignals(undefined, 10) : [];
  const signalStats = deps.signalGenerator
    ? deps.signalGenerator.getStats()
    : { totalSignals: 0, actionBreakdown: { buy: 0, sell: 0, hold: 0 }, avgConfidence: 0, markets: [] };

  let anomalies = { detected: false, severity: 'none' as string, items: [] as string[] };
  const healthInsights: string[] = [];
  if (deps.tradeObserver) {
    const snapshot = deps.tradeObserver.getSnapshot();
    if (deps.tradeObserver.shouldAlert(snapshot)) {
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

// ── Body reader ──────────────────────────────────────────────────────────────

/** Read JSON body from request */
export function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch { resolve({}); } });
    req.on('error', reject);
  });
}
