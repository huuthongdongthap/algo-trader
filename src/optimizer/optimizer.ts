// Strategy optimizer: orchestrates grid search + backtesting + fitness ranking
// Runs all param combinations, scores each run, returns ranked results

import type { HistoricalCandle } from '../backtest/data-loader.js';
import type { BacktestStrategy } from '../backtest/simulator.js';
import type { BacktestReport } from '../backtest/report-generator.js';
import type { StrategyName } from '../core/types.js';
import { runBacktest } from '../backtest/simulator.js';
import { generateReport } from '../backtest/report-generator.js';
import { generateGrid } from './grid-search.js';
import { calculateFitness, DEFAULT_WEIGHTS } from './fitness-scorer.js';
import type { ParamRange } from './grid-search.js';
import type { FitnessWeights } from './fitness-scorer.js';

/** Configuration for a full optimization run */
export interface OptimizerConfig {
  /** Factory function that creates a strategy instance for given params */
  strategy: (params: Record<string, number>) => BacktestStrategy;
  /** Strategy name used in backtest config (for trade labeling) */
  strategyName: StrategyName;
  /** Param ranges to explore via grid search */
  paramRanges: ParamRange[];
  /** Historical candles to backtest against */
  candles: HistoricalCandle[];
  /** Starting capital for each backtest run */
  initialCapital: number;
  /** Slippage decimal (default 0.001 = 0.1%) */
  slippage?: number;
  /** Fee rate decimal (default 0.001 = 0.1%) */
  feeRate?: number;
  /** Fitness scoring weights (defaults to DEFAULT_WEIGHTS) */
  fitnessWeights?: FitnessWeights;
  /** How many top results to include in output (default 10) */
  topN?: number;
  /** Optional progress callback: called after each run */
  onProgress?: (current: number, total: number, bestSoFar: OptimizationResult | null) => void;
}

/** Result for a single parameter set run */
export interface ParamResult {
  params: Record<string, number>;
  score: number;
  report: BacktestReport;
}

/** Full output of an optimization run */
export interface OptimizationResult {
  bestParams: Record<string, number>;
  bestScore: number;
  bestReport: BacktestReport;
  /** Top N results sorted descending by fitness score */
  allResults: ParamResult[];
  totalRuns: number;
}

/**
 * Run strategy optimization over the full parameter grid.
 *
 * Steps:
 * 1. Generate all param combinations via generateGrid()
 * 2. For each combination: instantiate strategy, run backtest, score result
 * 3. Sort by fitness score descending
 * 4. Return top N + overall best
 */
export async function optimize(config: OptimizerConfig): Promise<OptimizationResult> {
  const {
    strategy,
    strategyName,
    paramRanges,
    candles,
    initialCapital,
    slippage = 0.001,
    feeRate = 0.001,
    fitnessWeights = DEFAULT_WEIGHTS,
    topN = 10,
    onProgress,
  } = config;

  const paramGrid = generateGrid(paramRanges);
  const total = paramGrid.length;
  const results: ParamResult[] = [];
  let bestSoFar: OptimizationResult | null = null;

  for (let i = 0; i < total; i++) {
    const params = paramGrid[i];
    const strategyInstance = strategy(params);

    const { trades, equityCurve } = await runBacktest(
      strategyInstance,
      candles,
      { initialCapital, slippage, feeRate, strategy: strategyName },
    );

    const report = generateReport(trades, equityCurve, initialCapital);
    const score = calculateFitness(report, fitnessWeights);

    results.push({ params, score, report });

    // Update bestSoFar incrementally for progress callback
    if (onProgress) {
      const sorted = [...results].sort((a, b) => b.score - a.score);
      const best = sorted[0];
      bestSoFar = {
        bestParams: best.params,
        bestScore: best.score,
        bestReport: best.report,
        allResults: sorted.slice(0, topN),
        totalRuns: i + 1,
      };
      onProgress(i + 1, total, bestSoFar);
    }
  }

  // Final ranking
  results.sort((a, b) => b.score - a.score);
  const best = results[0] ?? { params: {}, score: 0, report: buildEmptyReport(initialCapital) };

  return {
    bestParams: best.params,
    bestScore: best.score,
    bestReport: best.report,
    allResults: results.slice(0, topN),
    totalRuns: total,
  };
}

/** Minimal empty report for edge case when no runs completed */
function buildEmptyReport(initialCapital: number): BacktestReport {
  return {
    totalReturn: 0,
    sharpeRatio: 0,
    maxDrawdown: 0,
    winRate: 0,
    tradeCount: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    initialCapital,
    finalEquity: initialCapital,
    totalFees: 0,
  };
}
