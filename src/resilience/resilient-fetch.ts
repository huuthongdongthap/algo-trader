// Resilient HTTP fetch — retry + backoff + jitter + circuit breaker + rate limit
import { logger } from '../core/logger.js';
import { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
import { TokenBucket } from './rate-limiter.js';

export interface ResilientFetchOptions {
  /** Max retry attempts (default 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default 1000) */
  baseDelayMs?: number;
  /** Max delay cap in ms (default 15000) */
  maxDelayMs?: number;
  /** Jitter factor 0-1 (default 0.3) */
  jitterFactor?: number;
  /** Request timeout in ms (default 30000) */
  timeoutMs?: number;
  /** Circuit breaker instance (optional) */
  circuitBreaker?: CircuitBreaker;
  /** Rate limiter bucket (optional) */
  rateLimiter?: TokenBucket;
  /** Label for logging */
  label?: string;
}

// Retryable: 429 (rate limited), 500, 502, 503, 504, network errors
function isRetryable(err: unknown): boolean {
  if (err instanceof CircuitOpenError) return false;
  if (err instanceof Error) {
    const msg = err.message;
    // HTTP status codes that are retryable
    if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
    // Network errors
    if (/fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(msg)) return true;
  }
  return false;
}

function calcDelay(attempt: number, baseMs: number, maxMs: number, jitter: number): number {
  const exponential = baseMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxMs);
  const jitterAmount = capped * jitter * Math.random();
  return capped + jitterAmount;
}

export async function resilientFetch(
  url: string,
  init: RequestInit = {},
  options: ResilientFetchOptions = {},
): Promise<Response> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 15000,
    jitterFactor = 0.3,
    timeoutMs = 30000,
    circuitBreaker,
    rateLimiter,
    label = 'resilientFetch',
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Rate limit check
      if (rateLimiter) {
        await rateLimiter.waitForToken();
      }

      // The actual fetch call (optionally wrapped in circuit breaker)
      const doFetch = async (): Promise<Response> => {
        const res = await fetch(url, {
          ...init,
          signal: init.signal ?? AbortSignal.timeout(timeoutMs),
        });
        // Treat retryable HTTP errors as thrown errors for retry logic
        if (!res.ok && [429, 500, 502, 503, 504].includes(res.status)) {
          const body = await res.text();
          throw new Error(`HTTP ${res.status}: ${body}`);
        }
        return res;
      };

      const response = circuitBreaker
        ? await circuitBreaker.execute(doFetch)
        : await doFetch();

      if (attempt > 0) {
        logger.info(`Succeeded after ${attempt} retries`, label, { url: url.substring(0, 80) });
      }
      return response;
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !isRetryable(err)) {
        break;
      }

      const delay = calcDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      logger.warn(`Retry ${attempt + 1}/${maxRetries}`, label, {
        url: url.substring(0, 80),
        delay: Math.round(delay),
        error: String(err),
      });
      await new Promise<void>(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
