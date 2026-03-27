/**
 * Ticker Cache Tests
 */

import { describe, it, expect } from 'vitest';

describe('TickerCache', () => {
  it('should be constructable', async () => {
    const { TickerCache } = await import('../ticker-cache');
    const cache = new TickerCache();
    expect(cache).toBeDefined();
    expect(typeof cache.setTicker).toBe('function');
    expect(typeof cache.getTicker).toBe('function');
    expect(typeof cache.getTickers).toBe('function');
    expect(typeof cache.clear).toBe('function');
  });
});
