/**
 * Delta Calculator for Binary Prediction Markets
 * Computes portfolio delta sensitivity across correlated Polymarket positions.
 *
 * Formula: position_delta = size * (currentPrice - 0.5) / 0.5
 * Rationale: at price 0.5 (max uncertainty), delta is 0. Price moves away
 * from 0.5 increase directional exposure proportionally.
 *
 * Used by: delta-neutral-volatility-arbitrage, rebalance-engine
 */

import {
  HedgePosition,
  PortfolioDeltaResult,
  PositionDelta,
} from '../../types/delta-neutral-types';

/**
 * Compute delta for a single binary market position.
 * YES positions have positive delta when price > 0.5.
 * NO positions have inverted delta (NO at price p = YES at price 1-p).
 */
export function computePositionDelta(position: HedgePosition): PositionDelta {
  const effectivePrice =
    position.side === 'NO' ? 1 - position.currentPrice : position.currentPrice;

  // Delta = size * normalized deviation from neutral (0.5)
  const delta = position.size * ((effectivePrice - 0.5) / 0.5);

  return {
    marketId: position.marketId,
    side: position.side,
    delta,
  };
}

/**
 * Compute aggregate portfolio delta from all positions.
 * Net delta = sum of individual position deltas.
 * A perfectly hedged portfolio has netDelta = 0.
 */
export function computePortfolioDelta(
  positions: HedgePosition[],
  deltaThreshold: number
): PortfolioDeltaResult {
  const positionDeltas = positions.map(computePositionDelta);
  const netDelta = positionDeltas.reduce((sum, pd) => sum + pd.delta, 0);

  return {
    netDelta,
    positionDeltas,
    isNeutral: Math.abs(netDelta) <= deltaThreshold,
  };
}

/**
 * Estimate how much size to trade to bring netDelta back to zero.
 * Returns the approximate USDC size needed at the given market price.
 *
 * @param currentDelta - Current portfolio delta to neutralize
 * @param marketPrice - Current price of the market being used for hedge
 * @param maxSize - Maximum allowed trade size in USDC
 */
export function estimateHedgeSize(
  currentDelta: number,
  marketPrice: number,
  maxSize: number
): number {
  if (Math.abs(marketPrice - 0.5) < 1e-6) {
    // Price is exactly at 0.5 — cannot neutralize with this market
    return 0;
  }

  // Invert the delta formula: size = delta / ((price - 0.5) / 0.5)
  const rawSize = Math.abs(currentDelta) / (Math.abs(marketPrice - 0.5) / 0.5);
  return Math.min(rawSize, maxSize);
}

/**
 * Compute unrealized PnL for a position.
 * PnL = size * (currentPrice - entryPrice) for YES,
 *       size * (entryPrice - currentPrice) for NO.
 */
export function computePositionPnl(position: HedgePosition): number {
  if (position.side === 'YES') {
    return position.size * (position.currentPrice - position.entryPrice);
  }
  // NO position profits when price falls
  return position.size * (position.entryPrice - position.currentPrice);
}

/**
 * Compute total unrealized PnL across all positions.
 */
export function computePortfolioPnl(positions: HedgePosition[]): number {
  return positions.reduce((sum, p) => sum + computePositionPnl(p), 0);
}
