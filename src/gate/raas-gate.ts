/**
 * RaaS Gate - Core License Service
 * ROIaaS - Revenue-as-a-Service License Gating
 *
 * Provides tier-based access control for premium features.
 * Reference: docs/RAAS_API_ENDPOINTS.md, docs/LICENSE_GATING.md
 */

import { LicenseService } from '../billing/license-service';
import { LicenseTier, LicenseStatus, License } from '../types/license';
import { TIER_CONFIG, FEATURE_TIER_MAP } from './config/tier-config';
import {
  isFeatureEnabled,
  getTierLevel,
  validateLicense,
  requireTier,
  getRateLimits,
  getDailyLimit,
  getOveragePrice,
} from './validators';

// Re-export all validators for public API
export {
  isFeatureEnabled,
  getTierLevel,
  validateLicense,
  requireTier,
  getRateLimits,
  getDailyLimit,
  getOveragePrice,
} from './validators';

// License exports
export { LicenseService };
export { LicenseTier, LicenseStatus, License } from '../types/license';
export { TIER_CONFIG, FEATURE_TIER_MAP } from './config/tier-config';
export type { TierConfig } from './config/tier-config';
export { parseLicenseTier, LicenseError, RateLimitError } from './validators';

/**
 * Default export - RaaS Gate singleton
 */
export default class RaasGate {
  private static instance: RaasGate;
  private licenseService: LicenseService;

  private constructor() {
    this.licenseService = LicenseService.getInstance();
  }

  static getInstance(): RaasGate {
    if (!RaasGate.instance) {
      RaasGate.instance = new RaasGate();
    }
    return RaasGate.instance;
  }

  getLicenseService(): LicenseService {
    return this.licenseService;
  }

  validateApiKey(apiKey: string): License | undefined {
    return this.licenseService.getLicenseByKey(apiKey);
  }

  hasAccess(license: License | undefined, feature: string): boolean {
    try {
      validateLicense(license, feature);
      return true;
    } catch {
      return false;
    }
  }
}
