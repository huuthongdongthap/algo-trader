/**
 * P&L Routes
 * GET /pnl - Get performance metrics
 * GET /pnl/daily - Get daily summary
 */

import { Router, Request, Response } from 'express';
import { PnLService } from '../../db/pnl-service';

export const pnlRouter: Router = Router();
const pnlService = new PnLService();

/**
 * GET /pnl
 * Query params: from (ISO date), to (ISO date)
 */
pnlRouter.get('/', async (req: Request, res: Response) => {
  try {
    const metrics = await pnlService.getPerformanceMetrics();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch P&L metrics',
    });
  }
});

/**
 * GET /pnl/daily
 * Query params: date (ISO date, default today)
 */
pnlRouter.get('/daily', async (req: Request, res: Response) => {
  try {
    const dateStr = req.query.date as string;
    const date = dateStr ? new Date(dateStr) : new Date();

    const summary = await pnlService.getDailySummary(date);
    res.json(summary);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch daily P&L',
    });
  }
});
