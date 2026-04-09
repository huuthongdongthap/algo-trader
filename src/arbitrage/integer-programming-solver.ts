/**
 * Integer Programming Solver — Core ILP Formulation
 *
 * Wraps javascript-lp-solver (JSON model format) to solve multi-market
 * arbitrage allocation. Maximizes expected profit subject to budget
 * and per-market exposure constraints.
 *
 * Model structure:
 *   - Objective: maximize Σ edge_i * size_{i,side}
 *   - Variables: size_{marketId}_YES, size_{marketId}_NO (continuous, ≥ 0)
 *   - Constraints: budget (Σ sizes ≤ budget), per-market-max (each market ≤ 20% budget)
 */

import solver from 'javascript-lp-solver';
import type { Model } from 'javascript-lp-solver';
import { logger } from '../utils/logger';
import type { ILPResult, ILPSolverConfig, MarketOpportunity } from '../types/ilp-types';
import { buildConstraints, filterEligibleMarkets } from './ilp-constraint-builder';

// ── Variable key helpers ──────────────────────────────────────────────────

const yesKey = (marketId: string) => `${marketId}_YES`;
const noKey = (marketId: string) => `${marketId}_NO`;

// ── Model builder ─────────────────────────────────────────────────────────

/**
 * Construct the LP model JSON for javascript-lp-solver from eligible markets.
 * Each market contributes two variables (YES and NO position sizes).
 */
function buildModel(markets: MarketOpportunity[], config: ILPSolverConfig): Model {
  const constraints = buildConstraints(markets, config);
  const variables: Model['variables'] = {};

  for (const market of markets) {
    // Net edge after Polymarket fee
    const netEdge = market.expectedEdge - config.feeRate;
    // Cap position size at available liquidity and per-market budget
    const sizeCapUsdc = Math.min(
      market.liquidity,
      config.budgetUsdc * config.maxMarketExposureFraction
    );

    if (sizeCapUsdc <= 0 || netEdge <= 0) continue;

    // YES variable: contributes to budget and per-market constraint
    variables[yesKey(market.marketId)] = {
      profit: netEdge,
      budget: 1,
      [`market_${market.marketId}_max`]: 1,
    };

    // NO variable: same structure (YES and NO are independent positions)
    variables[noKey(market.marketId)] = {
      profit: netEdge,
      budget: 1,
      [`market_${market.marketId}_max`]: 1,
    };
  }

  return {
    optimize: 'profit',
    opType: 'max',
    constraints,
    variables,
    timeout: config.timeoutMs,
  };
}

// ── Result parser ─────────────────────────────────────────────────────────

/** Parse solver output into structured ILPResult */
function parseResult(
  solverOutput: Record<string, number | boolean | undefined>,
  markets: MarketOpportunity[],
  config: ILPSolverConfig,
  startMs: number
): ILPResult {
  const feasible = Boolean(solverOutput.feasible);
  const positions: ILPResult['positions'] = [];
  let totalCost = 0;
  let totalExpectedProfit = 0;

  if (feasible) {
    const netEdgeMap = new Map(
      markets.map(m => [m.marketId, m.expectedEdge - config.feeRate])
    );

    for (const market of markets) {
      const netEdge = netEdgeMap.get(market.marketId) ?? 0;

      const yesSize = Number(solverOutput[yesKey(market.marketId)] ?? 0);
      if (yesSize > 0.001) {
        const profit = yesSize * netEdge;
        positions.push({ marketId: market.marketId, side: 'YES', size: yesSize, expectedProfit: profit });
        totalCost += yesSize;
        totalExpectedProfit += profit;
      }

      const noSize = Number(solverOutput[noKey(market.marketId)] ?? 0);
      if (noSize > 0.001) {
        const profit = noSize * netEdge;
        positions.push({ marketId: market.marketId, side: 'NO', size: noSize, expectedProfit: profit });
        totalCost += noSize;
        totalExpectedProfit += profit;
      }
    }
  }

  return {
    positions,
    totalExpectedProfit,
    totalCost,
    feasible,
    solveTimeMs: Date.now() - startMs,
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Solve the multi-market arbitrage ILP.
 *
 * Returns an ILPResult with optimal position allocations.
 * Returns feasible=false if no profitable allocation exists within constraints.
 */
export function solveILP(
  markets: MarketOpportunity[],
  config: ILPSolverConfig
): ILPResult {
  const startMs = Date.now();

  const eligible = filterEligibleMarkets(markets, config);

  if (eligible.length === 0) {
    logger.info('[ILPSolver] No eligible markets — all below min edge threshold');
    return { positions: [], totalExpectedProfit: 0, totalCost: 0, feasible: false, solveTimeMs: 0 };
  }

  logger.debug('[ILPSolver] Solving ILP', { markets: eligible.length, budget: config.budgetUsdc });

  try {
    const model = buildModel(eligible, config);
    const rawResult = solver.Solve(model) as Record<string, number | boolean | undefined>;

    const result = parseResult(rawResult, eligible, config, startMs);

    logger.info('[ILPSolver] Solve complete', {
      feasible: result.feasible,
      positions: result.positions.length,
      profit: result.totalExpectedProfit.toFixed(4),
      cost: result.totalCost.toFixed(2),
      solveTimeMs: result.solveTimeMs,
    });

    return result;
  } catch (err) {
    logger.error('[ILPSolver] Solver error', { error: err instanceof Error ? err.message : String(err) });
    return { positions: [], totalExpectedProfit: 0, totalCost: 0, feasible: false, solveTimeMs: Date.now() - startMs };
  }
}
