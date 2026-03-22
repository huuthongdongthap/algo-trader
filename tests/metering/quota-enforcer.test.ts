import { describe, it, expect, afterEach } from 'vitest';
import { QuotaEnforcer } from '../../src/metering/quota-enforcer.js';
import { UsageTracker } from '../../src/metering/usage-tracker.js';

describe('QuotaEnforcer', () => {
  let tracker: UsageTracker;
  let enforcer: QuotaEnforcer;

  afterEach(() => {
    tracker?.destroy();
  });

  it('should allow call under quota', () => {
    tracker = new UsageTracker();
    enforcer = new QuotaEnforcer(tracker);
    const result = enforcer.checkQuota('u1', 'pro');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThan(0);
  });

  it('should block call at quota limit', () => {
    tracker = new UsageTracker();
    enforcer = new QuotaEnforcer(tracker);
    // free tier has lowest apiRateLimit — fill it up
    // Free tier: apiRateLimit = 10 (from subscription-tier.ts)
    for (let i = 0; i < 10; i++) {
      tracker.recordCall('u1', '/api/x', 10);
    }
    const result = enforcer.checkQuota('u1', 'free');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.reason).toContain('Rate limit exceeded');
  });

  it('should return remaining quota count', () => {
    tracker = new UsageTracker();
    enforcer = new QuotaEnforcer(tracker);
    tracker.recordCall('u1', '/api/x', 10);
    tracker.recordCall('u1', '/api/x', 10);
    const remaining = enforcer.getRemainingQuota('u1', 'pro');
    // pro tier has higher limit, minus 2 calls
    expect(remaining).toBeGreaterThan(0);
  });

  it('should build rate limit response', () => {
    tracker = new UsageTracker();
    enforcer = new QuotaEnforcer(tracker);
    // Fill free tier quota
    for (let i = 0; i < 10; i++) {
      tracker.recordCall('u1', '/api/x', 10);
    }
    const resp = enforcer.buildRateLimitResponse('u1', 'free');
    expect(resp.status).toBe(429);
    expect(resp.retryAfterMs).toBeGreaterThanOrEqual(0);
    expect(resp.quotaResult.allowed).toBe(false);
  });

  it('should return resetAt in the future when calls exist', () => {
    tracker = new UsageTracker();
    enforcer = new QuotaEnforcer(tracker);
    tracker.recordCall('u1', '/api/x', 10);
    const result = enforcer.checkQuota('u1', 'pro');
    expect(result.resetAt).toBeGreaterThan(Date.now() - 1000);
  });

  it('should return current time as resetAt for user with no records', () => {
    tracker = new UsageTracker();
    enforcer = new QuotaEnforcer(tracker);
    const result = enforcer.checkQuota('nobody', 'pro');
    const now = Date.now();
    expect(result.resetAt).toBeLessThanOrEqual(now + 100);
    expect(result.resetAt).toBeGreaterThanOrEqual(now - 100);
  });
});
