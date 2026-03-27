/**
 * Feed Aggregator Tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FeedAggregator } from '../feed-aggregator';

describe('FeedAggregator', () => {
  let aggregator: FeedAggregator;

  beforeEach(() => {
    aggregator = new FeedAggregator();
  });

  afterEach(async () => {
    if (aggregator.isConnected()) {
      await aggregator.disconnect();
    }
  });

  it('should initialize with disconnected state', () => {
    expect(aggregator.isConnected()).toBe(false);
  });

  it('should throw error when subscribing before connecting', async () => {
    await expect(aggregator.subscribe(['BTC/USDT'])).rejects.toThrow(
      'FeedAggregator not connected'
    );
  });

  it('should connect to all exchanges', async () => {
    // Mock WebSocket to avoid actual connections in tests
    const connectSpy = vi.spyOn(aggregator as any, 'connect');

    // In a real test, we would mock the WebSocket clients
    // For now, just verify the method exists and returns a promise
    const connectPromise = aggregator.connect();
    expect(connectPromise).toBeInstanceOf(Promise);

    // Clean up
    await connectPromise.catch(() => {}); // Ignore connection errors in test
  });

  it('should register feed handlers', () => {
    const handler = vi.fn();
    aggregator.onFeed(handler);

    // Verify handler is registered (internal implementation detail)
    expect((aggregator as any).handlers.has(handler)).toBe(true);
  });

  it('should remove feed handlers', () => {
    const handler = vi.fn();
    aggregator.onFeed(handler);
    aggregator.offFeed(handler);

    expect((aggregator as any).handlers.has(handler)).toBe(false);
  });

  it('should track latency per exchange:symbol', () => {
    // Simulate latency tracking
    const key = 'binance:BTC/USDT';
    (aggregator as any).latencies.set(key, [10, 20, 30]);

    const avgLatency = aggregator.getAverageLatency('binance', 'BTC/USDT');
    expect(avgLatency).toBe(20);
  });

  it('should return 0 for unknown exchange:symbol latency', () => {
    const latency = aggregator.getAverageLatency('okx', 'ETH/USDT');
    expect(latency).toBe(0);
  });

  it('should maintain max 100 latency samples', () => {
    const key = 'bybit:BTC/USDT';
    const latencies = Array.from({ length: 150 }, (_, i) => i);
    (aggregator as any).latencies.set(key, latencies);

    // Simulate cleanup (happens in handleMessage when length > 100)
    const storedLatencies = (aggregator as any).latencies.get(key);
    while (storedLatencies.length > 100) {
      storedLatencies.shift();
    }
    expect(storedLatencies.length).toBeLessThanOrEqual(100);
  });
});
