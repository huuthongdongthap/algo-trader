// Shared HTTP response utilities for API route handlers
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Write a JSON response with correct Content-Type and Content-Length headers */
export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Read request body as raw string.
 * Uses req._bodyBuffer if body was pre-buffered by middleware (prevents double-consume bug).
 * Falls back to stream reading for requests that bypassed the buffer middleware.
 */
export function readBody(req: IncomingMessage): Promise<string> {
  // Use pre-buffered body from request-body-limit-middleware if available
  if ((req as IncomingMessage & { _bodyBuffer?: Buffer })._bodyBuffer !== undefined) {
    return Promise.resolve(
      (req as IncomingMessage & { _bodyBuffer?: Buffer })._bodyBuffer!.toString('utf8')
    );
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Read and parse the request body as JSON; resolves empty body as {} */
export async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  try {
    return raw ? (JSON.parse(raw) as T) : ({} as T);
  } catch {
    throw new Error('Invalid JSON body');
  }
}
