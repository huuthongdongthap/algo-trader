import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resilientFetch } from '../../src/resilience/resilient-fetch.js';
import { CircuitBreaker, CircuitOpenError } from '../../src/resilience/circuit-breaker.js';
import { TokenBucket } from '../../src/resilience/rate-limiter.js';

// Mock global fetch
const mockFetch = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', mockFetch);

// Suppress logger output during tests
vi.mock('../../src/core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    getLevel: vi.fn(),
  },
}));

function okResponse(body: unknown = {}, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(status: number, body = ''): Response {
  return new Response(body || `Error ${status}`, {
    status,
    statusText: `Error`,
  });
}

describe('resilientFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // 1. Successful fetch on first try
  it('should return response on successful first attempt', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ data: 'hello' }));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const json = await res.json();
    expect(json).toEqual({ data: 'hello' });
  });

  // 2. Retry on 500/502/503/504 and eventual success
  it('should retry on 500 and succeed on subsequent attempt', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))
      .mockResolvedValueOnce(errorResponse(502, 'Bad Gateway'))
      .mockResolvedValueOnce(okResponse({ ok: true }));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
      maxDelayMs: 50,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('should retry on 503 and 504', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(errorResponse(504))
      .mockResolvedValueOnce(okResponse());

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  // 3. Retry on 429 (rate limited)
  it('should retry on 429 rate limited response', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(429, 'Rate limited'))
      .mockResolvedValueOnce(okResponse({ success: true }));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // 4. No retry on 400/401/403/404 (non-retryable)
  it('should not retry on 400 Bad Request', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(400, 'Bad Request'));

    // 400 is not in the retryable list [429,500,502,503,504], so it returns directly
    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    // 400 is not in the retryable list, so resilientFetch returns the response as-is
    expect(res.status).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should not retry on 401 Unauthorized', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should not retry on 403 Forbidden', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    expect(res.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should not retry on 404 Not Found', async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(404, 'Not Found'));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
    });

    expect(res.status).toBe(404);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 5. No retry on CircuitOpenError
  it('should not retry on CircuitOpenError', async () => {
    const cb = new CircuitBreaker({
      name: 'test-cb',
      failureThreshold: 1,
      resetTimeoutMs: 60_000,
    });

    // Trip the circuit breaker
    mockFetch.mockResolvedValueOnce(errorResponse(500, 'Server Error'));
    try {
      await resilientFetch('https://api.example.com/test', {}, {
        circuitBreaker: cb,
        maxRetries: 3,
        baseDelayMs: 10,
        jitterFactor: 0,
      });
    } catch {
      // expected
    }

    // Now circuit is open, next call should fail immediately with CircuitOpenError
    mockFetch.mockClear();

    await expect(
      resilientFetch('https://api.example.com/test', {}, {
        circuitBreaker: cb,
        maxRetries: 3,
        baseDelayMs: 10,
      }),
    ).rejects.toThrow('OPEN');

    // fetch should not have been called since circuit is open
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  // 6. Max retries exhausted -> throws last error
  it('should throw last error when max retries exhausted', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(500, 'err1'))
      .mockResolvedValueOnce(errorResponse(500, 'err2'))
      .mockResolvedValueOnce(errorResponse(500, 'err3'))
      .mockResolvedValueOnce(errorResponse(500, 'err4'));

    await expect(
      resilientFetch('https://api.example.com/test', {}, {
        maxRetries: 3,
        baseDelayMs: 10,
        jitterFactor: 0,
      }),
    ).rejects.toThrow('HTTP 500');

    expect(mockFetch).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  // 7. Backoff delay increases exponentially
  it('should use exponential backoff with increasing delays', async () => {
    const delays: number[] = [];
    const origSetTimeout = globalThis.setTimeout;

    // Track delays by spying on setTimeout
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    mockFetch
      .mockResolvedValueOnce(errorResponse(500, 'err'))
      .mockResolvedValueOnce(errorResponse(500, 'err'))
      .mockResolvedValueOnce(errorResponse(500, 'err'))
      .mockResolvedValueOnce(okResponse());

    await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 15000,
      jitterFactor: 0,
    });

    // Extract delay values from setTimeout calls (filter for our retry delays)
    const timeoutCalls = setTimeoutSpy.mock.calls
      .filter(([, ms]) => typeof ms === 'number' && ms >= 100)
      .map(([, ms]) => ms as number);

    // Should have 3 retry delays: 100, 200, 400 (exponential with base 100, jitter 0)
    expect(timeoutCalls.length).toBe(3);
    expect(timeoutCalls[0]).toBe(100);  // 100 * 2^0
    expect(timeoutCalls[1]).toBe(200);  // 100 * 2^1
    expect(timeoutCalls[2]).toBe(400);  // 100 * 2^2

    setTimeoutSpy.mockRestore();
  });

  // 8. Circuit breaker integration (opens after failures)
  it('should integrate with circuit breaker and open after threshold', async () => {
    const cb = new CircuitBreaker({
      name: 'test-integration',
      failureThreshold: 2,
      resetTimeoutMs: 60_000,
    });

    // First call: fails with 500, retries exhausted
    mockFetch.mockResolvedValue(errorResponse(500, 'down'));

    // Each resilientFetch call with maxRetries=0 makes one attempt through the circuit breaker
    try {
      await resilientFetch('https://api.example.com/test', {}, {
        circuitBreaker: cb,
        maxRetries: 0,
        baseDelayMs: 10,
      });
    } catch { /* expected */ }

    expect(cb.getStatus().state).toBe('closed');
    expect(cb.getStatus().failureCount).toBe(1);

    try {
      await resilientFetch('https://api.example.com/test', {}, {
        circuitBreaker: cb,
        maxRetries: 0,
        baseDelayMs: 10,
      });
    } catch { /* expected */ }

    expect(cb.getStatus().state).toBe('open');
  });

  // 9. Rate limiter integration (waits for token)
  it('should wait for rate limiter token before fetching', async () => {
    const bucket = new TokenBucket(1, 100); // 1 token max, refills at 100/sec
    // Consume the only token
    bucket.tryConsume(1);

    mockFetch.mockResolvedValue(okResponse({ ok: true }));

    // Should wait for token refill then succeed
    const res = await resilientFetch('https://api.example.com/test', {}, {
      rateLimiter: bucket,
      maxRetries: 0,
      baseDelayMs: 10,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // 10. Network error retry (fetch failed)
  it('should retry on network errors (fetch failed)', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed: ECONNRESET'))
      .mockResolvedValueOnce(okResponse({ recovered: true }));

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 3,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on ETIMEDOUT', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(okResponse());

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should retry on ENOTFOUND', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('ENOTFOUND'))
      .mockResolvedValueOnce(okResponse());

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
  });

  it('should retry on socket hang up', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce(okResponse());

    const res = await resilientFetch('https://api.example.com/test', {}, {
      maxRetries: 2,
      baseDelayMs: 10,
      jitterFactor: 0,
    });

    expect(res.ok).toBe(true);
  });

  // 11. Timeout enforcement
  it('should pass timeout as AbortSignal.timeout when no signal provided', async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await resilientFetch('https://api.example.com/test', {}, {
      timeoutMs: 5000,
    });

    // Verify fetch was called with a signal
    const callArgs = mockFetch.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.signal).toBeDefined();
  });

  it('should preserve user-provided signal over timeout', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce(okResponse());

    await resilientFetch('https://api.example.com/test', { signal: controller.signal }, {
      timeoutMs: 5000,
    });

    const callArgs = mockFetch.mock.calls[0];
    const init = callArgs[1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  // Additional: non-retryable errors should not retry
  it('should not retry on generic non-network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('some random error'));

    await expect(
      resilientFetch('https://api.example.com/test', {}, {
        maxRetries: 3,
        baseDelayMs: 10,
      }),
    ).rejects.toThrow('some random error');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // Default options should work
  it('should work with default options', async () => {
    mockFetch.mockResolvedValueOnce(okResponse({ default: true }));

    const res = await resilientFetch('https://api.example.com/test');
    expect(res.ok).toBe(true);
  });
});
