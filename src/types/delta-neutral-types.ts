/**
 * Delta-Neutral Volatility Arbitrage Types
 * Typed structures for hedged position management across correlated Polymarket markets.
 *
 * Used by: delta-neutral-volatility-arbitrage, delta-calculator, rebalance-engine
 */

// ── Position Structures ───────────────────────────────────────────────────────

/** A single hedged position in one market */
export interface HedgePosition {
  marketId: string;
  side: 'YES' | 'NO';
  /** Position size in USDC */
  size: number;
  /** Price at entry (0–1 probability) */
  entryPrice: number;
  /** Current market price (0–1 probability) */
  currentPrice: number;
}

/** Full delta-neutral portfolio across correlated market pairs */
export interface DeltaNeutralPortfolio {
  /** Unique portfolio identifier */
  id: string;
  positions: HedgePosition[];
  /** Net portfolio delta — target is 0 */
  netDelta: number;
  /** Total USDC exposure across all positions */
  totalExposure: number;
  /** Unrealized PnL in USDC */
  unrealizedPnl: number;
  /** Unix timestamp (ms) of last update */
  updatedAt: number;
}

// ── Delta Computation ─────────────────────────────────────────────────────────

/** Delta contribution from a single position */
export interface PositionDelta {
  marketId: string;
  side: 'YES' | 'NO';
  /** Individual delta value for this position */
  delta: number;
}

/** Aggregated delta analysis for entire portfolio */
export interface PortfolioDeltaResult {
  netDelta: number;
  positionDeltas: PositionDelta[];
  /** True if |netDelta| is within acceptable threshold */
  isNeutral: boolean;
}

// ── Rebalancing ───────────────────────────────────────────────────────────────

/** Signal to rebalance a specific position */
export interface RebalanceSignal {
  action: 'BUY' | 'SELL';
  marketId: string;
  side: 'YES' | 'NO';
  /** Size in USDC to trade */
  size: number;
  /** Human-readable reason for this rebalance action */
  reason: string;
}

/** Result of a rebalance computation */
export interface RebalanceResult {
  signals: RebalanceSignal[];
  /** Delta before rebalance */
  deltaBefore: number;
  /** Projected delta after executing all signals */
  deltaAfter: number;
  /** Estimated total cost of rebalance trades in USDC */
  estimatedCost: number;
}

// ── Strategy Configuration ────────────────────────────────────────────────────

/** Configuration for the delta-neutral strategy */
export interface DeltaNeutralConfig {
  /** Maximum allowed |netDelta| before rebalance triggers */
  deltaThreshold: number;
  /** How often to check portfolio delta (ms) */
  checkIntervalMs: number;
  /** Maximum budget per hedged pair in USDC */
  maxPairExposureUsdc: number;
  /** Maximum allowed position size per leg in USDC */
  maxLegSizeUsdc: number;
  /** Minimum confidence score required for market relationship */
  minCorrelationConfidence: number;
  /** Enable paper trading mode (no real orders) */
  paperTrading: boolean;
}

/** Default safe configuration */
export const DEFAULT_DELTA_NEUTRAL_CONFIG: DeltaNeutralConfig = {
  deltaThreshold: 0.1,
  checkIntervalMs: 30_000,
  maxPairExposureUsdc: 500,
  maxLegSizeUsdc: 250,
  minCorrelationConfidence: 0.7,
  paperTrading: true,
};
