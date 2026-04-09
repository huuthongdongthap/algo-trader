/**
 * Execution Path Planner — Optimal Order Sequencing for Multi-Leg Baskets
 * Orders legs for execution to minimize market impact and partial-fill risk.
 *
 * Ordering criteria (priority):
 * 1. Liquidity: most liquid legs first (largest liquidity pool → least slippage)
 * 2. Market Impact: smallest size-to-liquidity ratio first (lowest impact)
 * 3. Urgency: legs with higher expected profit executed earlier
 *
 * Used by: strategy-engine, trade-executor
 */

import logger from '../utils/logger';
import { ILPPosition, MultiLegBasket } from '../types/ilp-types';
import {
  FrankWolfeResult,
  LegAllocation,
  optimizeBasketExecution,
} from './multi-leg-frank-wolfe-optimizer';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Metadata about a leg used for ordering decisions */
export interface LegMetadata {
  marketId: string;
  side: 'YES' | 'NO';
  /** Available liquidity in USDC */
  liquidity: number;
  /** Urgency score 0–1 (higher = execute sooner) */
  urgency: number;
}

/** A single step in the execution plan */
export interface ExecutionStep {
  /** Sequential step number (1-indexed) */
  step: number;
  marketId: string;
  side: 'YES' | 'NO';
  /** Actual USDC size to execute at this step */
  sizeUsdc: number;
  /** Estimated slippage cost */
  estimatedSlippage: number;
  /** Reason for this position in the sequence */
  reason: string;
}

/** Full ordered execution plan for a basket */
export interface ExecutionPlan {
  basketId: string;
  steps: ExecutionStep[];
  totalEstimatedCost: number;
  /** Optimizer result if FW optimization was applied */
  optimization?: FrankWolfeResult;
  createdAt: number;
}

// ── Scoring ───────────────────────────────────────────────────────────────────

/**
 * Composite priority score — lower = execute earlier.
 * Penalizes high market impact, rewards high liquidity/urgency/profit.
 */
function computeLegScore(position: ILPPosition, meta: LegMetadata): number {
  const liq = Math.max(meta.liquidity, 1);
  return position.size / liq - Math.log(liq + 1) * 0.01 - meta.urgency * 0.5 - position.expectedProfit * 0.1;
}

/** Quadratic slippage: size^2 / liquidity * rate */
function estimateSlippage(size: number, liquidity: number, slippageRate = 0.001): number {
  return (size ** 2) / Math.max(liquidity, 1) * slippageRate;
}

// ── Planner ───────────────────────────────────────────────────────────────────

/**
 * Plan the optimal execution sequence for a multi-leg basket.
 * Optionally runs Frank-Wolfe optimization to reallocate sizes.
 *
 * @param basket - Validated multi-leg basket from Phase 03
 * @param metadataMap - Per-market metadata (liquidity, urgency)
 * @param useOptimizer - Whether to apply FW optimization (default true)
 */
export function planExecutionPath(
  basket: MultiLegBasket,
  metadataMap: Map<string, LegMetadata>,
  useOptimizer = true
): ExecutionPlan {
  const positions = basket.positions;

  if (positions.length === 0) {
    return {
      basketId: basket.id,
      steps: [],
      totalEstimatedCost: 0,
      createdAt: Date.now(),
    };
  }

  // Build liquidity array for optimizer (same order as positions)
  const liquidities = positions.map((p) => {
    const meta = metadataMap.get(p.marketId);
    return meta?.liquidity ?? 1000;
  });

  // Run Frank-Wolfe optimizer to get optimal size allocations
  let optimizerResult: FrankWolfeResult | undefined;
  let sizeMap: Map<string, number> = new Map();

  if (useOptimizer) {
    optimizerResult = optimizeBasketExecution(basket, liquidities);

    // Map optimized fractions back to USDC sizes
    for (const alloc of optimizerResult.allocations) {
      const key = `${alloc.marketId}:${alloc.side}`;
      sizeMap.set(key, alloc.fraction * basket.totalCost);
    }
  } else {
    // Use natural sizes from ILP
    for (const pos of positions) {
      sizeMap.set(`${pos.marketId}:${pos.side}`, pos.size);
    }
  }

  // Score and sort legs
  const scored = positions.map((pos) => {
    const meta = metadataMap.get(pos.marketId) ?? {
      marketId: pos.marketId,
      side: pos.side,
      liquidity: 1000,
      urgency: 0.5,
    };
    return { pos, meta, score: computeLegScore(pos, meta) };
  });

  scored.sort((a, b) => a.score - b.score);

  // Build execution steps
  let totalCost = 0;
  const steps: ExecutionStep[] = scored.map(({ pos, meta }, idx) => {
    const key = `${pos.marketId}:${pos.side}`;
    const size = sizeMap.get(key) ?? pos.size;
    const slippage = estimateSlippage(size, meta.liquidity);
    totalCost += slippage;

    const reason = buildReason(pos, meta, idx, scored.length);

    return {
      step: idx + 1,
      marketId: pos.marketId,
      side: pos.side,
      sizeUsdc: Math.round(size * 100) / 100,
      estimatedSlippage: Math.round(slippage * 10000) / 10000,
      reason,
    };
  });

  logger.info(
    `[PathPlanner] Basket ${basket.id} | ${steps.length} steps | ` +
    `totalCost=${totalCost.toFixed(4)} USDC | optimizer=${useOptimizer}`
  );

  return {
    basketId: basket.id,
    steps,
    totalEstimatedCost: Math.round(totalCost * 10000) / 10000,
    optimization: optimizerResult,
    createdAt: Date.now(),
  };
}

/**
 * Build a human-readable reason explaining why a leg is at this position.
 */
function buildReason(
  pos: ILPPosition,
  meta: LegMetadata,
  idx: number,
  total: number
): string {
  const parts: string[] = [];
  if (idx < total * 0.33) parts.push('high liquidity');
  if (meta.urgency > 0.7) parts.push('urgent');
  if (pos.expectedProfit > 0) parts.push(`edge=${pos.expectedProfit.toFixed(4)}`);
  return parts.length > 0 ? parts.join(', ') : 'standard priority';
}

/** Format execution plan as human-readable summary string. */
export function summarizeExecutionPlan(plan: ExecutionPlan): string {
  const opt = plan.optimization;
  const header = [
    `Basket: ${plan.basketId} | Steps: ${plan.steps.length} | Cost: ${plan.totalEstimatedCost} USDC`,
    ...(opt ? [`FW: ${(opt.costReductionFraction * 100).toFixed(2)}% reduction, ${opt.iterationsUsed} iters`] : []),
  ];
  const steps = plan.steps.map(
    (s) => `  [${s.step}] ${s.marketId} ${s.side} $${s.sizeUsdc} slip=${s.estimatedSlippage} — ${s.reason}`
  );
  return [...header, ...steps].join('\n');
}
