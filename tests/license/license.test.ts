import { describe, it, expect } from 'vitest';
import {
  buildPayload,
  generateLicense,
  parseLicenseKey,
  getTierDefaults,
} from '../../src/license/license-generator.js';
import {
  validateLicense,
  isExpired,
  hasFeature,
  canTrade,
  getRemainingDays,
  canAccessMarkets,
} from '../../src/license/license-validator.js';

const SECRET = 'test-secret-key-for-hmac';

function makePayload(tier: 'free' | 'pro' | 'enterprise' = 'pro') {
  return buildPayload({
    userId: 'u-1',
    tier,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  });
}

describe('License Generator', () => {
  it('should build payload with tier defaults', () => {
    const payload = makePayload('free');
    expect(payload.maxMarkets).toBe(1);
    expect(payload.maxTradesPerDay).toBe(5);
    expect(payload.features).toHaveLength(0);
  });

  it('should build pro payload with correct defaults', () => {
    const payload = makePayload('pro');
    expect(payload.maxMarkets).toBe(10);
    expect(payload.maxTradesPerDay).toBe(-1);
    expect(payload.features).toContain('backtesting');
  });

  it('should build enterprise payload', () => {
    const payload = makePayload('enterprise');
    expect(payload.maxMarkets).toBe(-1);
    expect(payload.maxTradesPerDay).toBe(-1);
  });

  it('should allow override of defaults', () => {
    const payload = buildPayload({
      userId: 'u-1',
      tier: 'free',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 86400000,
      maxMarkets: 99,
    });
    expect(payload.maxMarkets).toBe(99);
  });

  it('should generate and parse license key', () => {
    const payload = makePayload();
    const key = generateLicense(payload, SECRET);
    expect(key).toContain('.');

    const parsed = parseLicenseKey(key);
    expect(parsed).not.toBeNull();
    expect(parsed!.userId).toBe('u-1');
    expect(parsed!.tier).toBe('pro');
  });

  it('should return null for malformed key', () => {
    expect(parseLicenseKey('no-dot-here')).toBeNull();
  });

  it('should get tier defaults', () => {
    const defaults = getTierDefaults('enterprise');
    expect(defaults.maxMarkets).toBe(-1);
    expect(defaults.features).toContain('webhook');
  });
});

describe('License Validator', () => {
  it('should validate correct license', () => {
    const payload = makePayload();
    const key = generateLicense(payload, SECRET);
    const result = validateLicense(key, SECRET);
    expect(result.valid).toBe(true);
    expect(result.payload!.userId).toBe('u-1');
  });

  it('should reject tampered payload', () => {
    const payload = makePayload();
    const key = generateLicense(payload, SECRET);
    // Tamper with payload part
    const tampered = 'X' + key.slice(1);
    const result = validateLicense(tampered, SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('signature');
  });

  it('should reject wrong secret', () => {
    const payload = makePayload();
    const key = generateLicense(payload, SECRET);
    const result = validateLicense(key, 'wrong-secret');
    expect(result.valid).toBe(false);
  });

  it('should reject expired license', () => {
    const payload = buildPayload({
      userId: 'u-1',
      tier: 'pro',
      issuedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
    });
    const key = generateLicense(payload, SECRET);
    const result = validateLicense(key, SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('should reject malformed key', () => {
    const result = validateLicense('nodotatall', SECRET);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Malformed');
  });

  it('should check isExpired', () => {
    const active = makePayload();
    expect(isExpired(active)).toBe(false);

    const expired = buildPayload({
      userId: 'u-1',
      tier: 'free',
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(isExpired(expired)).toBe(true);
  });

  it('should check hasFeature', () => {
    const payload = makePayload('pro');
    expect(hasFeature(payload, 'backtesting')).toBe(true);
    expect(hasFeature(payload, 'optimizer')).toBe(false);
  });

  it('should check canTrade', () => {
    const free = makePayload('free');
    expect(canTrade(free, 0)).toBe(true);
    expect(canTrade(free, 4)).toBe(true);
    expect(canTrade(free, 5)).toBe(false);

    const pro = makePayload('pro');
    expect(canTrade(pro, 9999)).toBe(true); // unlimited
  });

  it('should calculate remaining days', () => {
    const payload = makePayload();
    const days = getRemainingDays(payload);
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  it('should return 0 days for expired', () => {
    const expired = buildPayload({
      userId: 'u-1',
      tier: 'free',
      issuedAt: 1000,
      expiresAt: 2000,
    });
    expect(getRemainingDays(expired)).toBe(0);
  });

  it('should check canAccessMarkets', () => {
    const free = makePayload('free');
    expect(canAccessMarkets(free, 1)).toBe(true);
    expect(canAccessMarkets(free, 2)).toBe(false);

    const enterprise = makePayload('enterprise');
    expect(canAccessMarkets(enterprise, 100)).toBe(true);
  });
});
