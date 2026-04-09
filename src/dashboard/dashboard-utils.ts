/**
 * Shared utilities for dashboard HTTP handlers
 */
import type { ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

/** Map file extensions to MIME content-types */
export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
};

/** Write a JSON response with correct Content-Type and Content-Length */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Serve a static file, returning 404 if not found */
export async function serveStatic(res: ServerResponse, filePath: string): Promise<void> {
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
