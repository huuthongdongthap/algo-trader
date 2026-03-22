import { describe, it, expect } from 'vitest';
import { REWARD_TIERS } from '../../src/referral/reward-calculator.js';

// Test the pure getRewardTier logic (extracted from class to avoid SQLite dependency)
function getRewardTier(referralCount: number) {
  let current = REWARD_TIERS[0];
  for (const tier of REWARD_TIERS) {
    if (referralCount >= tier.minReferrals) {
      current = tier;
    }
  }
  return current;
}

describe('Reward Tiers', () => {
  it('should have 3 tiers', () => {
    expect(REWARD_TIERS.length).toBe(3);
  });

  it('should return base tier for 0 referrals', () => {
    const tier = getRewardTier(0);
    expect(tier.commissionPercent).toBe(10);
    expect(tier.bonusUsdc).toBe(0);
  });

  it('should return tier 2 for 5+ referrals', () => {
    const tier = getRewardTier(5);
    expect(tier.commissionPercent).toBe(15);
    expect(tier.bonusUsdc).toBe(50);
  });

  it('should return tier 3 for 20+ referrals', () => {
    const tier = getRewardTier(20);
    expect(tier.commissionPercent).toBe(20);
    expect(tier.bonusUsdc).toBe(200);
  });

  it('should stay at highest tier for large counts', () => {
    const tier = getRewardTier(1000);
    expect(tier.commissionPercent).toBe(20);
  });

  it('should return base tier for 4 referrals (below tier 2)', () => {
    const tier = getRewardTier(4);
    expect(tier.commissionPercent).toBe(10);
  });

  it('should calculate commission correctly', () => {
    // 10% commission on $29 subscription
    const commission = 29 * (getRewardTier(0).commissionPercent / 100);
    expect(commission).toBeCloseTo(2.9, 2);

    // 20% commission on $199 enterprise
    const commission2 = 199 * (getRewardTier(20).commissionPercent / 100);
    expect(commission2).toBeCloseTo(39.8, 2);
  });
});
