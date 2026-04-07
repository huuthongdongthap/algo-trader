// HTTP server for marketing landing page: serves static files only
// Pure node:http + node:fs — no Express, no dependencies
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../core/logger.js';

/** Map file extensions to MIME content-types */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.json': 'application/json; charset=utf-8',
};

const PUBLIC_DIR = join(fileURLToPath(import.meta.url), '..', 'public');
const UI_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'ui');

/** Serve a static file from public/ directory; 404 on missing */
async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
  try {
    const content = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    });
    res.end(content);
  } catch {
    const body = '404 Not Found';
    res.writeHead(404, {
      'Content-Type': 'text/plain',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }
}

/** Send a plain text error response */
function sendError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, {
    'Content-Type': 'text/plain',
    'Content-Length': Buffer.byteLength(message),
  });
  res.end(message);
}

/**
 * Create and start the landing page HTTP server.
 * Serves static files from src/landing/public/.
 * Defaults to index.html for root path.
 * @param port - TCP port to listen on
 * @returns running http.Server instance
 */
export function createLandingServer(port: number): Server {
  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // Only allow GET requests
    if (method !== 'GET') {
      sendError(res, 405, 'Method Not Allowed');
      return;
    }

    try {
      // Map root path to index.html; strip query strings
      const urlPath = url.split('?')[0] ?? '/';
      const staticPath = urlPath === '/' ? '/index.html' : urlPath;

      // Serve design system files from src/ui/ for /ui/* paths
      if (staticPath.startsWith('/ui/')) {
        const uiPath = resolve(UI_DIR, staticPath.slice(4));
        if (!uiPath.startsWith(resolve(UI_DIR))) { sendError(res, 403, 'Forbidden'); return; }
        await serveStatic(res, uiPath);
        return;
      }

      // Prevent directory traversal attacks
      const safePath = resolve(PUBLIC_DIR, staticPath.slice(1));
      if (!safePath.startsWith(resolve(PUBLIC_DIR))) { sendError(res, 403, 'Forbidden'); return; }

      await serveStatic(res, safePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendError(res, 500, `Internal Server Error: ${message}`);
    }
  });

  server.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}`, 'Landing');
  });

  return server;
}

/**
 * Gracefully shut down the landing server.
 */
export function stopLandingServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err != null) reject(err);
      else resolve();
    });
  });
}
