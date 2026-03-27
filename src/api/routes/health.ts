/**
 * Health Routes
 * GET /health - Health check
 * GET /health/metrics - System metrics (JSON)
 * GET /metrics - Prometheus-format metrics
 */

import { Router, Request, Response } from 'express';
import { getRedisClient } from '../../redis';
import { getDbClient } from '../../db/postgres-client';
import { getMetrics } from '../../middleware/prometheus-metrics';

export const healthRouter: Router = Router();

/**
 * GET /health
 */
healthRouter.get('/', async (req: Request, res: Response) => {
  try {
    // Check Redis
    const redis = getRedisClient();
    await redis.ping();
    const redisOk = true;
  } catch (error) {
    return res.status(503).json({
      status: 'unhealthy',
      redis: 'error',
      error: error instanceof Error ? error.message : 'Redis ping failed',
    });
  }

  // Check PostgreSQL (optional - may not be connected)
  let postgresOk = 'disconnected';
  try {
    const db = getDbClient();
    await db.query('SELECT 1');
    postgresOk = 'ok';
  } catch (error) {
    postgresOk = 'error';
  }

  res.json({
    status: 'healthy',
    redis: 'ok',
    postgres: postgresOk,
    timestamp: Date.now(),
    uptime: process.uptime(),
  });
});

/**
 * GET /metrics
 * System metrics in JSON format
 */
healthRouter.get('/metrics', async (req: Request, res: Response) => {
  const redis = getRedisClient();

  // Get Redis info
  let redisMetrics: {
    connected: boolean;
    used_memory: number;
    keys_count: number;
    used_memory_human?: string;
    error?: string;
    keys?: number;
    uptime_seconds?: number;
  } = { connected: false, used_memory: 0, keys_count: 0 };
  try {
    const info = await redis.info();
    // Parse Redis INFO output
    const infoLines = info.split('\r\n').filter(line => line && !line.startsWith('#'));
    const infoObj: Record<string, string> = {};
    for (const line of infoLines) {
      const [key, value] = line.split(':');
      if (key && value) {
        infoObj[key] = value;
      }
    }

    // Get used memory in MB
    const usedMemoryBytes = parseInt(infoObj['used_memory'] || '0', 10);
    const usedMemoryHuman = infoObj['used_memory_human'] || `${(usedMemoryBytes / 1024 / 1024).toFixed(2)}M`;

    // Get keys count
    let keysCount = 0;
    try {
      const keys = await redis.keys('*');
      keysCount = Array.isArray(keys) ? keys.length : 0;
    } catch {
      keysCount = 0;
    }

    redisMetrics = {
      connected: true,
      used_memory: usedMemoryBytes,
      used_memory_human: usedMemoryHuman,
      keys_count: keysCount,
      uptime_seconds: parseInt(infoObj['uptime_in_seconds'] || '0', 10),
    };
  } catch (error) {
    redisMetrics = {
      connected: false,
      used_memory: 0,
      keys_count: 0,
      error: error instanceof Error ? error.message : 'Redis info failed',
    };
  }

  res.json({
    redis: redisMetrics,
    keys: redisMetrics.keys_count,
    process: {
      memory_usage: process.memoryUsage(),
      cpu_usage: process.cpuUsage(),
      uptime: process.uptime(),
      version: process.version,
      platform: process.platform,
      pid: process.pid,
    },
    timestamp: Date.now(),
  });
});
