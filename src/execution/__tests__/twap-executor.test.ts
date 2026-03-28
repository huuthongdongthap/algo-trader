/**
 * TWAP Executor Tests
 */

import { describe, it, expect, vi } from 'vitest';
import { TwapExecutor, type GetDepthFn, type ExecuteChunkFn, type GetPriceFn } from '../twap-executor';

describe('TwapExecutor', () => {
  const mockGetPrice: GetPriceFn = vi.fn().mockResolvedValue(0.55);
  const mockGetDepth: GetDepthFn = vi.fn().mockResolvedValue(50000);
  const mockExecuteChunk: ExecuteChunkFn = vi.fn().mockResolvedValue({ executedPrice: 0.55, filledUsd: 1000 });

  describe('planChunks', () => {
    it('should split $5000 into $2000+$2000+$1000 chunks', () => {
      const twap = new TwapExecutor();
      const chunks = twap.planChunks(5000);
      expect(chunks).toEqual([2000, 2000, 1000]);
    });

    it('should split $500 into single chunk', () => {
      const twap = new TwapExecutor();
      const chunks = twap.planChunks(500);
      expect(chunks).toEqual([500]);
    });

    it('should merge small leftover into last chunk', () => {
      const twap = new TwapExecutor();
      const chunks = twap.planChunks(4300, 2000);
      // 2000 + 2000 + 300 → 300 < 500 min → merge: [2000, 2300]
      expect(chunks).toEqual([2000, 2300]);
    });

    it('should respect custom chunk size', () => {
      const twap = new TwapExecutor();
      const chunks = twap.planChunks(3000, 1000);
      expect(chunks).toEqual([1000, 1000, 1000]);
    });

    it('should clamp chunk size to min/max', () => {
      const twap = new TwapExecutor({ minChunkUsd: 500, maxChunkUsd: 2000 });
      const chunks = twap.planChunks(6000, 100); // 100 < min, clamp to 500
      expect(chunks[0]).toBeGreaterThanOrEqual(500);
    });
  });

  describe('depth check', () => {
    it('should reduce chunk when exceeding depth threshold', async () => {
      const smallDepth: GetDepthFn = vi.fn().mockResolvedValue(5000); // $5K depth
      const tracker = vi.fn().mockResolvedValue({ executedPrice: 0.55, filledUsd: 100 });

      const twap = new TwapExecutor({ maxDepthPercent: 2.0, delayMs: 0 });
      await twap.execute(
        { marketId: 'test', side: 'buy', totalSizeUsd: 1000 },
        smallDepth, tracker, mockGetPrice
      );

      // 2% of $5K = $100, so chunk should be reduced
      const calledSize = tracker.mock.calls[0]?.[2];
      expect(calledSize).toBeLessThanOrEqual(500); // min chunk or depth-adjusted
    });
  });

  describe('slippage abort', () => {
    it('should abort when slippage exceeds threshold', async () => {
      const badExecution: ExecuteChunkFn = vi.fn()
        .mockResolvedValueOnce({ executedPrice: 0.55, filledUsd: 1000 })  // OK
        .mockResolvedValueOnce({ executedPrice: 0.60, filledUsd: 1000 }); // 9% slippage → abort

      // Use 3 chunks so abort skips the 3rd
      const twap = new TwapExecutor({ maxSlippagePercent: 2.0, delayMs: 0 });
      const result = await twap.execute(
        { marketId: 'test', side: 'buy', totalSizeUsd: 3000, chunkSizeUsd: 1000 },
        mockGetDepth, badExecution, mockGetPrice
      );

      expect(result.aborted).toBe(true);
      expect(result.abortReason).toContain('Slippage');
      expect(result.chunksExecuted).toBe(2); // executed 2, skipped 3rd
      expect(result.chunksPlanned).toBe(3);
    });
  });

  describe('full execution', () => {
    it('should execute all chunks successfully', async () => {
      const goodExec: ExecuteChunkFn = vi.fn().mockResolvedValue({ executedPrice: 0.551, filledUsd: 1000 });

      const twap = new TwapExecutor({ delayMs: 0 });
      const result = await twap.execute(
        { marketId: 'market-1', side: 'buy', totalSizeUsd: 3000, chunkSizeUsd: 1000 },
        mockGetDepth, goodExec, mockGetPrice
      );

      expect(result.chunksExecuted).toBe(3);
      expect(result.executedSizeUsd).toBe(3000);
      expect(result.aborted).toBe(false);
      expect(result.averagePrice).toBeCloseTo(0.551, 3);
    });

    it('should handle partial fills', async () => {
      const partialExec: ExecuteChunkFn = vi.fn()
        .mockResolvedValueOnce({ executedPrice: 0.55, filledUsd: 1000 })
        .mockResolvedValueOnce({ executedPrice: 0.55, filledUsd: 800 }); // partial

      const twap = new TwapExecutor({ delayMs: 0 });
      const result = await twap.execute(
        { marketId: 'test', side: 'buy', totalSizeUsd: 2000, chunkSizeUsd: 1000 },
        mockGetDepth, partialExec, mockGetPrice
      );

      expect(result.executedSizeUsd).toBe(1800);
      expect(result.chunks[1].status).toBe('partial');
    });

    it('should handle chunk execution failure', async () => {
      const failExec: ExecuteChunkFn = vi.fn()
        .mockResolvedValueOnce({ executedPrice: 0.55, filledUsd: 1000 })
        .mockRejectedValueOnce(new Error('network error'));

      const twap = new TwapExecutor({ delayMs: 0 });
      const result = await twap.execute(
        { marketId: 'test', side: 'buy', totalSizeUsd: 2000, chunkSizeUsd: 1000 },
        mockGetDepth, failExec, mockGetPrice
      );

      expect(result.chunksExecuted).toBe(1);
      expect(result.chunks[1].status).toBe('failed');
    });
  });

  describe('metrics', () => {
    it('should track average price and total slippage', async () => {
      const exec: ExecuteChunkFn = vi.fn()
        .mockResolvedValueOnce({ executedPrice: 0.551, filledUsd: 1000 })
        .mockResolvedValueOnce({ executedPrice: 0.553, filledUsd: 1000 });

      const twap = new TwapExecutor({ delayMs: 0 });
      const result = await twap.execute(
        { marketId: 'test', side: 'buy', totalSizeUsd: 2000, chunkSizeUsd: 1000 },
        mockGetDepth, exec, mockGetPrice // arrival = 0.55
      );

      expect(result.averagePrice).toBeCloseTo(0.552, 3);
      expect(result.totalSlippagePercent).toBeGreaterThan(0);
    });
  });
});
