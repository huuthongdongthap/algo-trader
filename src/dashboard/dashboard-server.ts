// HTTP server for dashboard: serves static files + JSON API endpoints
// Pure node:http + node:fs — no Express
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardDataProvider } from './dashboard-data.js';

/** Map file extensions to MIME content-types */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
};

const PUBLIC_DIR = join(fileURLToPath(import.meta.url), '..', 'public');

/** Send JSON response */
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Serve a static file from the public directory */
async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    const body = '404 Not Found';
    res.writeHead(404, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
  }
}

/**
 * Create and start the dashboard HTTP server.
 * @param port - TCP port to listen on
 * @param dataProvider - DashboardDataProvider instance for API responses
 * @returns running http.Server instance
 */
export function createDashboardServer(port: number, dataProvider: DashboardDataProvider): Server {
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Only handle GET requests
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return;
    }

    try {
      // API routes
      if (url === '/dashboard/api/summary') {
        sendJson(res, 200, dataProvider.getSummary());
        return;
      }

      if (url === '/dashboard/api/equity-curve') {
        sendJson(res, 200, dataProvider.getEquityCurve());
        return;
      }

      if (url === '/dashboard/api/strategies') {
        sendJson(res, 200, dataProvider.getStrategyBreakdown());
        return;
      }

      // Static file serving — map / to index.html
      const staticPath = url === '/' ? '/index.html' : url;
      // Prevent directory traversal
      const safePath = join(PUBLIC_DIR, staticPath.replace(/\.\./g, ''));
      await serveStatic(res, safePath);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: 'Internal Server Error', message });
    }
  });

  server.listen(port, () => {
    console.log(`[Dashboard] Server listening on http://localhost:${port}`);
  });

  return server;
}

/**
 * Gracefully shut down the dashboard server.
 */
export function stopDashboardServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
