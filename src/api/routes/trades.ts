/**
 * Trades Routes
 * GET /trades - List all trades
 * GET /trades/:id - Get trade by ID
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { TradeRepository } from '../../db/trade-repository';

// Zod schemas for query validation
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const tradeIdSchema = z.object({
  id: z.string().min(1, 'Trade ID is required'),
});

export const tradesRouter: Router = Router();
const tradeRepo = new TradeRepository();

/**
 * GET /trades
 * Query params: limit (default 100), offset (default 0)
 */
tradesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query params' });
    }
    const { limit, offset } = parsed.data;

    const trades = await tradeRepo.getRecent(limit);
    res.json({
      data: trades.slice(offset, offset + limit),
      total: trades.length,
      limit,
      offset,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch trades',
    });
  }
});

/**
 * GET /trades/:id
 */
tradesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = tradeIdSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid trade ID' });
    }
    const trade = await tradeRepo.getById(parsed.data.id);

    if (!trade) {
      return res.status(404).json({ error: 'Trade not found' });
    }

    res.json(trade);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch trade',
    });
  }
});
