// Copy trading fee collector — extracts platform + leader fees from copy trade profits
// Revenue model: 10% performance fee on profitable copy trades, split 70/30 leader/platform
import { logger } from '../core/logger.js';

export interface FeeConfig {
  /** Total performance fee on copy trade profit (default 10%) */
  performanceFeeRate: number;
  /** Leader's share of the performance fee (default 70%) */
  leaderShareRate: number;
  /** Minimum profit to trigger fee (avoids dust fees) */
  minProfitThreshold: number;
}

export interface FeeRecord {
  copyTradeId: string;
  followerId: string;
  leaderId: string;
  grossProfit: number;
  totalFee: number;
  leaderPayout: number;
  platformRevenue: number;
  createdAt: number;
}

export interface PayoutSummary {
  leaderId: string;
  totalPayout: number;
  tradeCount: number;
  periodStart: number;
  periodEnd: number;
}

const DEFAULT_CONFIG: FeeConfig = {
  performanceFeeRate: 0.10,  // 10%
  leaderShareRate: 0.70,     // 70% to leader
  minProfitThreshold: 0.50,  // $0.50 minimum
};

export class CopyTradeFeeCollector {
  private readonly config: FeeConfig;
  private readonly feeRecords: FeeRecord[] = [];

  constructor(config?: Partial<FeeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Calculate and record fees for a completed copy trade.
   * Returns null if trade was not profitable or below threshold.
   */
  collectFee(
    copyTradeId: string,
    followerId: string,
    leaderId: string,
    grossProfit: number,
  ): FeeRecord | null {
    if (grossProfit <= this.config.minProfitThreshold) {
      return null; // No fee on losses or dust profits
    }

    const totalFee = grossProfit * this.config.performanceFeeRate;
    const leaderPayout = totalFee * this.config.leaderShareRate;
    const platformRevenue = totalFee - leaderPayout;

    const record: FeeRecord = {
      copyTradeId,
      followerId,
      leaderId,
      grossProfit,
      totalFee,
      leaderPayout,
      platformRevenue,
      createdAt: Date.now(),
    };

    this.feeRecords.push(record);

    logger.info('Copy trade fee collected', 'FeeCollector', {
      copyTradeId, leaderId, grossProfit: grossProfit.toFixed(2),
      totalFee: totalFee.toFixed(2), leaderPayout: leaderPayout.toFixed(2),
    });

    return record;
  }

  /** Get all fee records for a specific leader */
  getLeaderFees(leaderId: string): FeeRecord[] {
    return this.feeRecords.filter(r => r.leaderId === leaderId);
  }

  /** Get all fee records for a specific follower */
  getFollowerFees(followerId: string): FeeRecord[] {
    return this.feeRecords.filter(r => r.followerId === followerId);
  }

  /** Calculate payout summary for a leader over a time period */
  getPayoutSummary(leaderId: string, sinceDaysAgo = 30): PayoutSummary {
    const cutoff = Date.now() - sinceDaysAgo * 86_400_000;
    const records = this.feeRecords.filter(r => r.leaderId === leaderId && r.createdAt >= cutoff);

    return {
      leaderId,
      totalPayout: records.reduce((sum, r) => sum + r.leaderPayout, 0),
      tradeCount: records.length,
      periodStart: cutoff,
      periodEnd: Date.now(),
    };
  }

  /** Total platform revenue from all copy trades */
  getTotalPlatformRevenue(sinceDaysAgo = 30): number {
    const cutoff = Date.now() - sinceDaysAgo * 86_400_000;
    return this.feeRecords
      .filter(r => r.createdAt >= cutoff)
      .reduce((sum, r) => sum + r.platformRevenue, 0);
  }

  /** All fee records (for admin dashboard) */
  getAllRecords(): FeeRecord[] {
    return [...this.feeRecords];
  }
}
