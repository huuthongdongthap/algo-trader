// Response cache middleware — wraps the HTTP handler with in-memory TTL cache
// Only caches GET requests; POST/PUT/DELETE pass through uncached
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ResponseCache, getTtlForRoute } from './response-cache.js';

let _cache: ResponseCache | null = null;

/** Initialize the shared response cache (call once at startup) */
export function initResponseCache(maxEntries = 500, defaultTtlMs = 5_000): ResponseCache {
  _cache = new ResponseCache({ maxEntries, defaultTtlMs });
  return _cache;
}

/** Get the shared cache instance (for stats/invalidation) */
export function getResponseCache(): ResponseCache | null {
  return _cache;
}

/**
 * Cache middleware for GET requests.
 * Returns true if response was served from cache (caller should skip handler).
 * Returns false if cache miss (caller should proceed to handler).
 */
export function tryCacheHit(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): boolean {
  if (!_cache || req.method !== 'GET') return false;

  const entry = _cache.get(pathname);
  if (!entry) return false;

  res.writeHead(200, {
    'Content-Type': entry.contentType,
    'Content-Length': Buffer.byteLength(entry.data),
    'X-Cache': 'HIT',
  });
  res.end(entry.data);
  return true;
}

/**
 * Store a response in cache after handler completes.
 * Call this after writing the response body for cacheable GET endpoints.
 */
export function cacheResponse(pathname: string, data: string, contentType = 'application/json'): void {
  if (!_cache) return;
  const ttl = getTtlForRoute(pathname);
  _cache.set(pathname, data, contentType, ttl);
}
