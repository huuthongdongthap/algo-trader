/**
 * ILP Constraint Builder
 * Constructs budget, risk, and per-market constraints for the LP solver JSON model.
 * Reads defaults from environment variables; accepts overrides via config object.
 */

import { logger } from '../utils/logger';
import type { ILPSolverConfig } from '../types/ilp-types';
import type { MarketOpportunity } from '../types/ilp-types';
import type { ConstraintBound } from 'javascript-lp-solver';

// ── Defaults from environment ─────────────────────────────────────────────

const DEFAULT_BUDGET_USDC = Number(process.env.CAPITAL_USDC ?? 1000);
const DEFAULT_MAX_MARKET_FRACTION = 0.20;
const DEFAULT_MIN_EDGE = 0.025;
const DEFAULT_FEE_RATE = 0.02;
const DEFAULT_TIMEOUT_MS = 500;

/** Build a fully-populated solver config, merging env + overrides */
export function buildSolverConfig(overrides: Partial<ILPSolverConfig> = {}): ILPSolverConfig {
  return {
    budgetUsdc: overrides.budgetUsdc ?? DEFAULT_BUDGET_USDC,
    maxMarketExposureFraction: overrides.maxMarketExposureFraction ?? DEFAULT_MAX_MARKET_FRACTION,
    minEdgeThreshold: overrides.minEdgeThreshold ?? DEFAULT_MIN_EDGE,
    feeRate: overrides.feeRate ?? DEFAULT_FEE_RATE,
    timeoutMs: overrides.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  };
}

// ── Constraint types ──────────────────────────────────────────────────────

/** LP solver constraint bounds record */
export type ConstraintsRecord = Record<string, ConstraintBound>;

/**
 * Build all LP constraints for the given markets and config.
 *
 * Constraints produced:
 *  - `budget`: total capital ≤ budgetUsdc
 *  - `market_{id}_max`: per-market exposure ≤ maxMarketExposureFraction * budget
 */
export function buildConstraints(
  markets: MarketOpportunity[],
  config: ILPSolverConfig
): ConstraintsRecord {
  const maxPerMarket = config.budgetUsdc * config.maxMarketExposureFraction;
  const constraints: ConstraintsRecord = {};

  // Total budget constraint — sum of all position sizes ≤ budget
  constraints['budget'] = { max: config.budgetUsdc };

  // Per-market exposure constraints
  for (const market of markets) {
    const constraintKey = `market_${market.marketId}_max`;
    constraints[constraintKey] = { max: maxPerMarket };
  }

  logger.debug('[ILPConstraintBuilder] Built constraints', {
    marketCount: markets.length,
    budget: config.budgetUsdc,
    maxPerMarket,
  });

  return constraints;
}

/**
 * Filter markets that do not meet the minimum edge threshold.
 * Markets below minEdgeThreshold are excluded from the model entirely
 * to keep the solver problem space small and avoid negative-profit positions.
 */
export function filterEligibleMarkets(
  markets: MarketOpportunity[],
  config: ILPSolverConfig
): MarketOpportunity[] {
  const eligible = markets.filter(m => m.expectedEdge >= config.minEdgeThreshold);

  logger.debug('[ILPConstraintBuilder] Filtered eligible markets', {
    total: markets.length,
    eligible: eligible.length,
    minEdge: config.minEdgeThreshold,
  });

  return eligible;
}
