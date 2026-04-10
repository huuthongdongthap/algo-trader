/**
 * Public/authenticated dashboard API GET route handlers
 * Handles all authenticated /dashboard/api/* GET endpoints
 */
import { authenticateRequest } from './dashboard-middleware.js';
import { sendJson } from './dashboard-utils.js';
import { getSystemHealth, getRevenueSummary, getAiInsights } from './dashboard-route-helpers.js';
import {
  getPaperTradingStatus,
  getSdkExamples,
  getMarketplaceBrowse,
  getOnboardingChecklist,
} from './dashboard-demo-data.js';
import type { RouteContext } from './dashboard-routes.js';

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
    // hedgePortfolios state managed in dashboard-server.ts, passed via deps
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
