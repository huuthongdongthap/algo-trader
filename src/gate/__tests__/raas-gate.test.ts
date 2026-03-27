/**
 * RaaS Gate Tests
 * ROIaaS - Revenue-as-a-Service License Gating tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import RaasGate, {
  LicenseError,
  RateLimitError,
  TIER_CONFIG,
  FEATURE_TIER_MAP,
  parseLicenseTier,
  isFeatureEnabled,
  getTierLevel,
  validateLicense,
  requireTier,
  getRateLimits,
  getDailyLimit,
  getOveragePrice,
} from '../raas-gate';
import { LicenseService } from '../billing/license-service';
import { LicenseTier, LicenseStatus, License } from '../../types/license';

// Import validators for direct function tests
import {
  parseLicenseTier as parseTier,
  isFeatureEnabled as isFeature,
  getTierLevel as tierLevel,
  validateLicense as validate,
  requireTier as require,
  getRateLimits as rateLimits,
  getDailyLimit as dailyLimit,
  getOveragePrice as overagePrice,
} from '../validators';

describe('raas-gate', () => {
  describe('parseLicenseTier', () => {
    it('should parse FREE tier from key', () => {
      expect(parseTier('RAAS-FREE-ABC12345-DEF67890')).toBe(LicenseTier.FREE);
      expect(parseTier('FREE-ABC12345-DEF67890')).toBe(LicenseTier.FREE);
    });

    it('should parse PRO tier from key', () => {
      expect(parseTier('RAAS-PRO-ABC12345-DEF67890')).toBe(LicenseTier.PRO);
      expect(parseTier('RPP-ABC12345-DEF67890')).toBe(LicenseTier.PRO);
      expect(parseTier('RAAS-RPP-ABC12345-DEF67890')).toBe(LicenseTier.PRO);
    });

    it('should parse ENTERPRISE tier from key', () => {
      expect(parseTier('RAAS-ENT-ABC12345-DEF67890')).toBe(LicenseTier.ENTERPRISE);
      expect(parseTier('REP-ABC12345-DEF67890')).toBe(LicenseTier.ENTERPRISE);
      expect(parseTier('RAAS-REP-ABC12345-DEF67890')).toBe(LicenseTier.ENTERPRISE);
    });

    it('should default to FREE for unknown key format', () => {
      expect(parseTier('')).toBe(LicenseTier.FREE);
      expect(parseTier('invalid-key')).toBe(LicenseTier.FREE);
      expect(parseTier('UNKNOWN-123')).toBe(LicenseTier.FREE);
    });

    it('should be case insensitive', () => {
      expect(parseTier('raas-pro-abc12345-def67890')).toBe(LicenseTier.PRO);
      expect(parseTier('RAAS-ENT-ABC12345-DEF67890')).toBe(LicenseTier.ENTERPRISE);
    });
  });

  describe('getTierLevel', () => {
    it('should return correct tier levels', () => {
      expect(tierLevel(LicenseTier.FREE)).toBe(0);
      expect(tierLevel(LicenseTier.PRO)).toBe(1);
      expect(tierLevel(LicenseTier.ENTERPRISE)).toBe(2);
    });
  });

  describe('isFeatureEnabled', () => {
    it('should allow FREE features for FREE tier', () => {
      expect(isFeature('basic_strategies', LicenseTier.FREE)).toBe(true);
      expect(isFeature('live_trading', LicenseTier.FREE)).toBe(true);
      expect(isFeature('basic_backtest', LicenseTier.FREE)).toBe(true);
    });

    it('should deny PRO features for FREE tier', () => {
      expect(isFeature('ml_strategies', LicenseTier.FREE)).toBe(false);
      expect(isFeature('premium_data', LicenseTier.FREE)).toBe(false);
      expect(isFeature('advanced_optimization', LicenseTier.FREE)).toBe(false);
    });

    it('should allow PRO features for PRO tier', () => {
      expect(isFeature('ml_strategies', LicenseTier.PRO)).toBe(true);
      expect(isFeature('premium_data', LicenseTier.PRO)).toBe(true);
      expect(isFeature('hyperparameter_tuning', LicenseTier.PRO)).toBe(true);
    });

    it('should deny ENTERPRISE features for PRO tier', () => {
      expect(isFeature('arbitrage_scanning', LicenseTier.PRO)).toBe(false);
      expect(isFeature('multi_exchange_trading', LicenseTier.PRO)).toBe(false);
      expect(isFeature('custom_strategies', LicenseTier.PRO)).toBe(false);
    });

    it('should allow all features for ENTERPRISE tier', () => {
      expect(isFeature('basic_strategies', LicenseTier.ENTERPRISE)).toBe(true);
      expect(isFeature('ml_strategies', LicenseTier.ENTERPRISE)).toBe(true);
      expect(isFeature('arbitrage_scanning', LicenseTier.ENTERPRISE)).toBe(true);
      expect(isFeature('priority_support', LicenseTier.ENTERPRISE)).toBe(true);
    });

    it('should return true for unknown features (no restriction)', () => {
      expect(isFeature('unknown_feature', LicenseTier.FREE)).toBe(true);
      expect(isFeature('custom_feature', LicenseTier.PRO)).toBe(true);
    });
  });

  describe('getRateLimits', () => {
    it('should return correct rate limits for FREE tier', () => {
      const limits = rateLimits(LicenseTier.FREE);
      expect(limits.requestsPerMin).toBe(10);
      expect(limits.requestsPerHour).toBe(100);
      expect(limits.burstPerSec).toBe(2);
    });

    it('should return correct rate limits for PRO tier', () => {
      const limits = rateLimits(LicenseTier.PRO);
      expect(limits.requestsPerMin).toBe(100);
      expect(limits.requestsPerHour).toBe(1000);
      expect(limits.burstPerSec).toBe(10);
    });

    it('should return correct rate limits for ENTERPRISE tier', () => {
      const limits = rateLimits(LicenseTier.ENTERPRISE);
      expect(limits.requestsPerMin).toBe(1000);
      expect(limits.requestsPerHour).toBe(10000);
      expect(limits.burstPerSec).toBe(50);
    });
  });

  describe('getDailyLimit', () => {
    it('should return correct daily limits', () => {
      expect(dailyLimit(LicenseTier.FREE)).toBe(100);
      expect(dailyLimit(LicenseTier.PRO)).toBe(10000);
      expect(dailyLimit(LicenseTier.ENTERPRISE)).toBe(100000);
    });
  });

  describe('getOveragePrice', () => {
    it('should return correct overage prices', () => {
      expect(overagePrice(LicenseTier.FREE)).toBe(0);
      expect(overagePrice(LicenseTier.PRO)).toBe(0.01);
      expect(overagePrice(LicenseTier.ENTERPRISE)).toBe(0.005);
    });
  });

  describe('validateLicense', () => {
    it('should not throw for valid license with sufficient tier', () => {
      const license: License = {
        id: 'lic_test',
        key: 'RAAS-RPP-TEST1234-KEY5678',
        name: 'Test License',
        tier: LicenseTier.PRO,
        status: LicenseStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        maxUsage: 10000,
      };

      expect(() => validate(license, 'ml_strategies')).not.toThrow();
    });

    it('should throw LicenseError when license is undefined', () => {
      expect(() => validate(undefined, 'ml_strategies')).toThrow(LicenseError);
    });

    it('should throw LicenseError when license is not active', () => {
      const license: License = {
        id: 'lic_test',
        key: 'RAAS-FREE-TEST1234-KEY5678',
        name: 'Inactive License',
        tier: LicenseTier.FREE,
        status: LicenseStatus.REVOKED,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        maxUsage: 100,
      };

      expect(() => validate(license, 'basic_strategies')).toThrow(LicenseError);
    });

    it('should throw LicenseError with insufficient tier', () => {
      const license: License = {
        id: 'lic_test',
        key: 'RAAS-FREE-TEST1234-KEY5678',
        name: 'Free License',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        maxUsage: 100,
      };

      expect(() => validate(license, 'ml_strategies')).toThrow(LicenseError);
    });
  });

  describe('requireTier', () => {
    it('should not throw when license meets required tier', () => {
      const license: License = {
        id: 'lic_test',
        key: 'RAAS-REP-TEST1234-KEY5678',
        name: 'Enterprise License',
        tier: LicenseTier.ENTERPRISE,
        status: LicenseStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        maxUsage: 100000,
      };

      expect(() => require(license, LicenseTier.PRO, 'test_feature')).not.toThrow();
    });

    it('should throw LicenseError when license tier is insufficient', () => {
      const license: License = {
        id: 'lic_test',
        key: 'RAAS-FREE-TEST1234-KEY5678',
        name: 'Free License',
        tier: LicenseTier.FREE,
        status: LicenseStatus.ACTIVE,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        usageCount: 0,
        maxUsage: 100,
      };

      expect(() => require(license, LicenseTier.ENTERPRISE, 'premium_feature')).toThrow(
        LicenseError
      );
    });

    it('should throw LicenseError when license is undefined', () => {
      expect(() => require(undefined, LicenseTier.PRO, 'feature')).toThrow(LicenseError);
    });
  });

  describe('RaasGate class', () => {
    let gate: RaasGate;
    let licenseService: LicenseService;

    beforeEach(() => {
      gate = RaasGate.getInstance();
      licenseService = gate.getLicenseService();
      (licenseService as any).licenses.clear();
    });

    describe('validateApiKey', () => {
      it('should return undefined for invalid key', async () => {
        // Create a license first
        await licenseService.createLicense({
          name: 'Test',
          tier: LicenseTier.PRO,
        });

        // Invalid key should return undefined
        const result = gate.validateApiKey('INVALID-KEY');
        expect(result).toBeUndefined();
      });
    });

    describe('hasAccess', () => {
      it('should return true for valid license with feature access', async () => {
        const license = await licenseService.createLicense({
          name: 'PRO License',
          tier: LicenseTier.PRO,
        });

        expect(gate.hasAccess(license, 'ml_strategies')).toBe(true);
      });

      it('should return false for license without feature access', async () => {
        const license = await licenseService.createLicense({
          name: 'FREE License',
          tier: LicenseTier.FREE,
        });

        expect(gate.hasAccess(license, 'ml_strategies')).toBe(false);
      });

      it('should return false for undefined license', () => {
        expect(gate.hasAccess(undefined, 'basic_strategies')).toBe(false);
      });
    });
  });

  describe('TIER_CONFIG', () => {
    it('should have correct features for FREE tier', () => {
      const features = TIER_CONFIG[LicenseTier.FREE].features;
      expect(features).toContain('basic_strategies');
      expect(features).toContain('live_trading');
      expect(features).toContain('basic_backtest');
    });

    it('should have correct features for PRO tier', () => {
      const features = TIER_CONFIG[LicenseTier.PRO].features;
      expect(features).toContain('ml_strategies');
      expect(features).toContain('premium_data');
      expect(features).toContain('advanced_optimization');
    });

    it('should have correct features for ENTERPRISE tier', () => {
      const features = TIER_CONFIG[LicenseTier.ENTERPRISE].features;
      expect(features).toContain('all_pro_features');
      expect(features).toContain('arbitrage_scanning');
      expect(features).toContain('multi_exchange_trading');
    });
  });

  describe('FEATURE_TIER_MAP', () => {
    it('should map all FREE features correctly', () => {
      expect(FEATURE_TIER_MAP['basic_strategies']).toBe(LicenseTier.FREE);
      expect(FEATURE_TIER_MAP['live_trading']).toBe(LicenseTier.FREE);
      expect(FEATURE_TIER_MAP['basic_backtest']).toBe(LicenseTier.FREE);
    });

    it('should map all PRO features correctly', () => {
      expect(FEATURE_TIER_MAP['ml_strategies']).toBe(LicenseTier.PRO);
      expect(FEATURE_TIER_MAP['premium_data']).toBe(LicenseTier.PRO);
      expect(FEATURE_TIER_MAP['tenant_management']).toBe(LicenseTier.PRO);
    });

    it('should map all ENTERPRISE features correctly', () => {
      expect(FEATURE_TIER_MAP['arbitrage_scanning']).toBe(LicenseTier.ENTERPRISE);
      expect(FEATURE_TIER_MAP['multi_exchange_trading']).toBe(LicenseTier.ENTERPRISE);
      expect(FEATURE_TIER_MAP['priority_support']).toBe(LicenseTier.ENTERPRISE);
    });
  });
});
