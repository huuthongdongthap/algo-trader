/**
 * Frank-Wolfe Multi-Leg Execution Optimizer
 * Iterative gradient-based optimizer for minimizing total execution cost
 * across a multi-leg arbitrage basket (slippage + fees + timing risk).
 *
 * Frank-Wolfe Algorithm (Conditional Gradient):
 * 1. Compute gradient of cost function at current allocation x
 * 2. Solve linear minimization: s = argmin <∇f(x), s> over feasible set S
 * 3. Step: x_{t+1} = x_t + γ_t * (s_t - x_t)
 * 4. Repeat until convergence or maxIterations
 *
 * Advantages over projected gradient: no projection step needed,
 * naturally handles simplex/budget constraints.
 *
 * Used by: execution-path-planner, strategy-engine
 */

import logger from '../utils/logger';
import { ILPPosition, MultiLegBasket } from '../types/ilp-types';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Per-leg execution allocation (fraction of total budget) */
export interface LegAllocation {
  marketId: string;
  side: 'YES' | 'NO';
  /** Fraction of total budget allocated to this leg (0–1) */
  fraction: number;
  /** Estimated execution cost for this leg in USDC */
  estimatedCost: number;
}

/** Optimizer configuration */
export interface FrankWolfeConfig {
  maxIterations: number;  // default 50
  epsilon: number;        // convergence threshold
  stepSizeBase: number;   // γ_t = base / (t + denom)
  stepSizeDenom: number;
  slippageRate: number;   // cost = rate * size^2 / liquidity
  gasPerLeg: number;      // fixed gas cost per leg in USDC
  timingRiskWeight: number;
}

const DEFAULT_FW_CONFIG: FrankWolfeConfig = {
  maxIterations: 50, epsilon: 1e-6, stepSizeBase: 2,
  stepSizeDenom: 2, slippageRate: 0.001, gasPerLeg: 0.05, timingRiskWeight: 0.1,
};

/** Result from the optimizer */
export interface FrankWolfeResult {
  allocations: LegAllocation[];
  totalCost: number;
  /** Naive sequential cost (for comparison) */
  naiveCost: number;
  /** Cost reduction vs naive: (naive - optimized) / naive */
  costReductionFraction: number;
  iterationsUsed: number;
  converged: boolean;
  optimizationTimeMs: number;
}

// ── Cost Model & FW Primitives ────────────────────────────────────────────────

/** cost = slippage + gas + timing. Formula: rate*size^2/liq + gas + weight*size */
function legCost(pos: ILPPosition, size: number, liq: number, cfg: FrankWolfeConfig): number {
  if (size <= 0) return 0;
  return cfg.slippageRate * (size ** 2) / Math.max(liq, 1) + cfg.gasPerLeg + cfg.timingRiskWeight * size;
}

/**
 * Gradient of total cost w.r.t. each fraction.
 * d(cost_i)/df_i = 2*rate*f*budget^2/liq + timing*budget
 */
function computeGradient(
  fractions: number[], _positions: ILPPosition[],
  liquidities: number[], totalBudget: number, cfg: FrankWolfeConfig
): number[] {
  return fractions.map((f, i) => {
    const liq = Math.max(liquidities[i], 1);
    return 2 * cfg.slippageRate * f * totalBudget * totalBudget / liq + cfg.timingRiskWeight * totalBudget;
  });
}

/**
 * Linear minimization oracle over probability simplex.
 * argmin <∇f, s> s.t. sum(s)=1, s>=0 → put all weight on min-gradient index.
 */
function linearMinimizationOracle(gradient: number[]): number[] {
  const result = new Array(gradient.length).fill(0);
  const minIdx = gradient.indexOf(Math.min(...gradient));
  result[minIdx] = 1;
  return result;
}

// ── Optimizer ─────────────────────────────────────────────────────────────────

/**
 * Run Frank-Wolfe optimization over a multi-leg basket.
 * Returns optimal allocation that minimizes total execution cost.
 *
 * @param basket - Multi-leg basket from ILP solver (Phase 03)
 * @param liquidities - Per-position liquidity in USDC (same order as basket.positions)
 * @param config - Optimizer configuration
 */
export function optimizeBasketExecution(
  basket: MultiLegBasket,
  liquidities: number[],
  config: Partial<FrankWolfeConfig> = {}
): FrankWolfeResult {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_FW_CONFIG, ...config };
  const positions = basket.positions;
  const n = positions.length;

  if (n === 0) {
    return {
      allocations: [],
      totalCost: 0,
      naiveCost: 0,
      costReductionFraction: 0,
      iterationsUsed: 0,
      converged: true,
      optimizationTimeMs: 0,
    };
  }

  const totalBudget = basket.totalCost;
  const liq = liquidities.length === n ? liquidities : new Array(n).fill(1000);

  // Initial feasible point: uniform allocation over simplex
  let fractions = new Array(n).fill(1 / n);
  let prevCost = Infinity;
  let iter = 0;
  let converged = false;

  for (iter = 0; iter < cfg.maxIterations; iter++) {
    const gradient = computeGradient(fractions, positions, liq, totalBudget, cfg);
    const s = linearMinimizationOracle(gradient);

    // Step size: diminishing schedule γ_t = base / (t + denom)
    const gamma = cfg.stepSizeBase / (iter + cfg.stepSizeDenom);

    // FW update: x_{t+1} = x_t + γ * (s - x_t)
    const newFractions = fractions.map((f, i) => f + gamma * (s[i] - f));

    // Compute total cost at new point
    const totalCost = newFractions.reduce((sum, f, i) => {
      return sum + legCost(positions[i], f * totalBudget, liq[i], cfg);
    }, 0);

    fractions = newFractions;

    const improvement = Math.abs(prevCost - totalCost);
    if (improvement < cfg.epsilon && iter > 0) {
      converged = true;
      break;
    }
    prevCost = totalCost;
  }

  // Compute final costs
  const optimizedCost = fractions.reduce((sum, f, i) => {
    return sum + legCost(positions[i], f * totalBudget, liq[i], cfg);
  }, 0);

  // Naive sequential cost: each leg gets its natural fraction (size/totalBudget)
  const naiveFractions = positions.map((p) => p.size / totalBudget);
  const naiveCost = naiveFractions.reduce((sum, f, i) => {
    return sum + legCost(positions[i], f * totalBudget, liq[i], cfg);
  }, 0);

  const allocations: LegAllocation[] = positions.map((pos, i) => ({
    marketId: pos.marketId,
    side: pos.side,
    fraction: fractions[i],
    estimatedCost: legCost(pos, fractions[i] * totalBudget, liq[i], cfg),
  }));

  const costReductionFraction =
    naiveCost > 0 ? (naiveCost - optimizedCost) / naiveCost : 0;

  const result: FrankWolfeResult = {
    allocations,
    totalCost: optimizedCost,
    naiveCost,
    costReductionFraction,
    iterationsUsed: iter,
    converged,
    optimizationTimeMs: Date.now() - startTime,
  };

  logger.info(
    `[FrankWolfe] Basket ${basket.id} | iter=${iter} | converged=${converged} | ` +
    `cost=${optimizedCost.toFixed(4)} | reduction=${(costReductionFraction * 100).toFixed(2)}% | ` +
    `time=${result.optimizationTimeMs}ms`
  );

  return result;
}
