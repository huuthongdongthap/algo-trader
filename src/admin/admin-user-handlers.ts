// Admin user management handlers: list, detail, ban, upgrade tier
// Called from admin-routes.ts after admin auth is validated
import type { IncomingMessage, ServerResponse } from 'node:http';
import { UserStore } from '../users/user-store.js';
import type { Tier } from '../users/subscription-tier.js';

// ─── Response helpers (local) ─────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

/** GET /admin/users — list all active users (apiKey redacted) */
export function handleListUsers(res: ServerResponse, userStore: UserStore): void {
  const users = userStore.listActiveUsers();
  const safeUsers = users.map(u => ({
    id: u.id,
    email: u.email,
    tier: u.tier,
    createdAt: u.createdAt,
    active: u.active,
    apiKeyPrefix: u.apiKey.slice(0, 8) + '…',
  }));
  sendJson(res, 200, { users: safeUsers, count: safeUsers.length });
}

/** GET /admin/users/:id — single user detail (apiKey redacted) */
export function handleGetUser(res: ServerResponse, userId: string, userStore: UserStore): void {
  const user = userStore.getUserById(userId);
  if (!user) {
    sendJson(res, 404, { error: 'User not found', id: userId });
    return;
  }
  sendJson(res, 200, {
    id: user.id,
    email: user.email,
    tier: user.tier,
    createdAt: user.createdAt,
    active: user.active,
    apiKeyPrefix: user.apiKey.slice(0, 8) + '…',
  });
}

/** POST /admin/users/:id/ban — soft-delete (deactivate) a user */
export function handleBanUser(res: ServerResponse, userId: string, userStore: UserStore): void {
  const user = userStore.getUserById(userId);
  if (!user) {
    sendJson(res, 404, { error: 'User not found', id: userId });
    return;
  }
  const ok = userStore.deactivateUser(userId);
  sendJson(res, 200, { ok, userId, action: 'banned' });
}

/** POST /admin/users/:id/upgrade — change subscription tier */
export async function handleUpgradeUser(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
  userStore: UserStore,
): Promise<void> {
  let body: { tier?: string };
  try {
    body = await readJsonBody<{ tier?: string }>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const validTiers: Tier[] = ['free', 'pro', 'enterprise'];
  const tier = body.tier as Tier | undefined;

  if (!tier || !validTiers.includes(tier)) {
    sendJson(res, 400, { error: 'Invalid tier', valid: validTiers });
    return;
  }

  const user = userStore.getUserById(userId);
  if (!user) {
    sendJson(res, 404, { error: 'User not found', id: userId });
    return;
  }

  const ok = userStore.updateTier(userId, tier);
  sendJson(res, 200, { ok, userId, tier, action: 'upgraded' });
}
