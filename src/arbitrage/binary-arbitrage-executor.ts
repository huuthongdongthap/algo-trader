/**
 * Binary Arbitrage Executor
 * Executes binary prediction market arbitrage trades on Polymarket.
 * Uses fractional Kelly Criterion (25-50%) for position sizing.
 * Always apply dryRun=true in production until fully validated.
 */

import { BinaryArbitrageOpportunity, ExecutionResult, ExecutedLeg } from './types';

/** Configuration for binary arbitrage execution */
export interface BinaryExecutorConfig {
  /** Maximum USD position size per trade */
  maxPositionSize: number;
  /** Kelly fraction — use 0.25 to 0.50 for safety (default 0.25) */
  kellyFraction: number;
  /** Maximum allowed drawdown as fraction of bankroll before halting (default 0.20) */
  maxDrawdownPct: number;
  /** If true, log actions but do not place real orders (default true) */
  dryRun: boolean;
}

const DEFAULT_CONFIG: BinaryExecutorConfig = {
  maxPositionSize: 1000,
  kellyFraction: 0.25,
  maxDrawdownPct: 0.20,
  dryRun: true,
};

/** Internal execution log entry for audit trail */
interface ExecutionLogEntry {
  opportunityId: string;
  timestamp: number;
  positionSize: number;
  dryRun: boolean;
  result: 'executed' | 'skipped' | 'failed';
  reason?: string;
}

export class BinaryArbitrageExecutor {
  private config: BinaryExecutorConfig;
  private executionLog: ExecutionLogEntry[] = [];
  private currentPnL = 0;

  constructor(config: Partial<BinaryExecutorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute or simulate a binary arbitrage opportunity.
   * Applies Kelly sizing, drawdown guard, and dryRun bypass.
   */
  async execute(opportunity: BinaryArbitrageOpportunity): Promise<ExecutionResult> {
    const bankroll = this.config.maxPositionSize;
    const positionSize = this.calculateKellySize(
      opportunity.mispricing,
      opportunity.confidence / 100,
      bankroll
    );

    if (!this.checkDrawdownLimit(this.currentPnL)) {
      this.log(opportunity.id, positionSize, 'skipped', 'Drawdown limit reached');
      return this.buildResult(opportunity, false, [], 0, 'Drawdown limit reached');
    }

    if (this.config.dryRun) {
      this.log(opportunity.id, positionSize, 'executed');
      return this.simulateExecution(opportunity, positionSize);
    }

    try {
      const executedLegs = await this.placeOrders(opportunity, positionSize);
      const profit = this.calculateProfit(executedLegs, opportunity);
      this.currentPnL += profit;
      this.log(opportunity.id, positionSize, 'executed');
      return this.buildResult(opportunity, true, executedLegs, profit);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.log(opportunity.id, positionSize, 'failed', msg);
      return this.buildResult(opportunity, false, [], 0, msg);
    }
  }

  /**
   * Calculate Kelly position size.
   * Formula: f* = (bp - q) / b, then apply fraction for safety.
   * ALWAYS use fractional Kelly — never full Kelly.
   *
   * @param edge  - Expected edge as fraction (e.g. 0.03)
   * @param confidence - Model confidence 0–1
   * @param bankroll   - Available capital in USD
   */
  calculateKellySize(edge: number, confidence: number, bankroll: number): number {
    // Adjust edge by confidence to be conservative
    const adjustedEdge = edge * confidence;
    // Binary payout: win b=1 (doubles stake), lose q=1-p
    const p = 0.5 + adjustedEdge; // implied win probability
    const q = 1 - p;
    const b = 1; // 1:1 payout on binary
    const fullKelly = (b * p - q) / b;
    const fractionalKelly = Math.max(0, fullKelly) * this.config.kellyFraction;
    const raw = bankroll * fractionalKelly;
    return Math.min(raw, this.config.maxPositionSize);
  }

  /**
   * Check whether current drawdown is within allowed limit.
   * Returns false (halt) when losses exceed maxDrawdownPct of maxPositionSize.
   */
  checkDrawdownLimit(currentPnL: number): boolean {
    if (currentPnL >= 0) return true;
    const drawdownFraction = Math.abs(currentPnL) / this.config.maxPositionSize;
    return drawdownFraction < this.config.maxDrawdownPct;
  }

  /** Read-only access to execution log for audit/reporting */
  getExecutionLog(): ReadonlyArray<ExecutionLogEntry> {
    return this.executionLog;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private simulateExecution(opp: BinaryArbitrageOpportunity, positionSize: number): ExecutionResult {
    const simulatedLegs: ExecutedLeg[] = opp.legs.map((leg) => ({
      exchange: leg.exchange,
      symbol: leg.symbol,
      side: leg.side,
      executedPrice: leg.price,
      executedAmount: positionSize / opp.legs.length,
      fee: leg.fee * (positionSize / opp.legs.length),
    }));

    const profit = opp.mispricing * positionSize;
    return this.buildResult(opp, true, simulatedLegs, profit);
  }

  private async placeOrders(opp: BinaryArbitrageOpportunity, positionSize: number): Promise<ExecutedLeg[]> {
    // Real order placement would call Polymarket CLOB API here
    // Stub: returns simulated legs — replace with actual REST calls
    return opp.legs.map((leg) => ({
      exchange: leg.exchange,
      symbol: leg.symbol,
      side: leg.side,
      executedPrice: leg.price,
      executedAmount: positionSize / opp.legs.length,
      fee: leg.fee * (positionSize / opp.legs.length),
      txHash: `0x${Math.random().toString(16).slice(2)}`,
    }));
  }

  private calculateProfit(legs: ExecutedLeg[], _opp: BinaryArbitrageOpportunity): number {
    const totalSpent = legs.reduce((s, l) => s + l.executedPrice * l.executedAmount + l.fee, 0);
    const settlement = legs.reduce((s, l) => s + l.executedAmount, 0); // each share pays $1
    return settlement - totalSpent;
  }

  private buildResult(
    opp: BinaryArbitrageOpportunity,
    success: boolean,
    legs: ExecutedLeg[],
    profit: number,
    error?: string
  ): ExecutionResult {
    const totalFees = legs.reduce((s, l) => s + l.fee, 0);
    const stake = legs.reduce((s, l) => s + l.executedAmount, 0) || 1;
    return {
      opportunityId: opp.id,
      success,
      executedLegs: legs,
      actualProfit: profit,
      actualProfitPct: (profit / stake) * 100,
      totalFees,
      error,
      executedAt: Date.now(),
    };
  }

  private log(
    opportunityId: string,
    positionSize: number,
    result: ExecutionLogEntry['result'],
    reason?: string
  ): void {
    this.executionLog.push({ opportunityId, timestamp: Date.now(), positionSize, dryRun: this.config.dryRun, result, reason });
  }
}
