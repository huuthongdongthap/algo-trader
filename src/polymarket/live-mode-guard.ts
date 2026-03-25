// Live Mode Guard — safety gate called BEFORE every ClobClient.placeOrder()
// Validates: capital tier, dry-run days, daily loss, circuit breaker

import type { RiskManager } from '../core/risk-manager.js';
import type { Position } from '../core/types.js';
import { getCurrentTier, canProgressToNextTier, type DailyRecord } from '../core/capital-tiers.js';
import { logger } from '../core/logger.js';

export interface LiveModeGuardConfig {
  /** Current capital in USDC */
  capital: number;
  /** Daily trading records for current tier */
  dailyRecords: DailyRecord[];
  /** Is paper trading mode? */
  paperTrading: boolean;
}

export interface GuardResult {
  allowed: boolean;
  reason: string;
}

export class LiveModeGuard {
  constructor(
    private riskManager: RiskManager,
    private config: LiveModeGuardConfig,
  ) {}

  /**
   * Check ALL safety conditions before placing an order.
   * Returns { allowed, reason } — caller MUST respect the result.
   */
  check(
    proposedSize: string,
    currentPositions: Position[],
  ): GuardResult {
    // Paper mode always allowed (no real money at risk)
    if (this.config.paperTrading) {
      return { allowed: true, reason: 'Paper trading mode' };
    }

    // 1. Capital tier validation
    const tier = getCurrentTier(this.config.capital);
    if (this.config.capital > tier.maxCapital) {
      return {
        allowed: false,
        reason: `Capital $${this.config.capital} exceeds tier ${tier.level} max ($${tier.maxCapital})`,
      };
    }

    // 2. Minimum dry-run days check
    if (this.config.dailyRecords.length < tier.minDryRunDays) {
      return {
        allowed: false,
        reason: `Tier ${tier.level} requires ${tier.minDryRunDays} dry-run days, completed ${this.config.dailyRecords.length}`,
      };
    }

    // 3. Profitable days check
    const profitableDays = this.config.dailyRecords.filter(r => r.pnl > 0).length;
    if (profitableDays < tier.minProfitableDays) {
      return {
        allowed: false,
        reason: `Tier ${tier.level} requires ${tier.minProfitableDays} profitable days, achieved ${profitableDays}`,
      };
    }

    // 4. Delegate to RiskManager for daily loss limit + circuit breaker + position checks
    const riskCheck = this.riskManager.checkTrade(
      String(this.config.capital),
      currentPositions,
      proposedSize,
    );

    if (!riskCheck.allowed) {
      return { allowed: false, reason: riskCheck.reason };
    }

    logger.debug('Live mode guard: PASSED', 'LiveModeGuard', {
      tier: tier.level,
      capital: this.config.capital,
      size: proposedSize,
    });

    return { allowed: true, reason: 'All checks passed' };
  }

  /** Update capital (e.g., after a trade settles) */
  updateCapital(newCapital: number): void {
    this.config.capital = newCapital;
  }

  /** Add a daily record */
  addDailyRecord(record: DailyRecord): void {
    this.config.dailyRecords.push(record);
  }
}
