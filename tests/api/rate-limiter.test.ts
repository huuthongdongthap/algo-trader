import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  checkRateLimit,
  createRateLimitMiddleware,
  clearRateLimitState,
  getTierLimit,
} from '../../src/api/api-rate-limiter-middleware.js';
import type { Tier } from '../../src/users/subscription-tier.js';

describe('checkRateLimit', () => {
  beforeEach(() => {
    clearRateLimitState();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearRateLimitState();
  });

  it('should allow request when under limit', () => {
    const result = checkRateLimit('user-1', 'free');
    expect(result.allowed).toBe(true);
  });

  it('should allow multiple requests within free tier limit', () => {
    for (let i = 0; i < 10; i++) {
      const result = checkRateLimit('user-1', 'free');
      expect(result.allowed).toBe(true);
    }
  });

  it('should reject request when free tier limit exceeded', () => {
    // Free tier limit is 10 requests per minute
    for (let i = 0; i < 10; i++) {
      checkRateLimit('user-1', 'free');
    }

    // 11th request should be rejected
    const result = checkRateLimit('user-1', 'free');
    expect(result.allowed).toBe(false);
    expect('retryAfter' in result && result.retryAfter).toBeGreaterThan(0);
  });

  it('should allow more requests for pro tier', () => {
    for (let i = 0; i < 100; i++) {
      const result = checkRateLimit('pro-user', 'pro');
      expect(result.allowed).toBe(true);
    }

    // 101st request should be rejected
    const result = checkRateLimit('pro-user', 'pro');
    expect(result.allowed).toBe(false);
  });

  it('should allow many requests for enterprise tier', () => {
    for (let i = 0; i < 1000; i++) {
      const result = checkRateLimit('enterprise-user', 'enterprise');
      expect(result.allowed).toBe(true);
    }

    // 1001st request should be rejected
    const result = checkRateLimit('enterprise-user', 'enterprise');
    expect(result.allowed).toBe(false);
  });

  it('should provide accurate retryAfter value', () => {
    // Fill up the limit
    for (let i = 0; i < 10; i++) {
      checkRateLimit('user-1', 'free');
    }

    // Next request should fail and return retryAfter
    const result = checkRateLimit('user-1', 'free');
    expect(result.allowed).toBe(false);
    if ('retryAfter' in result) {
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.retryAfter).toBeLessThanOrEqual(60); // Within window
    }
  });

  it('should reset rate limit after window expires', () => {
    // Use up free tier limit
    for (let i = 0; i < 10; i++) {
      checkRateLimit('user-2', 'free');
    }

    let result = checkRateLimit('user-2', 'free');
    expect(result.allowed).toBe(false);

    // Advance time by 61 seconds (past the 60-second window)
    vi.advanceTimersByTime(61_000);

    // Should now allow requests again
    result = checkRateLimit('user-2', 'free');
    expect(result.allowed).toBe(true);
  });

  it('should isolate rate limits by user ID', () => {
    // Fill up user-1's limit
    for (let i = 0; i < 10; i++) {
      checkRateLimit('user-1', 'free');
    }

    // user-1 should be rate limited
    let result = checkRateLimit('user-1', 'free');
    expect(result.allowed).toBe(false);

    // user-2 should still have requests available
    result = checkRateLimit('user-2', 'free');
    expect(result.allowed).toBe(true);
  });

  it('should isolate rate limits by tier', () => {
    // Fill up free tier limit
    for (let i = 0; i < 10; i++) {
      checkRateLimit('user-1', 'free');
    }

    // Same user but pro tier should still have requests
    const result = checkRateLimit('user-1', 'pro');
    expect(result.allowed).toBe(true);
  });

  it('should handle many different users independently', () => {
    const users = Array.from({ length: 50 }, (_, i) => `user-${i}`);
    users.forEach(userId => {
      const result = checkRateLimit(userId, 'free');
      expect(result.allowed).toBe(true);
    });

    // Second request batch should still all pass
    users.forEach(userId => {
      const result = checkRateLimit(userId, 'free');
      expect(result.allowed).toBe(true);
    });
  });

  it('should track request timestamps correctly', () => {
    // Make initial request at t=0
    checkRateLimit('user-1', 'free');

    // Advance to 30 seconds
    vi.advanceTimersByTime(30_000);

    // Make 9 more requests (total 10)
    for (let i = 0; i < 9; i++) {
      checkRateLimit('user-1', 'free');
    }

    // Next request should be rejected (limit = 10)
    let result = checkRateLimit('user-1', 'free');
    expect(result.allowed).toBe(false);

    // Advance another 35 seconds (65 seconds total from first request)
    vi.advanceTimersByTime(35_000);

    // First request should now be outside window, allowing a new one
    result = checkRateLimit('user-1', 'free');
    expect(result.allowed).toBe(true);
  });

  it('should return correct tier limits', () => {
    expect(getTierLimit('free')).toBe(10);
    expect(getTierLimit('pro')).toBe(100);
    expect(getTierLimit('enterprise')).toBe(1000);
  });
});

describe('Rate limit middleware', () => {
  beforeEach(() => {
    clearRateLimitState();
  });

  afterEach(() => {
    clearRateLimitState();
  });

  it('should allow authenticated request within tier limit', () => {
    const middleware = createRateLimitMiddleware();
    let nextCalled = false;

    const req = {
      user: { id: 'user-1', tier: 'free' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });

  it('should reject request exceeding tier limit', () => {
    const middleware = createRateLimitMiddleware();

    // Use up free tier limit (10 requests)
    for (let i = 0; i < 10; i++) {
      let nextCalled = false;
      const req = {
        user: { id: 'user-1', tier: 'free' as Tier },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {
        nextCalled = true;
      });
      expect(nextCalled).toBe(true);
    }

    // 11th request should be rejected
    let statusCode = 0;
    const req = {
      user: { id: 'user-1', tier: 'free' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = {
      writeHead: (status: number) => {
        statusCode = status;
      },
      end: () => {},
    } as any;

    middleware(req, res, () => {
      throw new Error('Should not call next()');
    });

    expect(statusCode).toBe(429);
  });

  it('should return correct rate limit headers', () => {
    const middleware = createRateLimitMiddleware();

    // Use up free tier limit
    for (let i = 0; i < 10; i++) {
      const req = {
        user: { id: 'user-2', tier: 'free' as Tier },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {});
    }

    // Next request
    let headers: Record<string, string> = {};
    const req = {
      user: { id: 'user-2', tier: 'free' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = {
      writeHead: (status: number, responseHeaders: Record<string, string>) => {
        headers = responseHeaders;
      },
      end: () => {},
    } as any;

    middleware(req, res, () => {});

    expect(headers['X-RateLimit-Limit']).toBe('10');
    expect(headers['X-RateLimit-Remaining']).toBe('0');
    expect(headers['Retry-After']).toBeTruthy();
  });

  it('should use user ID as rate limit key for authenticated requests', () => {
    const middleware = createRateLimitMiddleware();

    // User-1 makes 10 requests
    for (let i = 0; i < 10; i++) {
      const req = {
        user: { id: 'user-1', tier: 'free' as Tier },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {});
    }

    // User-1 should be rate limited
    let user1LimitedAt = false;
    let req = {
      user: { id: 'user-1', tier: 'free' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    let res = {
      writeHead: (status: number) => {
        if (status === 429) user1LimitedAt = true;
      },
      end: () => {},
    } as any;

    middleware(req, res, () => {});
    expect(user1LimitedAt).toBe(true);

    // But user-2 with same IP should NOT be limited (different user ID)
    let user2Allowed = false;
    req = {
      user: { id: 'user-2', tier: 'free' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      user2Allowed = true;
    });

    expect(user2Allowed).toBe(true);
  });

  it('should use IP as rate limit key for unauthenticated requests', () => {
    const middleware = createRateLimitMiddleware();

    // Unauthenticated request from 192.168.1.1
    for (let i = 0; i < 10; i++) {
      const req = {
        user: undefined,
        socket: { remoteAddress: '192.168.1.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {});
    }

    // 11th request from same IP should be limited
    let statusCode = 0;
    const req = {
      user: undefined,
      socket: { remoteAddress: '192.168.1.1' },
    } as any;

    const res = {
      writeHead: (status: number) => {
        statusCode = status;
      },
      end: () => {},
    } as any;

    middleware(req, res, () => {});

    expect(statusCode).toBe(429);
  });

  it('should return 429 response as JSON', () => {
    const middleware = createRateLimitMiddleware();

    // Use up limit
    for (let i = 0; i < 10; i++) {
      const req = {
        user: { id: 'user-3', tier: 'free' as Tier },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {});
    }

    // Trigger rate limit
    let responseBody = '';
    let contentType = '';
    const req = {
      user: { id: 'user-3', tier: 'free' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = {
      writeHead: (status: number, headers: Record<string, string>) => {
        contentType = headers['Content-Type'];
      },
      end: (body: string) => {
        responseBody = body;
      },
    } as any;

    middleware(req, res, () => {});

    expect(contentType).toBe('application/json');
    const json = JSON.parse(responseBody);
    expect(json.error).toBe('Too Many Requests');
    expect(json.message).toContain('Rate limit exceeded');
    expect(json.retryAfter).toBeGreaterThan(0);
  });

  it('should handle pro tier with higher limits', () => {
    const middleware = createRateLimitMiddleware();

    // Pro user can make 100 requests
    for (let i = 0; i < 100; i++) {
      const req = {
        user: { id: 'pro-user', tier: 'pro' as Tier },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {});
    }

    // 101st request should fail
    let statusCode = 0;
    const req = {
      user: { id: 'pro-user', tier: 'pro' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = {
      writeHead: (status: number) => {
        statusCode = status;
      },
      end: () => {},
    } as any;

    middleware(req, res, () => {});

    expect(statusCode).toBe(429);
  });

  it('should handle enterprise tier with high limits', () => {
    const middleware = createRateLimitMiddleware();

    // Enterprise user can make 1000 requests
    for (let i = 0; i < 1000; i++) {
      const req = {
        user: { id: 'enterprise-user', tier: 'enterprise' as Tier },
        socket: { remoteAddress: '127.0.0.1' },
      } as any;

      const res = {
        writeHead: () => {},
        end: () => {},
      } as any;

      middleware(req, res, () => {});
    }

    // 1001st request should fail
    let statusCode = 0;
    const req = {
      user: { id: 'enterprise-user', tier: 'enterprise' as Tier },
      socket: { remoteAddress: '127.0.0.1' },
    } as any;

    const res = {
      writeHead: (status: number) => {
        statusCode = status;
      },
      end: () => {},
    } as any;

    middleware(req, res, () => {});

    expect(statusCode).toBe(429);
  });
});
