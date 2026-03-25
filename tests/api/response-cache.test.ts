import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResponseCache, getTtlForRoute, ROUTE_TTL_MAP } from '../../src/api/response-cache.js';

describe('ResponseCache', () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxEntries: 5, defaultTtlMs: 1_000 });
  });

  it('should return null on cache miss', () => {
    expect(cache.get('/api/health')).toBeNull();
  });

  it('should store and retrieve entries', () => {
    cache.set('/api/health', '{"ok":true}');
    const entry = cache.get('/api/health');
    expect(entry).not.toBeNull();
    expect(entry!.data).toBe('{"ok":true}');
    expect(entry!.contentType).toBe('application/json');
  });

  it('should expire entries after TTL', () => {
    vi.useFakeTimers();
    cache.set('/api/health', '{"ok":true}', 'application/json', 500);

    expect(cache.get('/api/health')).not.toBeNull();

    vi.advanceTimersByTime(600);
    expect(cache.get('/api/health')).toBeNull();

    vi.useRealTimers();
  });

  it('should evict oldest entry when at capacity', () => {
    for (let i = 0; i < 5; i++) {
      cache.set(`/api/item/${i}`, `${i}`);
    }
    expect(cache.size).toBe(5);

    // Adding one more should evict the oldest (item/0)
    cache.set('/api/item/5', '5');
    expect(cache.size).toBe(5);
    expect(cache.get('/api/item/0')).toBeNull();
    expect(cache.get('/api/item/5')).not.toBeNull();
  });

  it('should refresh LRU order on get', () => {
    cache.set('/api/a', 'a');
    cache.set('/api/b', 'b');
    cache.set('/api/c', 'c');
    cache.set('/api/d', 'd');
    cache.set('/api/e', 'e');

    // Access /api/a to make it most recently used
    cache.get('/api/a');

    // Add new entry — should evict /api/b (oldest after a was refreshed)
    cache.set('/api/f', 'f');
    expect(cache.get('/api/a')).not.toBeNull();
    expect(cache.get('/api/b')).toBeNull();
  });

  it('should invalidate specific key', () => {
    cache.set('/api/x', 'data');
    expect(cache.invalidate('/api/x')).toBe(true);
    expect(cache.get('/api/x')).toBeNull();
    expect(cache.invalidate('/api/x')).toBe(false);
  });

  it('should invalidate by prefix', () => {
    cache.set('/api/leaderboard/1', 'a');
    cache.set('/api/leaderboard/2', 'b');
    cache.set('/api/health', 'c');

    const count = cache.invalidatePrefix('/api/leaderboard');
    expect(count).toBe(2);
    expect(cache.get('/api/health')).not.toBeNull();
  });

  it('should purge expired entries', () => {
    vi.useFakeTimers();
    cache.set('/api/a', 'a', 'application/json', 100);
    cache.set('/api/b', 'b', 'application/json', 5000);

    vi.advanceTimersByTime(200);
    const purged = cache.purgeExpired();
    expect(purged).toBe(1);
    expect(cache.size).toBe(1);

    vi.useRealTimers();
  });

  it('should clear all entries', () => {
    cache.set('/api/a', 'a');
    cache.set('/api/b', 'b');
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it('should return stats', () => {
    cache.set('/api/a', 'a');
    const stats = cache.getStats();
    expect(stats.size).toBe(1);
    expect(stats.maxEntries).toBe(5);
    expect(stats.defaultTtlMs).toBe(1_000);
  });

  it('should use custom content type', () => {
    cache.set('/api/card', '<div>hi</div>', 'text/html');
    expect(cache.get('/api/card')!.contentType).toBe('text/html');
  });
});

describe('getTtlForRoute', () => {
  it('should return configured TTL for known routes', () => {
    expect(getTtlForRoute('/api/health')).toBe(ROUTE_TTL_MAP['/api/health']);
    expect(getTtlForRoute('/api/leaderboard')).toBe(30_000);
    expect(getTtlForRoute('/api/marketplace/strategies')).toBe(60_000);
  });

  it('should return default for unknown routes', () => {
    expect(getTtlForRoute('/api/unknown', 3_000)).toBe(3_000);
  });
});
