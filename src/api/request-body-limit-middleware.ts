/**
 * Request body size limit middleware — protects against large payload (DoS) attacks.
 * Buffers the full body, enforces size limit, then attaches buffered body to req
 * so downstream handlers can read it without re-consuming the stream.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

type NextFn = () => void;

// Extend IncomingMessage to carry pre-buffered body
declare module 'node:http' {
  interface IncomingMessage {
    _bodyBuffer?: Buffer;
  }
}

/**
 * Returns a middleware that enforces a maximum request body size.
 * Buffers the body and attaches it as req._bodyBuffer for reuse by handlers.
 * Responds with 413 Payload Too Large when the limit is exceeded.
 *
 * @param maxBytes - Maximum allowed body size in bytes (default: 1 MB)
 */
export function createBodyLimitMiddleware(
  maxBytes: number = DEFAULT_MAX_BYTES,
): (req: IncomingMessage, res: ServerResponse, next: NextFn) => void {
  return function bodyLimitMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: NextFn,
  ): void {
    const contentLength = req.headers['content-length'];

    // Fast-path: reject immediately if Content-Length header already exceeds limit
    if (contentLength !== undefined) {
      const declared = parseInt(contentLength, 10);
      if (!isNaN(declared) && declared > maxBytes) {
        sendPayloadTooLarge(res);
        return;
      }
    }

    // Buffer entire body, check size, attach to req for handler reuse
    const chunks: Buffer[] = [];
    let received = 0;
    let limitExceeded = false;

    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (!limitExceeded && received > maxBytes) {
        limitExceeded = true;
        sendPayloadTooLarge(res);
        req.destroy();
        return;
      }
      if (!limitExceeded) {
        chunks.push(chunk);
      }
    });

    req.on('end', () => {
      if (!limitExceeded) {
        // Attach buffered body so handlers don't need to re-read the stream
        req._bodyBuffer = Buffer.concat(chunks);
        next();
      }
    });

    req.on('error', () => {
      // Request already destroyed — nothing more to do
    });
  };
}

function sendPayloadTooLarge(res: ServerResponse): void {
  if (!res.headersSent) {
    res.writeHead(413, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Payload Too Large' }));
  }
}
