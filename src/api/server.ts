// HTTP server for algo-trade RaaS (Remote as a Service) REST API
// Middleware chain: CORS → Auth → RateLimit → Routes
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { parse } from 'node:url';
import { TradingEngine } from '../engine/engine.js';
import { logger } from '../core/logger.js';
import { createAuthMiddleware, type AuthenticatedRequest } from './auth-middleware.js';
import { createRateLimitMiddleware } from './api-rate-limiter-middleware.js';
import { handleRequest } from './routes.js';
import { UserStore } from '../users/user-store.js';
import { handleAdminRoutes } from './admin-routes.js';
import { LeaderBoard } from '../copy-trading/leader-board.js';
import { FollowerManager } from '../copy-trading/follower-manager.js';
import { seedDemoLeaders } from '../copy-trading/seed-demo-leaders.js';
import type { CopyTradingHandlers } from './copy-trading-routes.js';
import { applySecurityHeaders } from './security-headers-middleware.js';
import { createBodyLimitMiddleware } from './request-body-limit-middleware.js';
import { checkTierGate } from './tier-gate-middleware.js';
import { initResponseCache, tryCacheHit } from './response-cache-middleware.js';

// ─── CORS ─────────────────────────────────────────────────────────────────────

/**
 * Allowed origins: defaults to cashclaw.cc + localhost dev.
 * Override with CORS_ORIGIN env var (comma-separated list).
 */
const DEFAULT_ALLOWED_ORIGINS = new Set([
  'https://cashclaw.cc',
  'https://www.cashclaw.cc',
  'http://localhost:3000',
  'http://localhost:5173',
]);

function resolveAllowedOrigins(): Set<string> {
  const env = process.env['CORS_ORIGIN'];
  if (!env) return DEFAULT_ALLOWED_ORIGINS;
  const origins = env.split(',').map((o) => o.trim()).filter(Boolean);
  return new Set(origins);
}

const ALLOWED_ORIGINS = resolveAllowedOrigins();

/** Apply CORS headers; restricts to known origins, returns false on rejection */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers['origin'];

  // Reflect origin if in allowlist; deny unknown origins
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else if (!origin) {
    // Non-browser requests (curl, server-to-server) — allow
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  // Unknown browser origins get no ACAO header → browser blocks the request

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
  res.setHeader('Access-Control-Max-Age', '86400');
}

// ─── Error helper ─────────────────────────────────────────────────────────────

function sendInternalError(res: ServerResponse, message: string): void {
  if (res.headersSent) return;
  const body = JSON.stringify({ error: 'Internal Server Error', message });
  res.writeHead(500, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── Server factory ───────────────────────────────────────────────────────────

export interface ServerOptions {
  port: number;
  engine: TradingEngine;
  userStore: UserStore;
  /** JWT signing secret; defaults to JWT_SECRET env var */
  jwtSecret?: string;
  /** Optional shared LeaderBoard — if not provided, one is created internally */
  leaderBoard?: LeaderBoard;
}

/**
 * Create and start the REST API HTTP server with full middleware chain.
 * @returns running http.Server instance
 */
export function createServer(options: ServerOptions): Server;
/** Legacy overload: createServer(port, engine) — uses env-based UserStore */
export function createServer(port: number, engine: TradingEngine): Server;
export function createServer(
  portOrOptions: number | ServerOptions,
  legacyEngine?: TradingEngine,
): Server {
  let port: number;
  let engine: TradingEngine;
  let userStore: UserStore;
  let jwtSecret: string;

  if (typeof portOrOptions === 'number') {
    port = portOrOptions;
    engine = legacyEngine!;
    const dbPath = process.env['USER_DB_PATH'] ?? ':memory:';
    userStore = new UserStore(dbPath);
    jwtSecret = process.env['JWT_SECRET'] ?? 'dev-secret-change-me';
  } else {
    port = portOrOptions.port;
    engine = portOrOptions.engine;
    userStore = portOrOptions.userStore;
    jwtSecret = portOrOptions.jwtSecret ?? process.env['JWT_SECRET'] ?? 'dev-secret-change-me';
  }

  const authMiddleware = createAuthMiddleware(userStore, jwtSecret);
  const rateLimitMiddleware = createRateLimitMiddleware();
  const bodyLimitMiddleware = createBodyLimitMiddleware(1024 * 1024);

  // Response cache for hot GET paths (health, leaderboard, marketplace, metrics)
  initResponseCache(500, 5_000);

  // Copy-trading leaderboard + demo leaders (idempotent)
  const leaderBoard = (typeof portOrOptions !== 'number' && portOrOptions.leaderBoard) || new LeaderBoard();
  const followerManager = new FollowerManager(leaderBoard);
  const copyTradingHandlers: CopyTradingHandlers = { leaderBoard, followerManager };
  seedDemoLeaders(leaderBoard);

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    // 1. CORS headers on every response
    applyCors(req, res);

    // 2. API version header
    res.setHeader('X-API-Version', '1.0');

    // 3. Security hardening headers
    applySecurityHeaders(req, res);

    // 4. Handle CORS preflight immediately
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsed = parse(req.url ?? '/');
    const pathname = parsed.pathname ?? '/';

    // 4b. Response cache — serve cached GET responses before auth/rate-limit
    if (tryCacheHit(req, res, pathname)) return;

    // 5. Auth middleware — attaches req.user or sends 401
    let authPassed = false;
    authMiddleware(req as AuthenticatedRequest, res, () => { authPassed = true; });
    if (!authPassed) return;

    // 6. Rate limit middleware — checks per-user/per-IP sliding window
    let ratePassed = false;
    rateLimitMiddleware(req as AuthenticatedRequest, res, () => { ratePassed = true; });
    if (!ratePassed) return;

    // 7. Tier-based feature gating — block endpoints user's plan doesn't include
    if (!checkTierGate(req as AuthenticatedRequest, res, pathname)) return;

    // 8. Body size limit for POST requests
    if (req.method === 'POST') {
      let bodyPassed = false;
      await new Promise<void>((resolve) => {
        bodyLimitMiddleware(req, res, () => { bodyPassed = true; resolve(); });
        req.once('close', resolve);
      });
      if (!bodyPassed) return;
    }

    // 9. Route to handler
    try {
      // Admin routes: /api/admin/* — requires resolved user from auth middleware
      if (pathname.startsWith('/api/admin/') || pathname === '/api/admin') {
        const authedReq = req as AuthenticatedRequest;
        if (!authedReq.user) {
          sendInternalError(res, 'Auth middleware did not resolve user');
          return;
        }
        await handleAdminRoutes(
          req,
          res,
          authedReq.user.id,
          authedReq.user.tier,
          userStore,
          pathname,
        );
        return;
      }

      await handleRequest(req, res, engine, pathname, userStore, copyTradingHandlers);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendInternalError(res, message);
    }
  });

  server.listen(port, () => {
    logger.info(`Server listening on port ${port}`, 'ApiServer');
  });

  return server;
}

/**
 * Gracefully shut down the HTTP server.
 * Stops accepting new connections and waits for in-flight requests.
 */
export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
