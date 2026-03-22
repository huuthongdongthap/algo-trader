import { describe, it, expect } from 'vitest';
import { TIER_CONFIG, getTierLimits, getMonthlyPrice, hasFeature, canAddStrategy, isCapitalAllowed } from '../../src/users/subscription-tier.js';
import type { Tier } from '../../src/users/subscription-tier.js';

describe('Onboarding — Subscription Tier Config', () => {
  it('should define three tiers', () => {
    const tiers = Object.keys(TIER_CONFIG);
    expect(tiers).toEqual(['free', 'pro', 'enterprise']);
  });

  it('free tier has strict limits', () => {
    const free = TIER_CONFIG.free;
    expect(free.maxStrategies).toBe(1);
    expect(free.maxCapital).toBe(1_000);
    expect(free.apiRateLimit).toBe(10);
    expect(free.features).toEqual([]);
  });

  it('pro tier has moderate limits', () => {
    const pro = TIER_CONFIG.pro;
    expect(pro.maxStrategies).toBe(3);
    expect(pro.maxCapital).toBe(50_000);
    expect(pro.apiRateLimit).toBe(60);
    expect(pro.features).toContain('backtesting');
    expect(pro.features).toContain('ai-analyze');
  });

  it('enterprise tier has unlimited resources', () => {
    const ent = TIER_CONFIG.enterprise;
    expect(ent.maxStrategies).toBe(Infinity);
    expect(ent.maxCapital).toBe(Infinity);
    expect(ent.apiRateLimit).toBe(300);
    expect(ent.features).toContain('optimizer');
    expect(ent.features).toContain('ai-auto-tune');
  });

  it('getTierLimits returns correct config', () => {
    expect(getTierLimits('pro')).toEqual(TIER_CONFIG.pro);
  });

  it('getMonthlyPrice returns correct prices', () => {
    expect(getMonthlyPrice('free')).toBe(0);
    expect(getMonthlyPrice('pro')).toBe(29);
    expect(getMonthlyPrice('enterprise')).toBe(199);
  });

  it('hasFeature checks correctly', () => {
    expect(hasFeature('free', 'backtesting')).toBe(false);
    expect(hasFeature('pro', 'backtesting')).toBe(true);
    expect(hasFeature('enterprise', 'ai-auto-tune')).toBe(true);
    expect(hasFeature('pro', 'ai-auto-tune')).toBe(false);
  });

  it('canAddStrategy enforces limits', () => {
    expect(canAddStrategy('free', 0)).toBe(true);
    expect(canAddStrategy('free', 1)).toBe(false);
    expect(canAddStrategy('pro', 2)).toBe(true);
    expect(canAddStrategy('pro', 3)).toBe(false);
    expect(canAddStrategy('enterprise', 999)).toBe(true);
  });

  it('isCapitalAllowed enforces limits', () => {
    expect(isCapitalAllowed('free', 500)).toBe(true);
    expect(isCapitalAllowed('free', 1500)).toBe(false);
    expect(isCapitalAllowed('pro', 50_000)).toBe(true);
    expect(isCapitalAllowed('pro', 50_001)).toBe(false);
    expect(isCapitalAllowed('enterprise', 10_000_000)).toBe(true);
  });
});
