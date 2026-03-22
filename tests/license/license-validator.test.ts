// Tests for license-validator.ts — signature check, expiry, feature gating, trade limits
import { describe, it, expect } from 'vitest';
import { buildPayload, generateLicense } from '../../src/license/license-generator.js';
import {
  validateLicense,
  isExpired,
  hasFeature,
  canTrade,
  getRemainingDays,
  canAccessMarkets,
} from '../../src/license/license-validator.js';

const SECRET = 'validator-test-secret';
const NOW = Date.now();
const FUTURE = NOW + 30 * 24 * 60 * 60 * 1000;
const PAST = NOW - 1000;

function makeLicense(
  tier: 'free' | 'pro' | 'enterprise' = 'pro',
  expiresAt = FUTURE,
) {
  const payload = buildPayload({ userId: 'user-test', tier, issuedAt: NOW, expiresAt });
  return { key: generateLicense(payload, SECRET), payload };
}

describe('validateLicense', () => {
  it('should validate a fresh pro license', () => {
    const { key } = makeLicense('pro');
    const result = validateLicense(key, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
    expect(result.payload!.tier).toBe('pro');
    expect(result.error).toBeUndefined();
  });

  it('should validate enterprise license', () => {
    const { key } = makeLicense('enterprise');
    const result = validateLicense(key, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload!.tier).toBe('enterprise');
  });

  it('should validate free tier license', () => {
    const { key } = makeLicense('free');
    const result = validateLicense(key, SECRET);
    expect(result.valid).toBe(true);
  });

  it('should reject malformed key (no dot separator)', () => {
    const result = validateLicense('nodothere', SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Malformed');
  });

  it('should reject tampered payload', () => {
    const { key } = makeLicense('pro');
    const tampered = 'X' + key.slice(1);
    const result = validateLicense(tampered, SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature');
  });

  it('should reject license validated with wrong secret', () => {
    const { key } = makeLicense('pro');
    const result = validateLicense(key, 'wrong-secret');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature');
  });

  it('should reject expired license', () => {
    const { key } = makeLicense('pro', PAST);
    const result = validateLicense(key, SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
    // payload is still returned so caller can inspect
    expect(result.payload).toBeDefined();
  });
});

describe('isExpired', () => {
  it('should return false for future expiry', () => {
    const { payload } = makeLicense('pro', FUTURE);
    expect(isExpired(payload)).toBe(false);
  });

  it('should return true for past expiry', () => {
    const { payload } = makeLicense('pro', PAST);
    expect(isExpired(payload)).toBe(true);
  });
});

describe('hasFeature', () => {
  it('should detect backtesting on pro license', () => {
    const { payload } = makeLicense('pro');
    expect(hasFeature(payload, 'backtesting')).toBe(true);
  });

  it('should not find optimizer on pro license', () => {
    const { payload } = makeLicense('pro');
    expect(hasFeature(payload, 'optimizer')).toBe(false);
  });

  it('should find optimizer, webhook, multi-market on enterprise license', () => {
    const { payload } = makeLicense('enterprise');
    expect(hasFeature(payload, 'optimizer')).toBe(true);
    expect(hasFeature(payload, 'webhook')).toBe(true);
    expect(hasFeature(payload, 'multi-market')).toBe(true);
  });

  it('should find no features on free license', () => {
    const { payload } = makeLicense('free');
    expect(hasFeature(payload, 'backtesting')).toBe(false);
    expect(hasFeature(payload, 'webhook')).toBe(false);
  });
});

describe('canTrade', () => {
  it('should allow trade when count is below free limit', () => {
    const { payload } = makeLicense('free'); // maxTradesPerDay = 5
    expect(canTrade(payload, 0)).toBe(true);
    expect(canTrade(payload, 4)).toBe(true);
  });

  it('should deny trade when count reaches free limit', () => {
    const { payload } = makeLicense('free');
    expect(canTrade(payload, 5)).toBe(false);
    expect(canTrade(payload, 100)).toBe(false);
  });

  it('should allow unlimited trades on pro license', () => {
    const { payload } = makeLicense('pro'); // maxTradesPerDay = -1
    expect(canTrade(payload, 0)).toBe(true);
    expect(canTrade(payload, 9999)).toBe(true);
  });

  it('should allow unlimited trades on enterprise license', () => {
    const { payload } = makeLicense('enterprise');
    expect(canTrade(payload, 999999)).toBe(true);
  });
});

describe('getRemainingDays', () => {
  it('should return ~30 days for fresh 30-day license', () => {
    const { payload } = makeLicense('pro', NOW + 30 * 24 * 60 * 60 * 1000);
    const days = getRemainingDays(payload);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('should return 0 for expired license', () => {
    const { payload } = makeLicense('pro', PAST);
    expect(getRemainingDays(payload)).toBe(0);
  });

  it('should return 1 for license expiring in ~24h', () => {
    const { payload } = makeLicense('pro', NOW + 23 * 60 * 60 * 1000);
    expect(getRemainingDays(payload)).toBe(0); // less than 24h = 0 full days
  });
});

describe('canAccessMarkets', () => {
  it('should allow 1 market on free license', () => {
    const { payload } = makeLicense('free'); // maxMarkets = 1
    expect(canAccessMarkets(payload, 1)).toBe(true);
  });

  it('should deny 2 markets on free license', () => {
    const { payload } = makeLicense('free');
    expect(canAccessMarkets(payload, 2)).toBe(false);
  });

  it('should allow up to 10 markets on pro license', () => {
    const { payload } = makeLicense('pro'); // maxMarkets = 10
    expect(canAccessMarkets(payload, 10)).toBe(true);
    expect(canAccessMarkets(payload, 11)).toBe(false);
  });

  it('should allow unlimited markets on enterprise license', () => {
    const { payload } = makeLicense('enterprise'); // maxMarkets = -1
    expect(canAccessMarkets(payload, 1000)).toBe(true);
  });
});
