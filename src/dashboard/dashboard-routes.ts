/**
 * Dashboard API route handlers — main dispatcher & shared types
 *
 * Sub-modules (no circular deps — all share dashboard-route-helpers.ts):
 *   dashboard-admin-routes.ts    — /dashboard/api/admin/* (ban, upgrade, role, revenue)
 *   dashboard-api-get-routes.ts  — /dashboard/api/* authenticated GET endpoints
 *   dashboard-route-helpers.ts   — getSystemHealth, getRevenueSummary, getAiInsights, readBody
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardDataProvider } from './dashboard-data.js';
import type { UserStore } from '../users/user-store.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';
import { handleRegister, handleLogin } from '../api/auth-routes.js';
import type { DashboardDeps } from './dashboard-server.js';

// Re-export helpers so existing callers that import from dashboard-routes still work
export {
  getSystemHealth,
  getRevenueSummary,
  getAiInsights,
  readBody,
} from './dashboard-route-helpers.js';

// Re-export sub-module handlers so dashboard-server.ts keeps a single import
export { handleAdminPostRoutes, handleAdminGetRoutes } from './dashboard-admin-routes.js';
export { handleApiGetRoutes } from './dashboard-api-get-routes.js';

// ── Shared RouteContext type ─────────────────────────────────────────────────

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

// ── Auth routes ──────────────────────────────────────────────────────────────

/** Handle auth endpoints proxied on dashboard port */
export async function handleAuthRoutes(ctx: RouteContext): Promise<boolean> {
  const { url, method, req, res, userStore } = ctx;
  if (method === 'POST' && userStore) {
    if (url === '/api/auth/register') { await handleRegister(req, res, userStore); return true; }
    if (url === '/api/auth/login') { await handleLogin(req, res, userStore); return true; }
  }
  return false;
}
