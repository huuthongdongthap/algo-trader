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

    const user: StoredUser = { id, email, hash, salt, tier, tenantId, apiKey, createdAt: new Date().toISOString() };
    await env.CACHE.put(`user:${email}`, JSON.stringify(user));

    const token = await createJwt({ sub: email, tenantId, tier }, getSecret(env));
    return json({ token, tenantId, email, tier, apiKey }, 201);
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

    const token = await createJwt({ sub: email, tenantId: user.tenantId, tier: user.tier }, getSecret(env));
    return json({ token, tenantId: user.tenantId, email: user.email, tier: user.tier });
  } catch (e) {
    return json({ error: (e as Error).message || 'Login failed' }, 500);
  }
}

export async function handleMe(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization');
  if (!auth?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJwt(auth.slice(7), getSecret(env));
  if (!payload) return json({ error: 'Invalid or expired token' }, 401);

  return json({ tenantId: payload.tenantId, email: payload.sub, tier: payload.tier });
}

export function corsPreflightResponse(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function notImplementedResponse(path: string): Response {
  return json({ error: `${path} — backend chưa được cấu hình`, hint: 'Set VPS_ORIGIN secret to enable full API' }, 501);
}
