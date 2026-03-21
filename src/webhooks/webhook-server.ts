// Webhook HTTP server - receives trading signals on a dedicated port
// Uses node:http only, no external dependencies
// Supports TradingView, generic, and custom signal formats
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { parse } from 'node:url';
import type { TradingSignal } from './signal-parser.js';
import {
  parseTradingViewAlert,
  parseGenericSignal,
  parseCustomSignal,
} from './signal-parser.js';
import type { SignalTemplate } from './signal-parser.js';

/** Callback invoked for each validated incoming signal */
export type SignalHandler = (signal: TradingSignal) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Rate limiter - max 60 signals/minute per source IP
// ---------------------------------------------------------------------------

const rateLimitWindow = 60_000; // 1 minute in ms
const rateLimitMax = 60;
const ipCounters = new Map<string, { count: number; windowStart: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounters.get(ip);

  if (!entry || now - entry.windowStart >= rateLimitWindow) {
    ipCounters.set(ip, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= rateLimitMax) return true;

  entry.count++;
  return false;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract client IP from request */
function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/** Read full request body as string */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Send JSON response */
function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Verify X-Webhook-Secret header against WEBHOOK_SECRET env var */
function verifyWebhookSecret(req: IncomingMessage): boolean {
  const secret = process.env['WEBHOOK_SECRET'];
  if (!secret) return true; // No secret configured → allow all (dev mode)

  const provided = req.headers['x-webhook-secret'];
  if (!provided || typeof provided !== 'string') return false;

  // Constant-time comparison
  if (provided.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) {
    mismatch |= provided.charCodeAt(i) ^ secret.charCodeAt(i);
  }
  return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

async function handleWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  onSignal: SignalHandler,
): Promise<void> {
  const { method } = req;
  const parsed = parse(req.url ?? '/', true);
  const pathname = parsed.pathname ?? '/';

  // Only POST allowed on webhook endpoints
  if (method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  // Rate limit check
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    sendJson(res, 429, { error: 'Too Many Requests', message: 'Max 60 signals/minute' });
    return;
  }

  // Auth check
  if (!verifyWebhookSecret(req)) {
    sendJson(res, 401, { error: 'Unauthorized', message: 'Invalid X-Webhook-Secret' });
    return;
  }

  // Parse body
  let body: unknown;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    sendJson(res, 400, { error: 'Bad Request', message: 'Invalid JSON body' });
    return;
  }

  // Route to correct parser
  let signal: TradingSignal | null = null;

  if (pathname === '/webhook/tradingview') {
    signal = parseTradingViewAlert(body);
  } else if (pathname === '/webhook/signal') {
    signal = parseGenericSignal(body);
  } else if (pathname === '/webhook/custom') {
    // Template passed as query param (JSON-encoded)
    const tmplParam = parsed.query['template'];
    if (!tmplParam || typeof tmplParam !== 'string') {
      sendJson(res, 400, { error: 'Bad Request', message: 'Missing ?template= query param' });
      return;
    }
    let template: SignalTemplate;
    try {
      template = JSON.parse(tmplParam) as SignalTemplate;
    } catch {
      sendJson(res, 400, { error: 'Bad Request', message: 'Invalid template JSON' });
      return;
    }
    signal = parseCustomSignal(body, template);
  } else {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  if (!signal) {
    sendJson(res, 422, { error: 'Unprocessable Entity', message: 'Signal validation failed' });
    return;
  }

  try {
    await onSignal(signal);
    sendJson(res, 200, { ok: true, symbol: signal.symbol, side: signal.side });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Handler error';
    sendJson(res, 500, { error: 'Internal Server Error', message });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create and start the webhook HTTP server on a dedicated port.
 * @param port - TCP port to listen on
 * @param onSignal - Callback invoked for each valid incoming signal
 * @returns running http.Server instance
 */
export function createWebhookServer(port: number, onSignal: SignalHandler): Server {
  const server = createHttpServer((req, res) => {
    handleWebhookRequest(req, res, onSignal).catch((err) => {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal Server Error', message });
      }
    });
  });

  server.listen(port, () => {
    console.log(`[Webhook] Server listening on port ${port}`);
  });

  return server;
}

/**
 * Gracefully stop the webhook server.
 */
export function stopWebhookServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}
