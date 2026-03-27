/**
 * Admin Routes
 * POST /admin/halt - Halt trading
 * POST /admin/resume - Resume trading
 * GET /admin/status - Get system status
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CircuitBreaker } from '../../risk/circuit-breaker';
import { DrawdownMonitor } from '../../risk/drawdown-monitor';

// Zod schemas for request body validation
const haltSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(500, 'Reason too long'),
});

export const adminRouter: Router = Router();
const circuitBreaker = new CircuitBreaker();
const drawdownMonitor = new DrawdownMonitor();

/**
 * POST /admin/halt
 * Body: reason (required)
 */
adminRouter.post('/halt', async (req: Request, res: Response) => {
  try {
    const parsed = haltSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid request body' });
    }

    await circuitBreaker.halt(parsed.data.reason);
    res.json({ success: true, message: `Trading halted: ${parsed.data.reason}` });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to halt trading',
    });
  }
});

/**
 * POST /admin/resume
 */
adminRouter.post('/resume', async (req: Request, res: Response) => {
  try {
    await circuitBreaker.reset();
    await drawdownMonitor.resume();
    res.json({ success: true, message: 'Trading resumed' });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to resume trading',
    });
  }
});

/**
 * GET /admin/status
 */
adminRouter.get('/status', async (req: Request, res: Response) => {
  try {
    const [circuitStatus, drawdownMetrics] = await Promise.all([
      circuitBreaker.getStatus(),
      drawdownMonitor.getMetrics(),
    ]);

    res.json({
      trading: circuitStatus.state === 'CLOSED' && !drawdownMetrics.isHalted,
      circuitBreaker: circuitStatus,
      drawdown: drawdownMetrics,
      timestamp: Date.now(),
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch status',
    });
  }
});
