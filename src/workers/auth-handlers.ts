/**
 * CashClaw standalone auth handlers — KV-backed, zero VPS required.
 */

import { hashPassword, verifyPassword, createJwt, verifyJwt } from './crypto-utils';

interface Env { CACHE: KVNamespace; JWT_SECRET?: string; }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function getSecret(env: Env): string {
  return env.JWT_SECRET || 'cashclaw-dev-secret-not-for-prod';
}

interface StoredUser {
  id: string;
  email: string;
  hash: string;
  salt: string;
  tier: string;
  role: 'admin' | 'user';
  tenantId: string;
  apiKey: string;
  createdAt: string;
}

export async function handleSignup(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email?: string; password?: string; tier?: string };
    const { email, password, tier = 'free' } = body;

    if (!email || !password) return json({ error: 'Email and password required' }, 400);
    if (password.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const existing = await env.CACHE.get(`user:${email}`);
    if (existing) return json({ error: 'Email already registered' }, 409);

    const { hash, salt } = await hashPassword(password);
    const tenantId = `t_${crypto.randomUUID().split('-')[0]}`;
    const apiKey = `ck_${crypto.randomUUID().replace(/-/g, '')}`;
    const id = crypto.randomUUID();

    const role = 'user' as const;
    const user: StoredUser = { id, email, hash, salt, tier, role, tenantId, apiKey, createdAt: new Date().toISOString() };
    await env.CACHE.put(`user:${email}`, JSON.stringify(user));

    const token = await createJwt({ sub: email, tenantId, tier, role }, getSecret(env));
    return json({ token, tenantId, email, tier, role, apiKey }, 201);
  } catch (e) {
    return json({ error: (e as Error).message || 'Signup failed' }, 500);
  }
}

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) return json({ error: 'Email and password required' }, 400);

    const stored = await env.CACHE.get(`user:${email}`);
    if (!stored) return json({ error: 'Invalid credentials' }, 401);

    const user = JSON.parse(stored) as StoredUser;
    const valid = await verifyPassword(password, user.hash, user.salt);
    if (!valid) return json({ error: 'Invalid credentials' }, 401);

    const role = user.role || 'user';
    const token = await createJwt({ sub: email, tenantId: user.tenantId, tier: user.tier, role }, getSecret(env));
    return json({ token, tenantId: user.tenantId, email: user.email, tier: user.tier, role });
  } catch (e) {
    return json({ error: (e as Error).message || 'Login failed' }, 500);
  }
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJwt(auth.slice(7), getSecret(env));
  if (!payload) return json({ error: 'Invalid or expired token' }, 401);

  return json({ tenantId: payload.tenantId, email: payload.sub, tier: payload.tier, role: payload.role || 'user' });
}

/** Admin: list all users (requires admin API key) */
export async function handleListUsers(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get('x-api-key');
  const adminKey = (env as any).ADMIN_API_KEY;
  if (!apiKey || !adminKey || apiKey !== adminKey) return json({ error: 'Unauthorized' }, 401);

  const list = await env.CACHE.list({ prefix: 'user:' });
  const users = [];
  for (const key of list.keys) {
    const raw = await env.CACHE.get(key.name);
    if (raw) {
      const u = JSON.parse(raw) as StoredUser;
      users.push({ email: u.email, tier: u.tier, role: u.role || 'user', tenantId: u.tenantId, createdAt: u.createdAt });
    }
  }
  return json({ users });
}

/** Admin: set user role (requires admin API key) */
export async function handleSetRole(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get('x-api-key');
  const adminKey = (env as any).ADMIN_API_KEY;
  if (!apiKey || !adminKey || apiKey !== adminKey) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json() as { email?: string; role?: string };
  if (!body.email || !body.role) return json({ error: 'email and role required' }, 400);
  if (body.role !== 'admin' && body.role !== 'user') return json({ error: 'role must be admin or user' }, 400);

  const raw = await env.CACHE.get(`user:${body.email}`);
  if (!raw) return json({ error: 'User not found' }, 404);

  const user = JSON.parse(raw) as StoredUser;
  user.role = body.role as 'admin' | 'user';
  await env.CACHE.put(`user:${body.email}`, JSON.stringify(user));

  return json({ success: true, email: user.email, role: user.role });
}

/** Admin: delete user (requires admin API key) */
export async function handleDeleteUser(request: Request, env: Env): Promise<Response> {
  const apiKey = request.headers.get('x-api-key');
  const adminKey = (env as any).ADMIN_API_KEY;
  if (!apiKey || !adminKey || apiKey !== adminKey) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json() as { email?: string };
  if (!body.email) return json({ error: 'email required' }, 400);

  await env.CACHE.delete(`user:${body.email}`);
  return json({ success: true, deleted: body.email });
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function notImplementedResponse(path: string): Response {
  return json({ error: `${path} — backend chưa được cấu hình`, hint: 'Set VPS_ORIGIN secret to enable full API' }, 501);
}
