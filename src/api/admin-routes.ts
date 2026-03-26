// Admin-only API routes for revenue analytics and user management
// Gate: user email ends with @cashclaw.cc OR user.role === 'admin'
// Endpoints under /api/admin/* — requires valid JWT/ApiKey auth first

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UserStore } from '../users/user-store.js';
import type { Tier } from '../users/subscription-tier.js';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import { hashPassword } from '../users/user-store.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';
import { generateLicense, buildPayload } from '../license/license-generator.js';
import { initLicenseStore, saveLicense, getActiveLicenses, revokeLicense as revokeLicenseKey } from '../license/license-store.js';

// ─── Admin gate ────────────────────────────────────────────────────────────────

const ADMIN_EMAIL_DOMAIN = '@cashclaw.cc';

/**
 * Check if the requesting user has admin privileges.
 * Admin = email ends with @cashclaw.cc OR role field === 'admin'.
 */
function isAdminUser(userId: string, userTier: Tier, userStore: UserStore): boolean {
  const user = userStore.getUserById(userId);
  if (!user) return false;
  if (user.email.endsWith(ADMIN_EMAIL_DOMAIN)) return true;
  // Check role field on User model
  if (user.role === 'admin') return true;
  return false;
}

function sendForbidden(res: ServerResponse): void {
  sendJson(res, 403, { error: 'Forbidden', message: 'Admin access required' });
}

function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not Found' });
}

function sendMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method Not Allowed' });
}

// ─── Route handlers ───────────────────────────────────────────────────────────

/** GET /api/admin/stats — overview: totalUsers, mrr, arpu, tierDistribution, newThisMonth */
function handleAdminStats(
  res: ServerResponse,
  analytics: AdminAnalytics,
): void {
  const mrr = analytics.getMRR();
  const stats = analytics.getUserStats();
  const arpu = stats.totalUsers > 0
    ? Math.round((mrr / stats.totalUsers) * 100) / 100
    : 0;

  sendJson(res, 200, {
    totalUsers: stats.totalUsers,
    mrr,
    arpu,
    tierDistribution: stats.byTier,
    newThisMonth: stats.newThisMonth,
    churnRate: stats.churnRate,
  });
}

/** GET /api/admin/users — list all users with tier, createdAt, lastLogin */
function handleAdminUsers(
  res: ServerResponse,
  userStore: UserStore,
): void {
  const users = userStore.listActiveUsers();
  const safeUsers = users.map((u) => ({
    id: u.id,
    email: u.email,
    tier: u.tier,
    createdAt: u.createdAt,
    active: u.active,
    polarCustomerId: u.polarCustomerId,
  }));
  sendJson(res, 200, { users: safeUsers, count: safeUsers.length });
}

/** GET /api/admin/revenue — mrr, arr, $1M target progress, 30-day timeline, top traders */
function handleAdminRevenue(
  res: ServerResponse,
  analytics: AdminAnalytics,
): void {
  const mrr = analytics.getMRR();
  const arr = mrr * 12;
  const arrTarget = 1_000_000;
  const arrProgress = Math.round((arr / arrTarget) * 10000) / 100; // 2 decimal %
  const timeline = analytics.getRevenueTimeline(30);
  const topTraders = analytics.getTopTraders(10);
  sendJson(res, 200, {
    mrr,
    arr,
    arrTarget,
    arrProgress: `${arrProgress}%`,
    usersNeededForTarget: {
      allPro: Math.ceil(arrTarget / (29 * 12)),
      allEnterprise: Math.ceil(arrTarget / (199 * 12)),
      mixed: Math.ceil(arrTarget / (80 * 12)), // ~$80 ARPU estimate
    },
    timeline,
    topTraders,
  });
}

/** POST /api/admin/users/:id/tier — body: { tier } — manual tier override */
async function handleAdminSetTier(
  req: IncomingMessage,
  res: ServerResponse,
  targetUserId: string,
  userStore: UserStore,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const tier = body['tier'] as string | undefined;
  const validTiers: Tier[] = ['free', 'pro', 'enterprise'];
  if (!tier || !validTiers.includes(tier as Tier)) {
    sendJson(res, 400, { error: 'Invalid tier', valid: validTiers });
    return;
  }

  const updated = userStore.updateTier(targetUserId, tier as Tier);
  if (!updated) {
    sendJson(res, 404, { error: 'User not found', userId: targetUserId });
    return;
  }

  sendJson(res, 200, { ok: true, userId: targetUserId, tier });
}


// ─── Batch license issuance ───────────────────────────────────────────────────

interface BatchCustomerInput {
  email: string;
  tier?: Tier;
  password?: string;
}

interface BatchResult {
  email: string;
  apiKey: string;
  userId: string;
  status: 'created' | 'existing';
}

/**
 * POST /api/admin/licenses/batch
 * Issue API keys/licenses for up to 50 customers in one call.
 * Existing users are returned as-is (status: existing), new users are created.
 */
async function handleBatchLicenses(
  req: IncomingMessage,
  res: ServerResponse,
  userStore: UserStore,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const customers = body['customers'] as BatchCustomerInput[] | undefined;
  if (!Array.isArray(customers) || customers.length === 0) {
    sendJson(res, 400, { error: 'customers must be a non-empty array' });
    return;
  }
  if (customers.length > 50) {
    sendJson(res, 400, { error: 'Max 50 customers per batch', received: customers.length });
    return;
  }

  const defaultTier = ((body['defaultTier'] as string) || 'free') as Tier;
  const defaultPassword = (body['defaultPassword'] as string) || 'CashClaw2026!';
  const validTiers: Tier[] = ['free', 'pro', 'enterprise'];

  const results: BatchResult[] = [];
  let created = 0;
  let existing = 0;

  for (const customer of customers) {
    if (!customer.email || typeof customer.email !== 'string') continue;
    const email = customer.email.toLowerCase().trim();
    const tier: Tier = validTiers.includes(customer.tier as Tier) ? customer.tier as Tier : defaultTier;

    // Check if user already exists
    const existingUser = userStore.getUserByEmail(email);
    if (existingUser) {
      results.push({ email, apiKey: existingUser.apiKey, userId: existingUser.id, status: 'existing' });
      existing++;
      continue;
    }

    // Create new user with password
    const password = customer.password === 'auto' || !customer.password ? defaultPassword : customer.password;
    const passwordHash = await hashPassword(password);
    const newUser = userStore.createUserWithPassword(email, passwordHash, tier);
    results.push({ email, apiKey: newUser.apiKey, userId: newUser.id, status: 'created' });
    created++;
  }

  sendJson(res, 200, {
    total: customers.length,
    created,
    existing,
    results,
  });
}

// ─── Main admin route dispatcher ──────────────────────────────────────────────

/**
 * Handle all /api/admin/* routes.
 * userId and userTier are resolved by auth middleware before this is called.
 */
export async function handleAdminRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
  userTier: Tier,
  userStore: UserStore,
  pathname: string,
): Promise<void> {
  // Gate: verify admin privileges
  if (!isAdminUser(userId, userTier, userStore)) {
    sendForbidden(res);
    return;
  }

  const method = req.method ?? 'GET';
  const analytics = new AdminAnalytics(userStore);

  // GET /api/admin/stats
  if (pathname === '/api/admin/stats') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleAdminStats(res, analytics);
    return;
  }

  // GET /api/admin/users
  if (pathname === '/api/admin/users') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleAdminUsers(res, userStore);
    return;
  }

  // GET /api/admin/revenue
  if (pathname === '/api/admin/revenue') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleAdminRevenue(res, analytics);
    return;
  }

  // POST /api/admin/users/:id/tier
  const tierMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)\/tier$/);
  if (tierMatch) {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    await handleAdminSetTier(req, res, tierMatch[1]!, userStore);
    return;
  }

  // POST /api/admin/license/issue — admin creates license for any user
  if (pathname === '/api/admin/license/issue' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const targetUserId = (body['userId'] as string) || `customer_${Date.now()}`;
      const tier = (body['tier'] as string) || 'pro';
      const days = parseInt(String(body['days'] ?? '30'), 10);
      const validTiers: Tier[] = ['free', 'pro', 'enterprise'];
      if (!validTiers.includes(tier as Tier)) {
        sendJson(res, 400, { error: 'Invalid tier', valid: validTiers });
        return;
      }
      const licenseSecret = process.env['LICENSE_SECRET'] ?? 'license-secret-change-me';
      initLicenseStore(process.env['LICENSE_DB_PATH'] ?? 'data/licenses.db');
      const now = Date.now();
      const payload = buildPayload({
        userId: targetUserId,
        tier: tier as Tier,
        issuedAt: now,
        expiresAt: now + days * 24 * 60 * 60 * 1000,
      });
      const key = generateLicense(payload, licenseSecret);
      saveLicense(key, payload);
      sendJson(res, 201, {
        key,
        userId: targetUserId,
        tier,
        days,
        expiresAt: new Date(payload.expiresAt).toISOString(),
        maxMarkets: payload.maxMarkets,
        maxTradesPerDay: payload.maxTradesPerDay,
        features: payload.features,
      });
    } catch {
      sendJson(res, 400, { error: 'Invalid request body' });
    }
    return;
  }

  // GET /api/admin/licenses — list all active licenses
  if (pathname === '/api/admin/licenses' && method === 'GET') {
    initLicenseStore(process.env['LICENSE_DB_PATH'] ?? 'data/licenses.db');
    const licenses = getActiveLicenses();
    sendJson(res, 200, {
      licenses: licenses.map(l => ({
        keyPreview: l.key.slice(0, 20) + '...',
        fullKey: l.key,
        userId: l.userId,
        tier: l.tier,
        issuedAt: new Date(l.issuedAt).toISOString(),
        expiresAt: new Date(l.expiresAt).toISOString(),
        revoked: l.revoked === 1,
      })),
      count: licenses.length,
    });
    return;
  }

  // POST /api/admin/license/revoke — admin revokes any license
  if (pathname === '/api/admin/license/revoke' && method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const key = body['key'] as string;
      if (!key) { sendJson(res, 400, { error: 'Missing "key" field' }); return; }
      initLicenseStore(process.env['LICENSE_DB_PATH'] ?? 'data/licenses.db');
      const revoked = revokeLicenseKey(key);
      sendJson(res, 200, { revoked });
    } catch {
      sendJson(res, 400, { error: 'Invalid request body' });
    }
    return;
  }

  // POST /api/admin/licenses/batch — issue API keys for multiple customers at once
  if (pathname === '/api/admin/licenses/batch' && method === 'POST') {
    await handleBatchLicenses(req, res, userStore);
    return;
  }

  sendNotFound(res);
}
