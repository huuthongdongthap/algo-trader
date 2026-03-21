// Quota enforcement module for algo-trade RaaS billing metering
// Checks API call counts against tier-based rate limits (sliding window, per minute)

import { getTierLimits } from '../users/subscription-tier.js';
import type { Tier } from '../users/subscription-tier.js';
import type { UsageTracker } from './usage-tracker.js';

const ONE_MINUTE_MS = 60_000;

export interface QuotaResult {
  /** Whether this API call is allowed to proceed */
  allowed: boolean;
  /** How many more calls the user can make in the current window */
  remaining: number;
  /** Epoch ms when the oldest call in the window will expire (window resets progressively) */
  resetAt: number;
  /** Human-readable reason when allowed is false */
  reason?: string;
}

export class QuotaEnforcer {
  constructor(private readonly tracker: UsageTracker) {}

  /**
   * Check whether a user is allowed to make another API call right now.
   * Uses a sliding 1-minute window against the tier's apiRateLimit.
   */
  checkQuota(userId: string, tier: Tier): QuotaResult {
    const { apiRateLimit } = getTierLimits(tier);
    const callsInWindow = this.tracker.getUsage(userId, ONE_MINUTE_MS);
    const remaining = Math.max(0, apiRateLimit - callsInWindow);
    const resetAt = this.computeResetAt(userId);

    if (callsInWindow >= apiRateLimit) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        reason: `Rate limit exceeded: ${apiRateLimit} requests/min for tier "${tier}". Retry after ${new Date(resetAt).toISOString()}.`,
      };
    }

    return {
      allowed: true,
      remaining: remaining - 1, // account for the call about to be made
      resetAt,
    };
  }

  /**
   * How many calls the user has left in the current sliding window.
   * Does NOT count the hypothetical next call (use checkQuota for gate-keeping).
   */
  getRemainingQuota(userId: string, tier: Tier): number {
    const { apiRateLimit } = getTierLimits(tier);
    const callsInWindow = this.tracker.getUsage(userId, ONE_MINUTE_MS);
    return Math.max(0, apiRateLimit - callsInWindow);
  }

  /**
   * Build a 429-style response payload for a blocked request.
   * Mirrors the standard HTTP Retry-After header pattern.
   */
  buildRateLimitResponse(userId: string, tier: Tier): {
    status: 429;
    retryAfterMs: number;
    quotaResult: QuotaResult;
  } {
    const quotaResult = this.checkQuota(userId, tier);
    const retryAfterMs = Math.max(0, quotaResult.resetAt - Date.now());
    return { status: 429, retryAfterMs, quotaResult };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Estimate when the sliding window will next open a slot.
   * Returns the timestamp of the oldest record in the current window + 1 min,
   * or now if the user has no recent records.
   */
  private computeResetAt(userId: string): number {
    const records = this.tracker.getUserRecords(userId, ONE_MINUTE_MS);
    if (records.length === 0) return Date.now();
    const oldest = Math.min(...records.map((r) => r.timestamp));
    return oldest + ONE_MINUTE_MS;
  }
}
