/**
 * Multi-Leg Basket — Types and Validation
 *
 * Validates ILP results into execution-ready baskets.
 * Applies final sanity checks: min edge, non-zero size, budget cap.
 */

import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import type { ILPResult, MultiLegBasket, BasketValidationResult, ILPSolverConfig } from '../types/ilp-types';

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Validate an ILP result against config thresholds before basket creation.
 *
 * Checks:
 *  - Result must be feasible
 *  - At least one non-zero position
 *  - Total cost within budget
 *  - Each position has positive expected profit
 */
export function validateILPResult(
  result: ILPResult,
  config: ILPSolverConfig
): BasketValidationResult {
  const reasons: string[] = [];

  if (!result.feasible) {
    reasons.push('ILP solver returned infeasible');
  }

  if (result.positions.length === 0) {
    reasons.push('No positions in result');
  }

  if (result.totalCost > config.budgetUsdc + 0.01) {
    reasons.push(`Total cost ${result.totalCost.toFixed(2)} exceeds budget ${config.budgetUsdc}`);
  }

  if (result.totalExpectedProfit <= 0) {
    reasons.push('Total expected profit is non-positive');
  }

  const negativePositions = result.positions.filter(p => p.expectedProfit <= 0);
  if (negativePositions.length > 0) {
    reasons.push(`${negativePositions.length} position(s) have non-positive expected profit`);
  }

  const zeroSizePositions = result.positions.filter(p => p.size < 0.01);
  if (zeroSizePositions.length > 0) {
    reasons.push(`${zeroSizePositions.length} position(s) have near-zero size`);
  }

  return { valid: reasons.length === 0, reasons };
}

// ── Basket Factory ────────────────────────────────────────────────────────

/**
 * Convert a validated ILP result into a MultiLegBasket.
 * Filters out near-zero positions and assigns a unique ID.
 */
export function createBasket(result: ILPResult, validated: boolean): MultiLegBasket {
  // Filter positions with meaningful size
  const cleanPositions = result.positions.filter(p => p.size >= 0.01);

  const basket: MultiLegBasket = {
    id: randomUUID(),
    positions: cleanPositions,
    totalExpectedProfit: cleanPositions.reduce((sum, p) => sum + p.expectedProfit, 0),
    totalCost: cleanPositions.reduce((sum, p) => sum + p.size, 0),
    validated,
    createdAt: Date.now(),
  };

  logger.debug('[MultiLegBasket] Created basket', {
    id: basket.id,
    legs: basket.positions.length,
    totalProfit: basket.totalExpectedProfit.toFixed(4),
    totalCost: basket.totalCost.toFixed(2),
    validated,
  });

  return basket;
}

/**
 * Build and validate a basket from an ILP result.
 * Returns null if validation fails and basket should not be executed.
 */
export function buildValidatedBasket(
  result: ILPResult,
  config: ILPSolverConfig
): MultiLegBasket | null {
  const validation = validateILPResult(result, config);

  if (!validation.valid) {
    logger.warn('[MultiLegBasket] Validation failed — basket rejected', { reasons: validation.reasons });
    return null;
  }

  return createBasket(result, true);
}

/** Format basket summary for logging */
export function formatBasketSummary(basket: MultiLegBasket): string {
  const legs = basket.positions
    .map(p => `${p.marketId}:${p.side}@${p.size.toFixed(2)}USDC`)
    .join(', ');
  return `Basket[${basket.id.slice(0, 8)}] profit=${basket.totalExpectedProfit.toFixed(4)} cost=${basket.totalCost.toFixed(2)} legs=[${legs}]`;
}
