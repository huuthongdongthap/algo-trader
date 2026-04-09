/**
 * Rebalance Engine — Threshold-Based Delta Rebalancing
 * Generates minimum set of RebalanceSignals to bring portfolio delta within bounds.
 *
 * Strategy: find the position with the largest deviation and hedge it first,
 * repeating until |netDelta| <= threshold or budget is exhausted.
 *
 * Used by: delta-neutral-volatility-arbitrage
 */

import {
  DeltaNeutralPortfolio,
  HedgePosition,
  RebalanceResult,
  RebalanceSignal,
} from '../../types/delta-neutral-types';
import {
  computePortfolioDelta,
  estimateHedgeSize,
} from './delta-calculator';

/** Maximum number of rebalance iterations to avoid infinite loops */
const MAX_REBALANCE_ITERATIONS = 10;

/**
 * Determine if portfolio requires rebalancing.
 */
export function requiresRebalance(
  portfolio: DeltaNeutralPortfolio,
  threshold: number
): boolean {
  return Math.abs(portfolio.netDelta) > threshold;
}

/**
 * Generate minimum rebalance signals to bring |netDelta| below threshold.
 * Picks the position that most efficiently reduces delta at each step.
 *
 * @param portfolio - Current portfolio state
 * @param threshold - Delta threshold (e.g. 0.1)
 * @param maxLegSize - Max USDC size per individual rebalance trade
 */
export function computeRebalanceSignals(
  portfolio: DeltaNeutralPortfolio,
  threshold: number,
  maxLegSize: number
): RebalanceResult {
  const signals: RebalanceSignal[] = [];
  const deltaBefore = portfolio.netDelta;
  let remainingDelta = deltaBefore;

  // Work on a mutable copy of positions for simulation
  const positions: HedgePosition[] = portfolio.positions.map((p) => ({ ...p }));

  for (let iter = 0; iter < MAX_REBALANCE_ITERATIONS; iter++) {
    if (Math.abs(remainingDelta) <= threshold) break;

    // Find the best position to rebalance: prefer positions where
    // a trade direction counters the remaining delta
    const signal = findBestRebalanceTrade(
      positions,
      remainingDelta,
      maxLegSize
    );

    if (!signal) break;

    signals.push(signal);

    // Simulate the delta impact of this trade
    const priceFactor =
      signal.side === 'NO'
        ? 1 - (getPositionPrice(positions, signal.marketId, signal.side) ?? 0.5)
        : (getPositionPrice(positions, signal.marketId, signal.side) ?? 0.5);

    const deltaImpact = signal.size * ((priceFactor - 0.5) / 0.5);
    remainingDelta =
      signal.action === 'BUY'
        ? remainingDelta - deltaImpact
        : remainingDelta + deltaImpact;
  }

  const estimatedCost = signals.reduce((sum, s) => sum + s.size, 0);

  return {
    signals,
    deltaBefore,
    deltaAfter: remainingDelta,
    estimatedCost,
  };
}

/**
 * Find the single best trade to reduce |remainingDelta|.
 * Returns null if no suitable position found.
 */
function findBestRebalanceTrade(
  positions: HedgePosition[],
  remainingDelta: number,
  maxLegSize: number
): RebalanceSignal | null {
  let best: RebalanceSignal | null = null;
  let bestEfficiency = 0;

  for (const pos of positions) {
    const effectivePrice =
      pos.side === 'NO' ? 1 - pos.currentPrice : pos.currentPrice;
    const priceDev = (effectivePrice - 0.5) / 0.5;

    if (Math.abs(priceDev) < 1e-6) continue;

    const hedgeSize = estimateHedgeSize(
      remainingDelta,
      effectivePrice,
      Math.min(maxLegSize, pos.size)
    );

    if (hedgeSize < 1) continue; // Minimum $1 trade

    // Efficiency: delta reduced per dollar spent
    const efficiency = Math.abs(hedgeSize * priceDev) / hedgeSize;

    if (efficiency > bestEfficiency) {
      bestEfficiency = efficiency;
      // If delta is positive we need to SELL (reduce long exposure),
      // if negative we need to BUY (increase long exposure)
      const action: 'BUY' | 'SELL' = remainingDelta > 0 ? 'SELL' : 'BUY';

      best = {
        action,
        marketId: pos.marketId,
        side: pos.side,
        size: Math.round(hedgeSize * 100) / 100,
        reason: `Rebalance: delta=${remainingDelta.toFixed(4)}, efficiency=${efficiency.toFixed(4)}`,
      };
    }
  }

  return best;
}

/**
 * Get current price for a position by marketId+side.
 */
function getPositionPrice(
  positions: HedgePosition[],
  marketId: string,
  side: 'YES' | 'NO'
): number | undefined {
  return positions.find((p) => p.marketId === marketId && p.side === side)
    ?.currentPrice;
}

/**
 * Apply confirmed rebalance signals to update portfolio positions.
 * Adjusts sizes in-place based on BUY/SELL actions.
 *
 * @returns Updated positions after applying signals
 */
export function applyRebalanceSignals(
  positions: HedgePosition[],
  signals: RebalanceSignal[]
): HedgePosition[] {
  const updated = positions.map((p) => ({ ...p }));

  for (const signal of signals) {
    const pos = updated.find(
      (p) => p.marketId === signal.marketId && p.side === signal.side
    );

    if (!pos) continue;

    if (signal.action === 'BUY') {
      pos.size += signal.size;
    } else {
      pos.size = Math.max(0, pos.size - signal.size);
    }
  }

  return updated;
}
