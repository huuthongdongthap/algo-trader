import { describe, it, expect } from 'vitest';
import { TokenBucket, RateLimiterRegistry } from '../../src/resilience/rate-limiter.js';

describe('TokenBucket', () => {
  it('should start with max tokens', () => {
    const bucket = new TokenBucket(10, 10);
    expect(bucket.getAvailableTokens()).toBeCloseTo(10, 0);
  });

  it('should consume tokens', () => {
    const bucket = new TokenBucket(10, 10);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.getAvailableTokens()).toBeCloseTo(9, 0);
  });

  it('should reject when insufficient tokens', () => {
    const bucket = new TokenBucket(2, 1);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
  });

  it('should refill tokens over time', async () => {
    const bucket = new TokenBucket(10, 100); // 100 tokens/sec
    bucket.tryConsume(10); // drain all
    expect(bucket.getAvailableTokens()).toBeCloseTo(0, 0);

    await new Promise(r => setTimeout(r, 60)); // wait ~60ms
    const available = bucket.getAvailableTokens();
    expect(available).toBeGreaterThan(0);
    expect(available).toBeLessThanOrEqual(10);
  });

  it('should not exceed max tokens on refill', async () => {
    const bucket = new TokenBucket(5, 100);
    await new Promise(r => setTimeout(r, 200));
    expect(bucket.getAvailableTokens()).toBeLessThanOrEqual(5);
  });

  it('should wait for token with waitForToken', async () => {
    const bucket = new TokenBucket(1, 100); // refills fast
    bucket.tryConsume(1);
    await bucket.waitForToken(1, 500); // should succeed within 500ms
  });

  it('should throw on waitForToken timeout', async () => {
    const bucket = new TokenBucket(1, 0.001); // very slow refill
    bucket.tryConsume(1);
    await expect(bucket.waitForToken(1, 100)).rejects.toThrow('Rate limiter timeout');
  });
});

describe('RateLimiterRegistry', () => {
  it('should create and retrieve rate limiter', () => {
    const registry = new RateLimiterRegistry();
    const bucket = registry.getOrCreate('test-exchange', 5);
    expect(bucket).toBeInstanceOf(TokenBucket);
    // Same instance on second call
    const same = registry.getOrCreate('test-exchange');
    expect(same).toBe(bucket);
  });

  it('should use exchange presets', () => {
    const registry = new RateLimiterRegistry();
    const bucket = registry.getOrCreate('binance');
    // binance preset is 20 tokens/sec
    expect(bucket.getAvailableTokens()).toBeCloseTo(20, 0);
  });

  it('should list exchanges', () => {
    const registry = new RateLimiterRegistry();
    registry.getOrCreate('binance');
    registry.getOrCreate('polymarket');
    expect(registry.listExchanges()).toContain('binance');
    expect(registry.listExchanges()).toContain('polymarket');
  });

  it('should createForExchange replacing existing', () => {
    const registry = new RateLimiterRegistry();
    const old = registry.getOrCreate('test', 5);
    const fresh = registry.createForExchange('test', 20);
    expect(fresh).not.toBe(old);
    expect(fresh.getAvailableTokens()).toBeCloseTo(20, 0);
  });

  it('should return 0 available for unknown exchange', () => {
    const registry = new RateLimiterRegistry();
    expect(registry.getAvailable('unknown')).toBe(0);
  });
});
