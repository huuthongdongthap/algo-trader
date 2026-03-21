// Referral code management: generate, redeem, stats, deactivate
// Orchestrates ReferralStore + RewardCalculator

import type { ReferralStore, ReferralCodeRow, ReferralLinkRow } from './referral-store.js';
import type { RewardCalculator } from './reward-calculator.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ReferralCode {
  code: string;
  ownerId: string;
  createdAt: number;
  usageCount: number;
  maxUses: number;
  active: boolean;
}

export interface CodeStats {
  code: string;
  usageCount: number;
  /** Number of users successfully linked via this code */
  conversions: number;
  /** Total commission revenue attributed to this code (USDC string) */
  revenueAttributed: string;
}

export interface ReferralLink {
  referrerId: string;
  refereeId: string;
  code: string;
  createdAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // unambiguous chars
const CODE_LENGTH = 8;

function generateRandomCode(): string {
  let result = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    result += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return result;
}

function rowToReferralCode(row: ReferralCodeRow): ReferralCode {
  return {
    code: row.code,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    usageCount: row.usage_count,
    maxUses: row.max_uses,
    active: row.active === 1,
  };
}

function rowToReferralLink(row: ReferralLinkRow): ReferralLink {
  return {
    referrerId: row.referrer_id,
    refereeId: row.referee_id,
    code: row.code,
    createdAt: row.created_at,
  };
}

// ── Manager class ──────────────────────────────────────────────────────────

export class ReferralManager {
  constructor(
    private readonly store: ReferralStore,
    private readonly calculator: RewardCalculator,
  ) {}

  /**
   * Generate a unique 8-char referral code for a user.
   * Retries up to 5 times on collision.
   */
  generateCode(userId: string, maxUses = 100): ReferralCode {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateRandomCode();
      if (!this.store.getCodeByValue(code)) {
        this.store.saveCode(code, userId, maxUses);
        return rowToReferralCode(this.store.getCodeByValue(code)!);
      }
    }
    throw new Error('Failed to generate unique referral code after 5 attempts');
  }

  /**
   * Redeem a referral code for a new user.
   * Validates: code exists, is active, has capacity, user not already referred.
   */
  redeemCode(code: string, newUserId: string): ReferralLink {
    const row = this.store.getCodeByValue(code);
    if (!row) throw new Error(`Referral code not found: ${code}`);
    if (!row.active) throw new Error(`Referral code is inactive: ${code}`);
    if (row.usage_count >= row.max_uses) throw new Error(`Referral code exhausted: ${code}`);
    if (row.owner_id === newUserId) throw new Error('Cannot redeem your own referral code');

    // Prevent double redemption
    const existing = this.store.getLinkForReferee(newUserId);
    if (existing) throw new Error(`User ${newUserId} already redeemed a referral code`);

    this.store.saveLink(row.owner_id, newUserId, code);
    this.store.incrementUsage(code);

    return {
      referrerId: row.owner_id,
      refereeId: newUserId,
      code,
      createdAt: Date.now(),
    };
  }

  /**
   * Get usage stats for a specific code.
   * revenueAttributed = sum of payouts for all referrals made via this code.
   */
  getCodeStats(code: string): CodeStats {
    const row = this.store.getCodeByValue(code);
    if (!row) throw new Error(`Referral code not found: ${code}`);

    // Count links specifically tied to this code
    const links = this.store.getLinksForReferrer(row.owner_id)
      .filter((l) => l.code === code);

    // Sum payouts attributed via this code's referrals
    const payouts = this.store.getPayoutsForReferrer(row.owner_id);
    const revenueAttributed = payouts
      .reduce((sum, p) => sum + parseFloat(p.amount_usdc), 0)
      .toFixed(2);

    return {
      code,
      usageCount: row.usage_count,
      conversions: links.length,
      revenueAttributed,
    };
  }

  /**
   * List all users referred by this user (across all their codes).
   */
  getUserReferrals(userId: string): ReferralLink[] {
    return this.store.getLinksForReferrer(userId).map(rowToReferralLink);
  }

  /**
   * Disable a referral code so it can no longer be redeemed.
   */
  deactivateCode(code: string): void {
    const row = this.store.getCodeByValue(code);
    if (!row) throw new Error(`Referral code not found: ${code}`);
    this.store.deactivateCode(code);
  }

  /**
   * Get all codes owned by a user.
   */
  getUserCodes(userId: string): ReferralCode[] {
    return this.store.getCodesForOwner(userId).map(rowToReferralCode);
  }
}
