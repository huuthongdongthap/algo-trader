// Authentication route handlers: register, login, me, api-key rotation
// Uses Node.js crypto.scrypt for password hashing — no external dependencies
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UserStore } from '../users/user-store.js';
import { hashPassword, verifyPassword } from '../users/user-store.js';
import { createJwt } from './auth-middleware.js';
import type { AuthenticatedRequest } from './auth-middleware.js';
import { logger } from '../core/logger.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function resolveJwtSecret(): string {
  if (!process.env['JWT_SECRET']) {
    // Auto-generate a persistent secret on first run
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const secret = crypto.randomBytes(32).toString('hex');
    process.env['JWT_SECRET'] = secret;
    // Log warning so operator knows to set it explicitly
    logger.warn('JWT_SECRET not set — auto-generated ephemeral secret. Set JWT_SECRET env var for persistence across restarts.', 'AuthRoutes');
  }
  return process.env['JWT_SECRET']!;
}

// ─── Referral integration ────────────────────────────────────────────────────

import { ReferralStore } from '../referral/referral-store.js';
import { RewardCalculator } from '../referral/reward-calculator.js';
import { ReferralManager } from '../referral/referral-manager.js';
import { UtmAttributionTracker } from '../growth/utm-attribution-tracker.js';

let _referralManager: ReferralManager | null = null;
let _utmTracker: UtmAttributionTracker | null = null;

function getReferralManager(): ReferralManager {
  if (!_referralManager) {
    const dbPath = process.env['REFERRAL_DB_PATH'] ?? 'data/referral.db';
    const store = new ReferralStore(dbPath);
    const calc = new RewardCalculator(store);
    _referralManager = new ReferralManager(store, calc);
  }
  return _referralManager;
}

function getUtmTracker(): UtmAttributionTracker {
  if (!_utmTracker) {
    const dbPath = process.env['UTM_DB_PATH'] ?? 'data/utm.db';
    _utmTracker = new UtmAttributionTracker(dbPath);
  }
  return _utmTracker;
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────

export async function handleRegister(
  req: IncomingMessage,
  res: ServerResponse,
  userStore: UserStore,
): Promise<void> {
  let body: { email?: string; password?: string; confirmPassword?: string; referralCode?: string; utm_source?: string; utm_medium?: string; utm_campaign?: string; utm_content?: string };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { email, password, confirmPassword, referralCode } = body;

  if (!email || !password) {
    sendJson(res, 400, { error: 'email and password are required' });
    return;
  }
  if (password.length < 8) {
    sendJson(res, 400, { error: 'password must be at least 8 characters' });
    return;
  }
  if (confirmPassword !== undefined && confirmPassword !== password) {
    sendJson(res, 400, { error: 'passwords do not match' });
    return;
  }

  // Check duplicate email
  if (userStore.getUserByEmail(email)) {
    sendJson(res, 409, { error: 'Email already registered' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = userStore.createUserWithPassword(email.toLowerCase().trim(), passwordHash);
  const token = createJwt(user, resolveJwtSecret());

  // Auto-redeem referral code if provided
  let referral: { referrerId: string; code: string } | null = null;
  if (referralCode && typeof referralCode === 'string') {
    try {
      const mgr = getReferralManager();
      const link = mgr.redeemCode(referralCode.trim(), user.id);
      referral = { referrerId: link.referrerId, code: link.code };
    } catch {
      // Non-blocking: invalid/expired code doesn't prevent registration
    }
  }

  // Record UTM attribution (non-blocking)
  try {
    const utm = {
      source: body.utm_source ?? null,
      medium: body.utm_medium ?? null,
      campaign: body.utm_campaign ?? null,
      content: body.utm_content ?? null,
      term: null,
    };
    if (utm.source || utm.medium || utm.campaign || referralCode) {
      getUtmTracker().recordAttribution(user.id, utm, referralCode ?? null);
    }
  } catch { /* non-critical */ }

  sendJson(res, 201, {
    token,
    user: { id: user.id, email: user.email, tier: user.tier, role: user.role, apiKey: user.apiKey },
    ...(referral ? { referral } : {}),
  });
}

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

export async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  userStore: UserStore,
): Promise<void> {
  let body: { email?: string; password?: string };
  try {
    body = JSON.parse(await readBody(req)) as typeof body;
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { email, password } = body;
  if (!email || !password) {
    sendJson(res, 400, { error: 'email and password are required' });
    return;
  }

  const user = userStore.getUserByEmail(email.toLowerCase().trim());
  if (!user || !user.passwordHash) {
    sendJson(res, 401, { error: 'Invalid email or password' });
    return;
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    sendJson(res, 401, { error: 'Invalid email or password' });
    return;
  }

  const token = createJwt(user, resolveJwtSecret());
  sendJson(res, 200, {
    token,
    user: { id: user.id, email: user.email, tier: user.tier, role: user.role },
  });
}

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

export function handleMe(
  req: AuthenticatedRequest,
  res: ServerResponse,
  userStore: UserStore,
): void {
  if (!req.user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const user = userStore.getUserById(req.user.id);
  if (!user) {
    sendJson(res, 404, { error: 'User not found' });
    return;
  }

  sendJson(res, 200, {
    id: user.id,
    email: user.email,
    tier: user.tier,
    role: user.role,
    apiKey: user.apiKey,
    createdAt: user.createdAt,
  });
}

// ─── POST /api/auth/api-key ───────────────────────────────────────────────────

export function handleRotateApiKey(
  req: AuthenticatedRequest,
  res: ServerResponse,
  userStore: UserStore,
): void {
  if (!req.user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const newKey = userStore.generateApiKey(req.user.id);
  if (!newKey) {
    sendJson(res, 404, { error: 'User not found or inactive' });
    return;
  }

  sendJson(res, 200, { apiKey: newKey });
}
