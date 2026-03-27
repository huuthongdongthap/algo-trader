/**
 * Redis Client & Connection Pool
 * Centralized Redis client configuration for algo-trader
 *
 * Supports both single-instance and Cluster modes.
 * Use cluster mode for horizontal scaling (1000+ concurrent connections).
 */

import Redis from 'ioredis';
import type { Cluster } from 'ioredis';
import { logger } from '../utils/logger';

// Re-export cluster client functions
import {
  getRedisClusterClient,
  getClusterHealth,
  closeRedisClusterClient,
  type RedisClusterConfig,
} from './cluster-config';

export {
  getRedisClusterClient,
  getClusterHealth,
  closeRedisClusterClient,
  RedisClusterConfig,
};

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  maxRetriesPerRequest: number;
  retryDelayOnFailover: number;
}

const DEFAULT_CONFIG: RedisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0'),
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
};

// Main connection for general operations
let mainClient: Redis | null = null;

// Pub/Sub separate connections (required by Redis)
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

/**
 * Get Redis client - supports both single-instance and cluster mode
 * Use REDIS_CLUSTER_ENABLED=true to use cluster mode
 */
export function getRedisClient(): Redis | Cluster {
  // Check if cluster mode is enabled
  if (process.env.REDIS_CLUSTER_ENABLED === 'true') {
    return getRedisClusterClient();
  }

  // Single-instance mode (default)
  if (!mainClient) {
    mainClient = new Redis(DEFAULT_CONFIG);
    mainClient.on('error', (err) => logger.error('[Redis] Error:', { err }));
    mainClient.on('connect', () => logger.info('[Redis] Connected'));
  }
  return mainClient;
}

export function getPubClient(): Redis | Cluster {
  if (process.env.REDIS_CLUSTER_ENABLED === 'true') {
    return getRedisClusterClient();
  }
  if (!pubClient) {
    pubClient = new Redis({ ...DEFAULT_CONFIG, db: DEFAULT_CONFIG.db });
  }
  return pubClient;
}

export function getSubClient(): Redis | Cluster {
  if (process.env.REDIS_CLUSTER_ENABLED === 'true') {
    return getRedisClusterClient();
  }
  if (!subClient) {
    subClient = new Redis({ ...DEFAULT_CONFIG, db: DEFAULT_CONFIG.db });
  }
  return subClient;
}

/**
 * Close all Redis connections (supports both modes)
 */
export async function closeRedisConnections(): Promise<void> {
  // Close cluster client if enabled
  if (process.env.REDIS_CLUSTER_ENABLED === 'true') {
    await closeRedisClusterClient();
  }

  // Close single-instance clients
  await Promise.all([
    mainClient?.quit(),
    pubClient?.quit(),
    subClient?.quit(),
  ]);
  mainClient = null;
  pubClient = null;
  subClient = null;
}

/**
 * Get Redis type - helper for debugging
 */
export function isClusterMode(): boolean {
  return process.env.REDIS_CLUSTER_ENABLED === 'true';
}

export type { Cluster };
export { Redis };

/**
 * Unified Redis client type - works with both single-instance and Cluster
 * Use this type for variables that should work with either mode
 */
export type RedisClientType = Redis | Cluster;
