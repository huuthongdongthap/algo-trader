/**
 * Admin API route handlers
 * Handles /dashboard/api/admin/* endpoints — user management, revenue, system health
 */
import { requireAdmin } from './dashboard-middleware.js';
import { sendJson } from './dashboard-utils.js';
import { readBody, getSystemHealth, getRevenueSummary } from './dashboard-route-helpers.js';
import type { RouteContext } from './dashboard-routes.js';

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

/** Handle admin GET endpoints — users list, system health, revenue */
export function handleAdminGetRoutes(ctx: RouteContext): boolean {
  const { url, req, res, userStore, analytics, jwtSecret } = ctx;
  if (!url.startsWith('/dashboard/api/admin/')) return false;
  if (!requireAdmin(req, res, jwtSecret)) return true;

  if (url === '/dashboard/api/admin/users') {
    const users = userStore ? userStore.listActiveUsers().map((u: Record<string, unknown>) => ({
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
