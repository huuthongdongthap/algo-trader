// Periodic portfolio rebalancing: drift detection and rebalance order generation
import type { StrategyName } from '../core/types.js';

export interface RebalanceOrder {
  strategy: StrategyName;
  action: 'increase' | 'decrease';
  /** Absolute amount to move */
  amount: number;
  /** Current allocation */
  currentAmount: number;
  /** Target allocation */
  targetAmount: number;
}

export interface RebalancerConfig {
  /** Drift threshold as decimal (0.05 = 5%) before rebalance triggered */
  driftThreshold: number;
  /** Minimum interval between rebalances in milliseconds */
  intervalMs: number;
}

const DEFAULT_CONFIG: RebalancerConfig = {
  driftThreshold: 0.05,
  intervalMs: 4 * 60 * 60 * 1000, // 4 hours
};

export class Rebalancer {
  private config: RebalancerConfig;
  private lastRebalanceAt: number = 0;

  constructor(config: Partial<RebalancerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Returns true if any strategy drifts beyond threshold OR interval elapsed.
   * current/target: Map<StrategyName, amount>
   */
  shouldRebalance(
    current: Map<StrategyName, number>,
    target: Map<StrategyName, number>,
    now: number = Date.now(),
  ): boolean {
    // Respect minimum interval
    if (now - this.lastRebalanceAt < this.config.intervalMs) return false;

    for (const [name, targetAmount] of target) {
      if (targetAmount === 0) continue;
      const currentAmount = current.get(name) ?? 0;
      const drift = Math.abs(currentAmount - targetAmount) / targetAmount;
      if (drift > this.config.driftThreshold) return true;
    }
    return false;
  }

  /**
   * Calculate rebalance orders to move from current to target allocations.
   * Only produces orders where drift exceeds threshold.
   */
  calculateRebalanceOrders(
    current: Map<StrategyName, number>,
    target: Map<StrategyName, number>,
  ): RebalanceOrder[] {
    const orders: RebalanceOrder[] = [];

    for (const [name, targetAmount] of target) {
      const currentAmount = current.get(name) ?? 0;
      const diff = targetAmount - currentAmount;
      const absDiff = Math.abs(diff);

      // Skip negligible drifts (< $0.01)
      if (absDiff < 0.01) continue;

      // Skip if within threshold
      if (targetAmount > 0) {
        const drift = absDiff / targetAmount;
        if (drift <= this.config.driftThreshold) continue;
      }

      orders.push({
        strategy: name,
        action: diff > 0 ? 'increase' : 'decrease',
        amount: parseFloat(absDiff.toFixed(2)),
        currentAmount: parseFloat(currentAmount.toFixed(2)),
        targetAmount: parseFloat(targetAmount.toFixed(2)),
      });
    }

    return orders.sort((a, b) => b.amount - a.amount);
  }

  /** Record that a rebalance was executed */
  markRebalanced(now: number = Date.now()): void {
    this.lastRebalanceAt = now;
  }

  /** Time in ms until next rebalance is eligible */
  msUntilNextEligible(now: number = Date.now()): number {
    const elapsed = now - this.lastRebalanceAt;
    return Math.max(0, this.config.intervalMs - elapsed);
  }

  getConfig(): Readonly<RebalancerConfig> {
    return this.config;
  }
}
