// Token bucket rate limiter for exchange API calls
import { logger } from '../core/logger.js';

const WAIT_TIMEOUT_MS = 5000;

/** Token bucket implementation - refills at constant rate */
export class TokenBucket {
  private currentTokens: number;
  private lastRefillTime: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number, // tokens per second
  ) {
    this.currentTokens = maxTokens;
    this.lastRefillTime = Date.now();
  }

  /** Refill tokens based on elapsed time since last refill */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefillTime) / 1000; // seconds
    const tokensToAdd = elapsed * this.refillRate;
    this.currentTokens = Math.min(this.maxTokens, this.currentTokens + tokensToAdd);
    this.lastRefillTime = now;
  }

  /** Try to consume tokens. Returns true if successful. */
  tryConsume(tokens: number = 1): boolean {
    this.refill();
    if (this.currentTokens >= tokens) {
      this.currentTokens -= tokens;
      return true;
    }
    return false;
  }

  /** Wait until token is available (with timeout). Throws on timeout. */
  async waitForToken(tokens: number = 1, timeoutMs: number = WAIT_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.tryConsume(tokens)) return;
      // Wait a short interval, then retry
      const waitMs = Math.min(50, (tokens / this.refillRate) * 1000);
      await new Promise<void>(resolve => setTimeout(resolve, waitMs));
    }
    throw new Error(`Rate limiter timeout after ${timeoutMs}ms waiting for ${tokens} token(s)`);
  }

  getAvailableTokens(): number {
    this.refill();
    return this.currentTokens;
  }
}

// Per-exchange rate limit presets (tokens per second)
const EXCHANGE_PRESETS: Record<string, number> = {
  binance: 20,
  bybit: 10,
  okx: 5,
  polymarket: 10,
};

/** Registry for managing per-exchange rate limiters */
export class RateLimiterRegistry {
  private readonly buckets = new Map<string, TokenBucket>();

  /** Get or create a rate limiter for the given exchange */
  getOrCreate(name: string, maxPerSecond?: number): TokenBucket {
    const existing = this.buckets.get(name);
    if (existing) return existing;

    const rate = maxPerSecond ?? EXCHANGE_PRESETS[name] ?? 10;
    const bucket = new TokenBucket(rate, rate);
    this.buckets.set(name, bucket);
    logger.debug(`RateLimiter created`, 'RateLimiterRegistry', { exchange: name, ratePerSec: rate });
    return bucket;
  }

  /** Factory with exchange presets */
  createForExchange(name: string, maxPerSecond?: number): TokenBucket {
    // Remove existing to allow reconfiguration
    this.buckets.delete(name);
    return this.getOrCreate(name, maxPerSecond);
  }

  /** Check tokens available without consuming */
  getAvailable(name: string): number {
    const bucket = this.buckets.get(name);
    return bucket ? bucket.getAvailableTokens() : 0;
  }

  listExchanges(): string[] {
    return Array.from(this.buckets.keys());
  }
}

/** Singleton registry */
export const rateLimiterRegistry = new RateLimiterRegistry();
