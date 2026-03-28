/**
 * Cloudflare Workers Edge Proxy + Standalone Auth
 * When VPS_ORIGIN is set: proxies to backend
 * When not set: handles auth + basic data locally via KV
 */

import { handleSignup, handleLogin, handleMe, handleListUsers, handleSetRole, handleDeleteUser, corsPreflightResponse, notImplementedResponse } from './auth-handlers';

interface Env {
  CACHE: KVNamespace;
  ENVIRONMENT: string;
  VPS_ORIGIN?: string;
  JWT_SECRET?: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json',
};

const CACHE_TTL = 60;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') return corsPreflightResponse();

    // Health check
    if (path === '/health' || path === '/api/health') {
      return new Response(JSON.stringify({
        status: 'ok', edge: 'cloudflare', environment: env.ENVIRONMENT,
        hasVps: !!env.VPS_ORIGIN, timestamp: new Date().toISOString(),
      }), { headers: CORS });
    }

    // Auth routes — always handled locally (KV-backed)
    if (path === '/api/auth/signup' && request.method === 'POST') return handleSignup(request, env);
    if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
    if (path === '/api/auth/me' && request.method === 'GET') return handleMe(request, env);
    if (path === '/api/auth/users' && request.method === 'GET') return handleListUsers(request, env);
    if (path === '/api/auth/role' && request.method === 'POST') return handleSetRole(request, env);
    if (path === '/api/auth/delete' && request.method === 'POST') return handleDeleteUser(request, env);

    // Markets placeholder
    if (path === '/api/markets' && request.method === 'GET') {
      return new Response(JSON.stringify({ markets: [] }), { headers: CORS });
    }

    // Settings save — store in KV
    if (path.match(/^\/api\/tenants\/[^/]+\/config$/) && request.method === 'POST') {
      try {
        const body = await request.json();
        const tenantId = path.split('/')[3];
        await env.CACHE.put(`config:${tenantId}`, JSON.stringify(body));
        return new Response(JSON.stringify({ saved: true }), { headers: CORS });
      } catch {
        return new Response(JSON.stringify({ error: 'Failed to save' }), { status: 500, headers: CORS });
      }
    }

    // If VPS_ORIGIN is set, proxy remaining API requests
    if (env.VPS_ORIGIN && path.startsWith('/api/')) {
      // Webhook routes — no caching
      if (path.startsWith('/api/webhooks/')) return proxyToOrigin(request, env);

      // GET requests — cache at edge
      if (request.method === 'GET') {
        const cacheKey = `cache:${path}:${url.search}`;
        const cached = await env.CACHE.get(cacheKey);
        if (cached) {
          return new Response(cached, { headers: { ...CORS, 'X-Cache': 'HIT' } });
        }
        const response = await proxyToOrigin(request, env);
        if (response.ok) {
          const body = await response.text();
          await env.CACHE.put(cacheKey, body, { expirationTtl: CACHE_TTL });
          return new Response(body, { headers: { ...CORS, 'X-Cache': 'MISS' } });
        }
        return response;
      }

      return proxyToOrigin(request, env);
    }

    // No VPS — return 501 for unhandled API routes
    if (path.startsWith('/api/')) return notImplementedResponse(path);

    // Non-API routes — 404
    return new Response('Not Found', { status: 404 });
  },
};

async function proxyToOrigin(request: Request, env: Env): Promise<Response> {
  const origin = env.VPS_ORIGIN!;
  const url = new URL(request.url);
  const target = new URL(origin);
  url.protocol = target.protocol;
  url.host = target.host;
  url.port = target.port;

  return fetch(url.toString(), {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });
}
