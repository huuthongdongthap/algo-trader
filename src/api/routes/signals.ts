/**
 * Signals Routes
 * GET /signals - Get current arbitrage signals
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getRedisClient } from '../../redis';

// Zod schema for query validation
const signalsQuerySchema = z.object({
  minSpread: z.coerce.number().min(0).max(100).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export interface ArbitrageSignal {
  id: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  latency: number;
  timestamp: number;
}

export const signalsRouter: Router = Router();
const redis = getRedisClient();

/**
 * GET /signals
 * Query params: minSpread (default 0), limit (default 50)
 */
signalsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const parsed = signalsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query params' });
    }
    const { minSpread, limit } = parsed.data;

    // Get all arbitrage opportunities from Redis
    const keys = await redis.keys('arbitrage:*');
    const signals: ArbitrageSignal[] = [];

    for (const key of keys) {
      const data = await redis.hgetall(key);
      if (data && data.spreadPercent) {
        const spread = parseFloat(data.spreadPercent);
        if (spread >= minSpread) {
          signals.push({
            id: data.id,
            symbol: data.symbol,
            buyExchange: data.buyExchange,
            sellExchange: data.sellExchange,
            buyPrice: parseFloat(data.buyPrice),
            sellPrice: parseFloat(data.sellPrice),
            spread,
            latency: parseInt(data.latency),
            timestamp: parseInt(data.timestamp),
          });
        }
      }
    }

    // Sort by spread descending and limit
    signals.sort((a, b) => b.spread - a.spread);
    res.json({
      data: signals.slice(0, limit),
      count: signals.length,
      limit,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch signals',
    });
  }
});
