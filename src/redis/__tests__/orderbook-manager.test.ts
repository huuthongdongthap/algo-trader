/**
 * Redis Module Integration Tests
 * Tests Redis module structure and exports
 */

import { describe, it, expect } from 'vitest';

describe('Redis Module', () => {
  it('should export OrderbookManager', async () => {
    const { OrderbookManager } = await import('../orderbook-manager');
    expect(OrderbookManager).toBeDefined();
    expect(typeof OrderbookManager).toBe('function');
  });

  it('should export TickerCache', async () => {
    const { TickerCache } = await import('../ticker-cache');
    expect(TickerCache).toBeDefined();
    expect(typeof TickerCache).toBe('function');
  });

  it('should export TradeStream', async () => {
    const { TradeStream } = await import('../trade-stream');
    expect(TradeStream).toBeDefined();
    expect(typeof TradeStream).toBe('function');
  });

  it('should export PubSubManager', async () => {
    const { PubSubManager } = await import('../pubsub');
    expect(PubSubManager).toBeDefined();
    expect(typeof PubSubManager).toBe('function');
  });

  it('should export Redis client functions', async () => {
    const redis = await import('../index');
    expect(redis.getRedisClient).toBeDefined();
    expect(redis.getPubClient).toBeDefined();
    expect(redis.getSubClient).toBeDefined();
    expect(redis.closeRedisConnections).toBeDefined();
  });
});
