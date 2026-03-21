// Auth middleware: JWT token creation/validation + API key lookup via user-store
// Uses Node.js built-in crypto only (no external jwt library)
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHmac, timingSafeEqual as cryptoTimingSafeEqual, randomBytes } from 'node:crypto';
import { parse } from 'node:url';
import type { UserStore, User } from '../users/user-store.js';
import type { Tier } from '../users/subscription-tier.js';

/** Augment IncomingMessage with resolved user */
export interface AuthenticatedRequest extends IncomingMessage {
  user?: { id: string; email: string; tier: Tier };
}

/** Public endpoints that skip authentication */
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/webhooks/polar',
  '/api/auth/register',
  '/api/auth/login',
  '/api/docs',
  '/api/docs/openapi.json',
  '/api/metrics',
]);

/**
 * Prefix-based public paths (dynamic segments like :userId).
 * Auth middleware skips these when pathname starts with any listed prefix.
 */
const PUBLIC_PATH_PREFIXES = [
  '/api/webhooks/tradingview/',
];

// ─── JWT helpers (HS256, Node.js crypto) ─────────────────────────────────────

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    '=',
  );
  return Buffer.from(padded, 'base64').toString('utf8');
}

interface JwtPayload {
  sub: string;   // user id
  email: string;
  tier: Tier;
  iat: number;
  exp: number;
}

/** Create a signed JWT (HS256). Expires in `expiresInSeconds` (default 1h). */
export function createJwt(
  user: Pick<User, 'id' | 'email' | 'tier'>,
  secret: string,
  expiresInSeconds = 3600,
): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({ sub: user.id, email: user.email, tier: user.tier, iat: now, exp: now + expiresInSeconds } satisfies JwtPayload),
  );
  const unsigned = `${header}.${payload}`;
  const sig = base64url(
    createHmac('sha256', secret).update(unsigned).digest(),
  );
  return `${unsigned}.${sig}`;
}

/**
 * Validate a JWT and return its payload.
 * Returns null if signature invalid, malformed, or expired.
 */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, sigB64] = parts;
  const unsigned = `${headerB64}.${payloadB64}`;
  const expectedSig = base64url(
    createHmac('sha256', secret).update(unsigned).digest(),
  );

  // Constant-time comparison
  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!cryptoTimingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64)) as JwtPayload;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) return null;

  return payload;
}

/** Generate a cryptographically random API key token (hex, 32 bytes) */
export function generateApiKeyToken(): string {
  return randomBytes(32).toString('hex');
}

// ─── Express-compatible middleware ────────────────────────────────────────────

/** Send 401 Unauthorized JSON */
function sendUnauthorized(res: ServerResponse, message: string): void {
  const body = JSON.stringify({ error: 'Unauthorized', message });
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Create auth middleware that resolves user from:
 *   1. Bearer <jwt> in Authorization header
 *   2. API key in Authorization header: "ApiKey <key>"
 *   3. Legacy X-API-Key header (API key)
 *
 * Attaches `req.user` on success. Sends 401 and returns false on failure.
 * Public paths bypass auth entirely.
 */
export function createAuthMiddleware(userStore: UserStore, jwtSecret: string) {
  return function authMiddleware(
    req: AuthenticatedRequest,
    res: ServerResponse,
    next: () => void,
  ): void {
    const parsed = parse(req.url ?? '/');
    const pathname = parsed.pathname ?? '/';

    if (PUBLIC_PATHS.has(pathname) ||
        PUBLIC_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
      next();
      return;
    }

    const authHeader = req.headers['authorization'];
    const legacyKey = req.headers['x-api-key'];

    // 1. Bearer JWT
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const payload = verifyJwt(token, jwtSecret);
      if (!payload) {
        sendUnauthorized(res, 'Invalid or expired JWT token');
        return;
      }
      req.user = { id: payload.sub, email: payload.email, tier: payload.tier };
      next();
      return;
    }

    // 2. ApiKey <key> in Authorization header
    if (authHeader?.startsWith('ApiKey ')) {
      const key = authHeader.slice(7);
      const user = userStore.getUserByApiKey(key);
      if (!user) {
        sendUnauthorized(res, 'Invalid API key');
        return;
      }
      req.user = { id: user.id, email: user.email, tier: user.tier };
      next();
      return;
    }

    // 3. Legacy X-API-Key header
    if (legacyKey) {
      const key = Array.isArray(legacyKey) ? legacyKey[0] : legacyKey;
      const user = userStore.getUserByApiKey(key);
      if (!user) {
        sendUnauthorized(res, 'Invalid API key');
        return;
      }
      req.user = { id: user.id, email: user.email, tier: user.tier };
      next();
      return;
    }

    sendUnauthorized(res, 'Missing Authorization header or X-API-Key');
  };
}
