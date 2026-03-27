/**
 * License Errors
 * Error classes for license validation
 */

import { LicenseTier } from '../types/license';

/**
 * License Error - Thrown when license validation fails
 */
export class LicenseError extends Error {
  public readonly requiredTier?: LicenseTier;
  public readonly feature?: string;
  public readonly currentTier?: LicenseTier;

  constructor(
    message: string,
    requiredTier?: LicenseTier,
    feature?: string,
    currentTier?: LicenseTier
  ) {
    super(message);
    this.name = 'LicenseError';
    this.requiredTier = requiredTier;
    this.feature = feature;
    this.currentTier = currentTier;
  }
}

/**
 * Rate Limit Error - Thrown when rate limit exceeded
 */
export class RateLimitError extends Error {
  public readonly retryAfter: number;
  public readonly limit: number;
  public readonly remaining: number;

  constructor(
    message: string,
    retryAfter: number,
    limit: number,
    remaining: number = 0
  ) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.limit = limit;
    this.remaining = remaining;
  }
}
