// HTTP server for algo-trade RaaS (Remote as a Service) REST API
// Pure Node.js http module - no Express or external framework
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { parse } from 'node:url';
import { TradingEngine } from '../engine/engine.js';
import { validateApiKey } from './auth-middleware.js';
import { handleRequest } from './routes.js';

/** CORS headers applied to every response */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': process.env['CORS_ORIGIN'] ?? '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
  'Access-Control-Max-Age': '86400',
};

/** Apply CORS headers to response */
function applyCors(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

/**
 * Create and start the REST API HTTP server.
 * @param port - TCP port to listen on (default: 3000)
 * @param engine - TradingEngine instance to expose via API
 * @returns running http.Server instance
 */
export function createServer(port: number, engine: TradingEngine): Server {
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    applyCors(res);

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsed = parse(req.url ?? '/');
    const pathname = parsed.pathname ?? '/';

    // Authenticate all non-public requests
    if (!validateApiKey(req, res)) {
      return; // 401 already sent by middleware
    }

    try {
      await handleRequest(req, res, engine, pathname);
    } catch (err) {
      // Unhandled error fallback - avoid leaking stack traces
      const message = err instanceof Error ? err.message : 'Internal server error';
      if (!res.headersSent) {
        const body = JSON.stringify({ error: 'Internal Server Error', message });
        res.writeHead(500, {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        });
        res.end(body);
      }
    }
  });

  server.listen(port, () => {
    console.log(`[API] Server listening on port ${port}`);
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
