// API key authentication middleware for REST API
// Validates X-API-Key header against API_SECRET env var
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse } from 'node:url';

/** Public endpoints that skip authentication */
const PUBLIC_PATHS = new Set(['/api/health']);

/**
 * Validate API key from X-API-Key header.
 * Returns true if request is authorized, false otherwise.
 * Sends 401 response automatically when unauthorized.
 */
export function validateApiKey(req: IncomingMessage, res: ServerResponse): boolean {
  const parsed = parse(req.url ?? '/');
  const pathname = parsed.pathname ?? '/';

  // Allow public endpoints without auth
  if (PUBLIC_PATHS.has(pathname)) {
    return true;
  }

  const secret = process.env['API_SECRET'];

  // If no API_SECRET configured, reject all non-public requests
  if (!secret) {
    sendUnauthorized(res, 'API_SECRET not configured on server');
    return false;
  }

  const provided = req.headers['x-api-key'];

  if (!provided) {
    sendUnauthorized(res, 'Missing X-API-Key header');
    return false;
  }

  // Constant-time comparison to avoid timing attacks
  if (!timingSafeEqual(String(provided), secret)) {
    sendUnauthorized(res, 'Invalid API key');
    return false;
  }

  return true;
}

/** Send 401 Unauthorized JSON response */
function sendUnauthorized(res: ServerResponse, message: string): void {
  const body = JSON.stringify({ error: 'Unauthorized', message });
  res.writeHead(401, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Simple constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
