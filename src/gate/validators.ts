/**
 * License Validators
 * License validation and tier checking functions
 */

import { LicenseError, RateLimitError } from './errors';
import { TIER_CONFIG, FEATURE_TIER_MAP } from './config/tier-config';
import { LicenseTier, LicenseStatus, License } from '../types/license';

/**
 * Parse license key to determine tier
 */
export function parseLicenseTier(key: string): LicenseTier {
  if (!key) return LicenseTier.FREE;

  const upperKey = key.toUpperCase();

  if (upperKey.startsWith('RAAS-PRO-') || upperKey.startsWith('RPP-') || upperKey.startsWith('RAAS-RPP-')) {
    return LicenseTier.PRO;
  }

  if (upperKey.startsWith('RAAS-ENT-') || upperKey.startsWith('REP-') || upperKey.startsWith('RAAS-REP-')) {
    return LicenseTier.ENTERPRISE;
  }

  if (upperKey.startsWith('RAAS-FREE-') || upperKey.startsWith('FREE-')) {
    return LicenseTier.FREE;
  }

  return LicenseTier.FREE;
}

/**
 * Check if a feature is enabled for a given tier
 */
export function isFeatureEnabled(feature: string, tier: LicenseTier): boolean {
  const requiredTier = FEATURE_TIER_MAP[feature];
  if (!requiredTier) return true;

  const tierLevel = getTierLevel(tier);
  const requiredLevel = getTierLevel(requiredTier);

  return tierLevel >= requiredLevel;
}

/**
 * Get tier level (higher = more access)
 */
export function getTierLevel(tier: LicenseTier): number {
  switch (tier) {
    case LicenseTier.FREE: return 0;
    case LicenseTier.PRO: return 1;
    case LicenseTier.ENTERPRISE: return 2;
    default: return 0;
  }
}

/**
 * Validate license for feature access
 */
export function validateLicense(
  license: License | undefined,
  feature: string
): asserts license is License {
  if (!license) {
    throw new LicenseError(
      `Feature "${feature}" requires a valid license`,
      FEATURE_TIER_MAP[feature],
      feature,
      LicenseTier.FREE
    );
  }

  if (license.status !== LicenseStatus.ACTIVE) {
    throw new LicenseError(
      `License is not active (status: ${license.status})`,
      undefined,
      feature,
      license.tier
    );
  }

  const tierLevel = getTierLevel(license.tier);
  const requiredTier = FEATURE_TIER_MAP[feature];

  if (requiredTier && tierLevel < getTierLevel(requiredTier)) {
    throw new LicenseError(
      `Feature "${feature}" requires ${requiredTier} license. Current tier: ${license.tier}`,
      requiredTier,
      feature,
      license.tier
    );
  }
}

/**
 * Require specific tier level
 */
export function requireTier(
  license: License | undefined,
  requiredTier: LicenseTier,
  feature?: string
): asserts license is License {
  if (!license) {
    throw new LicenseError(
      `This feature requires a ${requiredTier} license`,
      requiredTier,
      feature,
      LicenseTier.FREE
    );
  }

  const tierLevel = getTierLevel(license.tier);
  const requiredLevel = getTierLevel(requiredTier);

  if (tierLevel < requiredLevel) {
    throw new LicenseError(
      `Current tier (${license.tier}) is insufficient. Required: ${requiredTier}`,
      requiredTier,
      feature,
      license.tier
    );
  }
}

/**
 * Get rate limit configuration for tier
 */
export function getRateLimits(tier: LicenseTier): {
  requestsPerMin: number;
  requestsPerHour: number;
  burstPerSec: number;
} {
  return TIER_CONFIG[tier];
}

/**
 * Get daily API limit for tier
 */
export function getDailyLimit(tier: LicenseTier): number {
  return TIER_CONFIG[tier].dailyApiLimit;
}

/**
 * Calculate overage price for tier
 */
export function getOveragePrice(tier: LicenseTier): number {
  return TIER_CONFIG[tier].overagePrice;
}

// Re-export errors for convenience
export { LicenseError, RateLimitError } from './errors';
