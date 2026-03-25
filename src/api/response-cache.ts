// In-memory TTL cache for hot API response paths — reduces DB/compute pressure at scale
// LRU eviction + configurable TTL per route pattern

export interface CacheEntry {
  data: string;
  contentType: string;
  storedAt: number;
  ttlMs: number;
}

export interface CacheConfig {
  /** Max entries before LRU eviction */
  maxEntries: number;
  /** Default TTL in ms for entries without explicit TTL */
  defaultTtlMs: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxEntries: 500,
  defaultTtlMs: 5_000, // 5s default
};

export class ResponseCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly config: CacheConfig;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Get cached response. Returns null if miss or expired. */
  get(key: string): CacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.storedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    // Move to end for LRU ordering (Map preserves insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry;
  }

  /** Store response in cache with optional TTL override */
  set(key: string, data: string, contentType = 'application/json', ttlMs?: number): void {
    // Evict oldest entry if at capacity
    if (this.cache.size >= this.config.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }

    this.cache.set(key, {
      data,
      contentType,
      storedAt: Date.now(),
      ttlMs: ttlMs ?? this.config.defaultTtlMs,
    });
  }

  /** Invalidate a specific key */
  invalidate(key: string): boolean {
    return this.cache.delete(key);
  }

  /** Invalidate all keys matching a prefix (e.g. '/api/leaderboard') */
  invalidatePrefix(prefix: string): number {
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Purge all expired entries */
  purgeExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.storedAt > entry.ttlMs) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  /** Clear entire cache */
  clear(): void {
    this.cache.clear();
  }

  /** Current number of entries (including expired) */
  get size(): number {
    return this.cache.size;
  }

  /** Cache hit/miss stats for monitoring */
  getStats(): { size: number; maxEntries: number; defaultTtlMs: number } {
    return {
      size: this.cache.size,
      maxEntries: this.config.maxEntries,
      defaultTtlMs: this.config.defaultTtlMs,
    };
  }
}

// ── Route-based TTL configuration ────────────────────────────────────────────

/** Recommended TTLs per route pattern for production use */
export const ROUTE_TTL_MAP: Record<string, number> = {
  '/api/health': 10_000,         // 10s — health checks
  '/api/leaderboard': 30_000,    // 30s — leaderboard doesn't change fast
  '/api/marketplace': 60_000,    // 1m  — strategy marketplace
  '/api/metrics': 5_000,         // 5s  — Prometheus metrics
  '/api/share/card': 30_000,     // 30s — share cards
  '/api/status': 2_000,          // 2s  — engine status
};

/** Get TTL for a given pathname, falling back to default */
export function getTtlForRoute(pathname: string, defaultMs = 5_000): number {
  for (const [pattern, ttl] of Object.entries(ROUTE_TTL_MAP)) {
    if (pathname.startsWith(pattern)) return ttl;
  }
  return defaultMs;
}
