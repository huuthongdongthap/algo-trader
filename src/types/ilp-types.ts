/**
 * ILP (Integer Linear Programming) Types for Cross-Market Arbitrage
 * Polymarket multi-market position optimization types
 */

// ── Market Data ──────────────────────────────────────────────────────────────

/** A single Polymarket prediction market with pricing and edge data */
export interface MarketOpportunity {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  /** YES+NO gap minus fees — positive means arbitrage edge exists */
  expectedEdge: number;
  /** Available liquidity in USDC */
  liquidity: number;
}

// ── ILP Model Building Blocks ─────────────────────────────────────────────

/** A decision variable in the ILP: position size for one side of one market */
export interface ILPVariable {
  /** Format: `{marketId}_YES` or `{marketId}_NO` */
  id: string;
  marketId: string;
  side: 'YES' | 'NO';
  /** Expected profit coefficient for objective function */
  profitCoefficient: number;
  /** Maximum allowed size (liquidity cap or per-market budget) */
  upperBound: number;
}

/** A linear constraint in the ILP formulation */
export interface ILPConstraint {
  name: string;
  type: 'budget' | 'per-market-max' | 'min-edge' | 'correlation';
  /** Upper or lower bound for the constraint */
  bound: number;
  /** Constraint direction */
  relation: 'max' | 'min';
}

// ── Solver Configuration ──────────────────────────────────────────────────

/** Configurable constraints for the ILP solver */
export interface ILPSolverConfig {
  /** Total capital budget in USDC */
  budgetUsdc: number;
  /** Maximum fraction of budget per market (default 0.20 = 20%) */
  maxMarketExposureFraction: number;
  /** Minimum edge required to include position (default 0.025 = 2.5%) */
  minEdgeThreshold: number;
  /** Polymarket fee rate (default 0.02 = 2%) */
  feeRate: number;
  /** Solver timeout in ms (default 500) */
  timeoutMs: number;
}

// ── Solver Result ─────────────────────────────────────────────────────────

/** One position in the optimal basket */
export interface ILPPosition {
  marketId: string;
  side: 'YES' | 'NO';
  /** Position size in USDC */
  size: number;
  expectedProfit: number;
}

/** Full result from ILP solver */
export interface ILPResult {
  positions: ILPPosition[];
  totalExpectedProfit: number;
  totalCost: number;
  feasible: boolean;
  /** Solver wall-clock time in ms */
  solveTimeMs: number;
}

// ── Multi-Leg Basket ──────────────────────────────────────────────────────

/** Validated, ready-to-execute multi-market arbitrage basket */
export interface MultiLegBasket {
  id: string;
  positions: ILPPosition[];
  totalExpectedProfit: number;
  totalCost: number;
  /** After edge + risk validation */
  validated: boolean;
  createdAt: number;
}

/** Basket validation result */
export interface BasketValidationResult {
  valid: boolean;
  reasons: string[];
}
