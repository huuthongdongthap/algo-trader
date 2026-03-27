/**
 * Execution Module Tests
 */

import { describe, it, expect } from 'vitest';

describe('OrderExecutor', () => {
  it('should be constructable', async () => {
    const { OrderExecutor } = await import('../order-executor');
    const executor = new OrderExecutor();
    expect(executor).toBeDefined();
    expect(typeof executor.execute).toBe('function');
    expect(typeof executor.getExecution).toBe('function');
    expect(typeof executor.cancel).toBe('function');
  });

  it('should use custom config', async () => {
    const { OrderExecutor } = await import('../order-executor');
    const executor = new OrderExecutor({
      defaultAmount: 0.1,
      maxSlippage: 0.02,
      timeoutMs: 10000,
    });
    expect(executor).toBeDefined();
  });
});

describe('OrderValidator', () => {
  it('should be constructable', async () => {
    const { OrderValidator } = await import('../order-validator');
    const validator = new OrderValidator();
    expect(validator).toBeDefined();
    expect(typeof validator.validate).toBe('function');
    expect(typeof validator.updateConfig).toBe('function');
  });

  it('should validate good opportunity', async () => {
    const { OrderValidator } = await import('../order-validator');
    const validator = new OrderValidator();

    const opp = {
      id: 'test-1',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'okx',
      buyPrice: 50000,
      sellPrice: 50500,
      spread: 500,
      spreadPercent: 1.0,
      timestamp: Date.now(),
      latency: 50,
    };

    const result = validator.validate(opp, 0.01);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject low spread', async () => {
    const { OrderValidator } = await import('../order-validator');
    const validator = new OrderValidator({ minSpreadPercent: 0.5 });

    const opp = {
      id: 'test-2',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'okx',
      buyPrice: 50000,
      sellPrice: 50025,
      spread: 25,
      spreadPercent: 0.05,
      timestamp: Date.now(),
      latency: 50,
    };

    const result = validator.validate(opp, 0.01);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should track daily trade count', async () => {
    const { OrderValidator } = await import('../order-validator');
    const validator = new OrderValidator();

    expect(validator.getDailyTradeCount()).toBe(0);
    validator.incrementTradeCount();
    expect(validator.getDailyTradeCount()).toBe(1);
  });
});

describe('RollbackHandler', () => {
  it('should be constructable', async () => {
    const { RollbackHandler } = await import('../rollback-handler');
    const handler = new RollbackHandler();
    expect(handler).toBeDefined();
    expect(typeof handler.handleFailedExecution).toBe('function');
    expect(typeof handler.getHistory).toBe('function');
  });

  it('should handle no positions to rollback', async () => {
    const { RollbackHandler } = await import('../rollback-handler');
    const handler = new RollbackHandler();

    const execution = {
      id: 'exec-1',
      opportunityId: 'opp-1',
      status: 'FAILED' as const,
      timestamp: Date.now(),
      error: 'Test error',
    };

    const result = await handler.handleFailedExecution(execution);
    expect(result.action).toBe('NO_ACTION');
    expect(result.success).toBe(true);
  });

  it('should track total losses', async () => {
    const { RollbackHandler } = await import('../rollback-handler');
    const handler = new RollbackHandler();

    expect(handler.getTotalLosses()).toBe(0);
  });
});
