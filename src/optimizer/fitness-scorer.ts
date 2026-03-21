// Fitness scoring for backtest results used in strategy optimization
// Combines Sharpe ratio, win rate, drawdown, and total return into a 0-100 score

import type { BacktestReport } from '../backtest/report-generator.js';

/** Weights controlling how each metric influences the fitness score */
export interface FitnessWeights {
  /** Weight for annualized Sharpe ratio contribution (higher = better) */
  sharpeWeight: number;
  /** Weight for win rate contribution (0-1 scale) */
  winRateWeight: number;
  /** Penalty multiplier for max drawdown (higher = harsher drawdown penalty) */
  drawdownPenalty: number;
  /** Weight for total return contribution */
  returnWeight: number;
}

/** Balanced default weights: Sharpe-focused with moderate drawdown penalty */
export const DEFAULT_WEIGHTS: FitnessWeights = {
  sharpeWeight: 0.35,
  winRateWeight: 0.20,
  drawdownPenalty: 0.25,
  returnWeight: 0.20,
};

/**
 * Clamp a value to [0, 1] range.
 */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * Normalize Sharpe ratio to [0, 1].
 * Sharpe of 3+ is considered excellent (maps to 1.0).
 * Negative Sharpe maps to 0.
 */
function normalizeSharpe(sharpe: number): number {
  if (!isFinite(sharpe) || sharpe < 0) return 0;
  return clamp01(sharpe / 3);
}

/**
 * Normalize total return to [0, 1].
 * 100%+ return maps to 1.0; negative returns map to 0.
 */
function normalizeReturn(totalReturn: number): number {
  if (!isFinite(totalReturn) || totalReturn < 0) return 0;
  return clamp01(totalReturn / 1.0); // 100% return = full score
}

/**
 * Calculate a single fitness score (0-100) from a BacktestReport.
 * Higher score = better strategy performance.
 *
 * Formula:
 *   score = 100 * (
 *     sharpeWeight * normSharpe
 *     + winRateWeight * winRate
 *     + returnWeight * normReturn
 *     - drawdownPenalty * maxDrawdown
 *   )
 *
 * Result is clamped to [0, 100].
 */
export function calculateFitness(
  report: BacktestReport,
  weights: FitnessWeights = DEFAULT_WEIGHTS,
): number {
  // Skip degenerate runs with no trades
  if (report.tradeCount === 0) return 0;

  const sharpeComponent = weights.sharpeWeight * normalizeSharpe(report.sharpeRatio);
  const winRateComponent = weights.winRateWeight * clamp01(report.winRate);
  const returnComponent = weights.returnWeight * normalizeReturn(report.totalReturn);
  const drawdownComponent = weights.drawdownPenalty * clamp01(report.maxDrawdown);

  const raw = sharpeComponent + winRateComponent + returnComponent - drawdownComponent;
  return Math.max(0, Math.min(100, raw * 100));
}
