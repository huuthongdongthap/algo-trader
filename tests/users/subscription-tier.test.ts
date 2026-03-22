import { describe, it, expect } from 'vitest';
import {
  getTierLimits,
  getMonthlyPrice,
  hasFeature,
  canAddStrategy,
  isCapitalAllowed,
  TIER_CONFIG,
} from '../../src/users/subscription-tier.js';

describe('Subscription Tier', () => {
  it('should return correct free tier limits', () => {
    const limits = getTierLimits('free');
    expect(limits.maxStrategies).toBe(1);
    expect(limits.maxCapital).toBe(1_000);
    expect(limits.apiRateLimit).toBe(10);
    expect(limits.features).toHaveLength(0);
  });

  it('should return correct pro tier limits', () => {
    const limits = getTierLimits('pro');
    expect(limits.maxStrategies).toBe(3);
    expect(limits.maxCapital).toBe(50_000);
    expect(limits.apiRateLimit).toBe(60);
    expect(limits.features).toContain('backtesting');
    expect(limits.features).toContain('multi-market');
    expect(limits.features).toContain('ai-analyze');
  });

  it('should return correct enterprise tier limits', () => {
    const limits = getTierLimits('enterprise');
    expect(limits.maxStrategies).toBe(Infinity);
    expect(limits.maxCapital).toBe(Infinity);
    expect(limits.apiRateLimit).toBe(300);
    expect(limits.features).toContain('ai-auto-tune');
    expect(limits.features).toContain('optimizer');
    expect(limits.features).toContain('webhook');
  });

  it('should return correct monthly prices', () => {
    expect(getMonthlyPrice('free')).toBe(0);
    expect(getMonthlyPrice('pro')).toBe(29);
    expect(getMonthlyPrice('enterprise')).toBe(199);
  });

  it('should check hasFeature correctly', () => {
    expect(hasFeature('free', 'backtesting')).toBe(false);
    expect(hasFeature('pro', 'backtesting')).toBe(true);
    expect(hasFeature('pro', 'optimizer')).toBe(false);
    expect(hasFeature('enterprise', 'optimizer')).toBe(true);
  });

  it('should check canAddStrategy with free tier', () => {
    expect(canAddStrategy('free', 0)).toBe(true);
    expect(canAddStrategy('free', 1)).toBe(false);
  });

  it('should check canAddStrategy with pro tier', () => {
    expect(canAddStrategy('pro', 0)).toBe(true);
    expect(canAddStrategy('pro', 2)).toBe(true);
    expect(canAddStrategy('pro', 3)).toBe(false);
  });

  it('should allow unlimited strategies for enterprise', () => {
    expect(canAddStrategy('enterprise', 100)).toBe(true);
    expect(canAddStrategy('enterprise', 999)).toBe(true);
  });

  it('should check isCapitalAllowed', () => {
    expect(isCapitalAllowed('free', 500)).toBe(true);
    expect(isCapitalAllowed('free', 1001)).toBe(false);
    expect(isCapitalAllowed('pro', 50_000)).toBe(true);
    expect(isCapitalAllowed('pro', 50_001)).toBe(false);
    expect(isCapitalAllowed('enterprise', 1_000_000)).toBe(true);
  });
});
