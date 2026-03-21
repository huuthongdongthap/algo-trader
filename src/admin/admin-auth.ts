// Admin authentication: validates X-Admin-Key header vs ADMIN_SECRET env var
// Separate from API key auth — admin key grants full platform control
import type { IncomingMessage, ServerResponse } from 'node:http';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Typed error for admin auth failures */
export class AdminAuthError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 = 401,
  ) {
    super(message);
    this.name = 'AdminAuthError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/** Send 401/403 JSON response */
function sendDenied(res: ServerResponse, error: AdminAuthError): void {
  const body = JSON.stringify({ error: 'Admin Auth Failed', message: error.message });
  res.writeHead(error.statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ─── Auth functions ───────────────────────────────────────────────────────────

/**
 * Validate X-Admin-Key header against ADMIN_SECRET env var.
 * Sends error response automatically and returns false when denied.
 */
export function validateAdminKey(req: IncomingMessage, res: ServerResponse): boolean {
  const secret = process.env['ADMIN_SECRET'];

  if (!secret) {
    const err = new AdminAuthError('ADMIN_SECRET not configured on server', 403);
    sendDenied(res, err);
    return false;
  }

  const provided = req.headers['x-admin-key'];

  if (!provided || Array.isArray(provided)) {
    const err = new AdminAuthError('Missing X-Admin-Key header');
    sendDenied(res, err);
    return false;
  }

  if (!timingSafeEqual(provided, secret)) {
    const err = new AdminAuthError('Invalid admin key');
    sendDenied(res, err);
    return false;
  }

  return true;
}

/**
 * Check if a given API key has admin role.
 * Admin keys are prefixed with "admin_" convention or match ADMIN_SECRET.
 */
export function isAdmin(apiKey: string): boolean {
  const adminSecret = process.env['ADMIN_SECRET'];
  if (adminSecret && timingSafeEqual(apiKey, adminSecret)) return true;
  // Convention: keys prefixed with "admin_" are treated as admin keys
  return apiKey.startsWith('admin_');
}
