/**
 * Semantic Cache
 * Redis-backed cache for discovered DependencyGraphs.
 * Key: semantic:deps:{batchHash}, TTL: 3600s (1h)
 *
 * Prevents repeated DeepSeek API calls for the same market set.
 */

import crypto from 'crypto';
import { getRedisClient } from '../redis/index';
import { logger } from '../utils/logger';
import type { DependencyGraph } from '../types/semantic-relationships';

const CACHE_TTL_SECONDS = 3600;
const KEY_PREFIX = 'semantic:deps:';

/** Hash market IDs array into a stable cache key segment */
export function hashMarketIds(marketIds: string[]): string {
  const sorted = [...marketIds].sort().join(',');
  return crypto.createHash('sha256').update(sorted).digest('hex').slice(0, 16);
}

/** Build full Redis cache key from market ID hash */
function cacheKey(hash: string): string {
  return `${KEY_PREFIX}${hash}`;
}

/**
 * Retrieve a cached DependencyGraph by market ID hash.
 * Returns null on cache miss or deserialization error.
 */
export async function getCachedGraph(marketIds: string[]): Promise<DependencyGraph | null> {
  const hash = hashMarketIds(marketIds);
  const key = cacheKey(hash);

  try {
    const redis = getRedisClient();
    const raw = await redis.get(key);
    if (!raw) {
      logger.debug(`[SemanticCache] MISS ${key}`);
      return null;
    }
    logger.debug(`[SemanticCache] HIT ${key}`);
    return JSON.parse(raw) as DependencyGraph;
  } catch (err) {
    logger.warn('[SemanticCache] Cache read error', { key, err });
    return null;
  }
}

/**
 * Store a DependencyGraph in Redis with 1h TTL.
 * Silently swallows write errors — cache is non-critical.
 */
export async function setCachedGraph(
  marketIds: string[],
  graph: DependencyGraph,
): Promise<void> {
  const hash = hashMarketIds(marketIds);
  const key = cacheKey(hash);

  try {
    const redis = getRedisClient();
    await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(graph));
    logger.debug(`[SemanticCache] SET ${key} TTL=${CACHE_TTL_SECONDS}s`);
  } catch (err) {
    logger.warn('[SemanticCache] Cache write error', { key, err });
  }
}

/**
 * Invalidate a cached graph explicitly (e.g. forced refresh).
 */
export async function invalidateCachedGraph(marketIds: string[]): Promise<void> {
  const hash = hashMarketIds(marketIds);
  const key = cacheKey(hash);

  try {
    const redis = getRedisClient();
    await redis.del(key);
    logger.info(`[SemanticCache] Invalidated ${key}`);
  } catch (err) {
    logger.warn('[SemanticCache] Cache invalidation error', { key, err });
  }
}
