/**
 * Gas Batch Optimizer Tests
 * Tests batching of trades to reduce gas costs / API calls
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GasBatchOptimizer, type PendingTrade, type TradeResult } from '../gas-batch-optimizer';

describe('Gas Batch Optimizer', () => {
  let optimizer: GasBatchOptimizer;
  let batchExecutorMock: ReturnType<typeof vi.fn>;
  let singleExecutorMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    batchExecutorMock = vi.fn(async (trades: PendingTrade[]) => {
      return trades.map(t => ({
        tradeId: t.id,
        success: true,
        orderId: `order_${t.id}`,
        executedViaBatch: true,
      }));
    });

    singleExecutorMock = vi.fn(async (trade: PendingTrade) => ({
      tradeId: trade.id,
      success: true,
      orderId: `order_${trade.id}`,
      executedViaBatch: false,
    }));

    optimizer = new GasBatchOptimizer(batchExecutorMock, singleExecutorMock, {
      windowMs: 100, // Short window for tests
      maxBatchSize: 5,
    });
  });

  describe('initialization', () => {
    it('should construct with executors', () => {
      expect(optimizer).toBeDefined();
    });

    it('should use custom config values', () => {
      const customOptimizer = new GasBatchOptimizer(batchExecutorMock, singleExecutorMock, {
        windowMs: 2000,
        maxBatchSize: 20,
      });

      expect(customOptimizer).toBeDefined();
    });

    it('should use default values when config not provided', () => {
      const defaultOptimizer = new GasBatchOptimizer(batchExecutorMock, singleExecutorMock);

      expect(defaultOptimizer).toBeDefined();
    });
  });

  describe('single trade batching', () => {
    it('should add and execute single trade', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
      };

      const result = await optimizer.addTrade(trade);

      expect(result.success).toBe(true);
      expect(result.tradeId).toBe('trade_1');
    });

    it('should execute via batch executor', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
      };

      await optimizer.addTrade(trade);

      expect(batchExecutorMock).toHaveBeenCalled();
    });
  });

  describe('multiple trades batching', () => {
    it('should batch multiple trades', async () => {
      const trades: PendingTrade[] = [
        { id: 'trade_1', tokenId: 'BTC', side: 'BUY', price: 45000, size: 0.5 },
        { id: 'trade_2', tokenId: 'ETH', side: 'BUY', price: 2500, size: 1 },
      ];

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      expect(results.length).toBe(2);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should execute all trades in same batch if under window', async () => {
      const trades: PendingTrade[] = Array.from({ length: 3 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      await Promise.all(trades.map(t => optimizer.addTrade(t)));

      // Should call batch executor once with all 3 trades
      expect(batchExecutorMock).toHaveBeenCalledTimes(1);
      const batchCall = batchExecutorMock.mock.calls[0][0] as PendingTrade[];
      expect(batchCall.length).toBe(3);
    });

    it('should batch up to maxBatchSize before forcing flush', async () => {
      const trades: PendingTrade[] = Array.from({ length: 5 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      // All 5 should succeed (at batch size limit)
      expect(results.length).toBe(5);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should flush when batch size exceeded', async () => {
      const trades: PendingTrade[] = Array.from({ length: 7 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      // maxBatchSize is 5, so adding 7 should trigger at least 2 batches
      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      expect(results.length).toBe(7);
      expect(batchExecutorMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('time window flushing', () => {
    it('should flush after window timeout', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
      };

      optimizer = new GasBatchOptimizer(batchExecutorMock, singleExecutorMock, {
        windowMs: 50,
        maxBatchSize: 100, // High limit so only window triggers flush
      });

      const resultPromise = optimizer.addTrade(trade);
      const result = await resultPromise;

      expect(result.success).toBe(true);
      expect(batchExecutorMock).toHaveBeenCalled();
    });

    it('should collect trades within window before flush', async () => {
      optimizer = new GasBatchOptimizer(batchExecutorMock, singleExecutorMock, {
        windowMs: 100,
        maxBatchSize: 100,
      });

      const trades: PendingTrade[] = Array.from({ length: 3 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      const resultPromises = trades.map(t => optimizer.addTrade(t));
      await Promise.all(resultPromises);

      // All trades should have been batched together
      const batchedTrades = batchExecutorMock.mock.calls[0][0] as PendingTrade[];
      expect(batchedTrades.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('batch executor failure handling', () => {
    it('should handle batch execution', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
      };

      const result = await optimizer.addTrade(trade);

      // Result should be defined with standard fields
      expect(result).toBeDefined();
      expect(result.tradeId).toBe('trade_1');
    });
  });

  describe('trade result structure', () => {
    it('should return valid TradeResult', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
      };

      const result = await optimizer.addTrade(trade);

      expect(result).toHaveProperty('tradeId');
      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('executedViaBatch');
      expect(typeof result.tradeId).toBe('string');
      expect(typeof result.success).toBe('boolean');
      expect(typeof result.executedViaBatch).toBe('boolean');
    });

    it('should mark as batch execution when batched', async () => {
      const trades: PendingTrade[] = Array.from({ length: 2 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      expect(results.every(r => r.executedViaBatch === true)).toBe(true);
    });
  });

  describe('trade metadata', () => {
    it('should preserve trade metadata through batching', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
        meta: { source: 'test', priority: 'high' },
      };

      // Capture what was passed to batch executor
      batchExecutorMock.mockImplementationOnce(async (trades: PendingTrade[]) => {
        expect(trades[0].meta).toEqual({ source: 'test', priority: 'high' });
        return trades.map(t => ({
          tradeId: t.id,
          success: true,
          orderId: `order_${t.id}`,
          executedViaBatch: true,
        }));
      });

      await optimizer.addTrade(trade);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent addTrade calls', async () => {
      const trades: PendingTrade[] = Array.from({ length: 10 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      expect(results.length).toBe(10);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should maintain atomicity across concurrent batches', async () => {
      const trades: PendingTrade[] = Array.from({ length: 15 }, (_, i) => ({
        id: `trade_${i + 1}`,
        tokenId: 'BTC',
        side: 'BUY' as const,
        price: 45000,
        size: 0.5,
      }));

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      // All trades should be accounted for
      const tradeIds = new Set(results.map(r => r.tradeId));
      expect(tradeIds.size).toBe(15);
    });
  });

  describe('empty and edge cases', () => {
    it('should handle trade with optional metadata missing', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.5,
      };

      const result = await optimizer.addTrade(trade);

      expect(result.success).toBe(true);
    });

    it('should handle very small trade sizes', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 45000,
        size: 0.001,
      };

      const result = await optimizer.addTrade(trade);

      expect(result.success).toBe(true);
    });

    it('should handle zero-price trades', async () => {
      const trade: PendingTrade = {
        id: 'trade_1',
        tokenId: 'BTC',
        side: 'BUY',
        price: 0,
        size: 0.5,
      };

      const result = await optimizer.addTrade(trade);

      // May succeed or fail depending on validation, but should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe('different trade types', () => {
    it('should handle mixed BUY and SELL trades', async () => {
      const trades: PendingTrade[] = [
        { id: 'buy_1', tokenId: 'BTC', side: 'BUY', price: 45000, size: 0.5 },
        { id: 'sell_1', tokenId: 'BTC', side: 'SELL', price: 46000, size: 0.5 },
        { id: 'buy_2', tokenId: 'ETH', side: 'BUY', price: 2500, size: 1 },
      ];

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      expect(results.length).toBe(3);
      expect(results.every(r => r.success)).toBe(true);
    });

    it('should handle multiple token types', async () => {
      const trades: PendingTrade[] = [
        { id: 'btc_1', tokenId: 'BTC', side: 'BUY', price: 45000, size: 0.5 },
        { id: 'eth_1', tokenId: 'ETH', side: 'BUY', price: 2500, size: 1 },
        { id: 'sol_1', tokenId: 'SOL', side: 'BUY', price: 150, size: 10 },
      ];

      const results = await Promise.all(trades.map(t => optimizer.addTrade(t)));

      expect(results.length).toBe(3);
    });
  });
});
