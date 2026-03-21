// Commission & reward calculation for referral system
// Tier-based: commission % scales up with total referral count

import type { ReferralStore } from './referral-store.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface RewardTier {
  /** Minimum referral count to qualify */
  minReferrals: number;
  /** Commission percentage (10 = 10%) */
  commissionPercent: number;
  /** One-time bonus in USDC when tier is first reached */
  bonusUsdc: number;
}

export interface PendingPayout {
  payoutId: number;
  referrerId: string;
  amountUsdc: string;
  createdAt: number;
}

// ── Tier config ────────────────────────────────────────────────────────────

export const REWARD_TIERS: RewardTier[] = [
  { minReferrals: 0,  commissionPercent: 10, bonusUsdc: 0   },
  { minReferrals: 5,  commissionPercent: 15, bonusUsdc: 50  },
  { minReferrals: 20, commissionPercent: 20, bonusUsdc: 200 },
];

// ── Calculator class ───────────────────────────────────────────────────────

export class RewardCalculator {
  constructor(private readonly store: ReferralStore) {}

  /**
   * Get reward tier for a referrer based on their total referral count.
   * Returns the highest tier the user qualifies for.
   */
  getRewardTier(referralCount: number): RewardTier {
    // Tiers sorted ascending by minReferrals; find last qualifying tier
    let current = REWARD_TIERS[0];
    for (const tier of REWARD_TIERS) {
      if (referralCount >= tier.minReferrals) {
        current = tier;
      }
    }
    return current;
  }

  /**
   * Calculate commission amount for a single subscription payment.
   * Commission = subscriptionAmount * (commissionPercent / 100)
   * Returns amount as a string with 2 decimal places.
   */
  calculateCommission(referrerId: string, subscriptionAmount: number): string {
    const links = this.store.getLinksForReferrer(referrerId);
    const tier = this.getRewardTier(links.length);
    const commission = subscriptionAmount * (tier.commissionPercent / 100);
    return commission.toFixed(2);
  }

  /**
   * Calculate total lifetime earnings for a referrer from all payouts.
   */
  calculateLifetimeEarnings(referrerId: string): string {
    const payouts = this.store.getPayoutsForReferrer(referrerId);
    const total = payouts.reduce((sum, p) => sum + parseFloat(p.amount_usdc), 0);
    return total.toFixed(2);
  }

  /**
   * Record a commission payout for a referrer.
   * Typically called when a referred user makes a subscription payment.
   */
  recordCommission(referrerId: string, subscriptionAmount: number): number {
    const amount = this.calculateCommission(referrerId, subscriptionAmount);
    return this.store.savePayout(referrerId, amount);
  }

  /**
   * Get all unpaid commission payouts across all referrers.
   */
  getPendingPayouts(): PendingPayout[] {
    return this.store.getPendingPayouts().map((row) => ({
      payoutId: row.id,
      referrerId: row.referrer_id,
      amountUsdc: row.amount_usdc,
      createdAt: row.created_at,
    }));
  }

  /**
   * Mark a payout as paid.
   */
  markPaid(payoutId: number): void {
    this.store.markPayoutPaid(payoutId);
  }

  /**
   * Get referral count and current tier summary for a user.
   */
  getReferralSummary(referrerId: string): {
    referralCount: number;
    tier: RewardTier;
    lifetimeEarnings: string;
  } {
    const links = this.store.getLinksForReferrer(referrerId);
    const tier = this.getRewardTier(links.length);
    const lifetimeEarnings = this.calculateLifetimeEarnings(referrerId);
    return { referralCount: links.length, tier, lifetimeEarnings };
  }
}
