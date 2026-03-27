/**
 * Trade Stream Tests
 */

import { describe, it, expect } from 'vitest';

describe('TradeStream', () => {
  it('should be constructable', async () => {
    const { TradeStream } = await import('../trade-stream');
    const stream = new TradeStream();
    expect(stream).toBeDefined();
    expect(typeof stream.addTrade).toBe('function');
    expect(typeof stream.getRecentTrades).toBe('function');
    expect(typeof stream.getTradesSince).toBe('function');
    expect(typeof stream.trim).toBe('function');
    expect(typeof stream.clear).toBe('function');
  });
});
