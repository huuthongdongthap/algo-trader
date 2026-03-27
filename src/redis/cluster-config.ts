/**
 * Redis Cluster Client Configuration
 * For 6-node cluster: 3 masters + 3 replicas
 *
 * Usage:
 *   import { getRedisClusterClient } from './cluster-config';
 *   const cluster = getRedisClusterClient();
 */

import { Cluster, ClusterNode, ClusterOptions } from 'ioredis';
import { logger } from '../utils/logger';

export interface RedisClusterConfig {
  nodes: ClusterNode[];
  password?: string;
  maxRetriesPerRequest: number;
  retryDelayOnFailover: number;
  clusterRetryDelayOnFailover: number;
}

const DEFAULT_CLUSTER_CONFIG: RedisClusterConfig = {
  nodes: [
    { host: process.env.REDIS_CLUSTER_HOST || '127.0.0.1', port: 7000 },
    { host: process.env.REDIS_CLUSTER_HOST || '127.0.0.1', port: 7001 },
    { host: process.env.REDIS_CLUSTER_HOST || '127.0.0.1', port: 7002 },
    { host: process.env.REDIS_CLUSTER_HOST || '127.0.0.1', port: 7003 },
    { host: process.env.REDIS_CLUSTER_HOST || '127.0.0.1', port: 7004 },
    { host: process.env.REDIS_CLUSTER_HOST || '127.0.0.1', port: 7005 },
  ],
  password: process.env.REDIS_CLUSTER_PASSWORD,
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  clusterRetryDelayOnFailover: 2000,
};

// Cluster client instance
let clusterClient: Cluster | null = null;

/**
 * Get Redis Cluster client
 * Uses ioredis Cluster mode with automatic slot routing
 */
export function getRedisClusterClient(): Cluster {
  if (!clusterClient) {
    const config = DEFAULT_CLUSTER_CONFIG;

    const options: ClusterOptions = {
      clusterRetryStrategy: (times: number) => {
        // Exponential backoff: 100ms, 200ms, 400ms, 800ms, max 2000ms
        const delay = Math.min(100 * Math.pow(2, times), 2000);
        logger.info(`[RedisCluster] Retry attempt ${times}, delay: ${delay}ms`);
        return delay;
      },
      retryDelayOnFailover: config.retryDelayOnFailover,
      redisOptions: {
        password: config.password,
        connectTimeout: 10000,
        commandTimeout: 5000,
        maxRetriesPerRequest: config.maxRetriesPerRequest,
      },
      // Enable reading from replicas for better read performance
      scaleReads: 'master', // Options: 'all', 'master', 'slave'
    };

    clusterClient = new Cluster(config.nodes, options);

    // Event handlers
    clusterClient.on('error', (err) => {
      logger.error('[RedisCluster] Error:', { message: err.message });
    });

    clusterClient.on('connect', () => {
      logger.info('[RedisCluster] Connected to cluster');
    });

    clusterClient.on('ready', () => {
      logger.info('[RedisCluster] Cluster ready');
    });

    clusterClient.on('close', () => {
      logger.info('[RedisCluster] Connection closed');
    });

    clusterClient.on('clusterError', (err) => {
      logger.error('[RedisCluster] Cluster error:', { err });
    });
  }

  return clusterClient;
}

/**
 * Check cluster health
 * Returns cluster info including slot coverage and node status
 */
export async function getClusterHealth(): Promise<{
  healthy: boolean;
  slotsOk: number;
  slotsTotal: number;
  knownNodes: number;
  state: string;
}> {
  const cluster = getRedisClusterClient();

  try {
    const clusterInfo = await cluster.cluster('INFO');
    const lines = clusterInfo.split('\n');

    const result = {
      healthy: false,
      slotsOk: 0,
      slotsTotal: 16384,
      knownNodes: 0,
      state: 'unknown',
    };

    for (const line of lines) {
      if (line.startsWith('cluster_state:')) {
        result.state = line.split(':')[1].trim();
        result.healthy = result.state === 'ok';
      } else if (line.startsWith('cluster_slots_ok:')) {
        result.slotsOk = parseInt(line.split(':')[1].trim());
      } else if (line.startsWith('cluster_known_nodes:')) {
        result.knownNodes = parseInt(line.split(':')[1].trim());
      }
    }

    return result;
  } catch (error) {
    logger.error('[RedisCluster] Health check failed:', { error });
    return {
      healthy: false,
      slotsOk: 0,
      slotsTotal: 16384,
      knownNodes: 0,
      state: 'error',
    };
  }
}

/**
 * Close cluster connection
 */
export async function closeRedisClusterClient(): Promise<void> {
  if (clusterClient) {
    await clusterClient.quit();
    clusterClient = null;
    logger.info('[RedisCluster] Connection closed');
  }
}

export { Cluster };
