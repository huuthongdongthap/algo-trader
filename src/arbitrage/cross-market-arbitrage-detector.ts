/**
 * Cross-Market Arbitrage Detector
 *
 * Orchestrates the full pipeline:
 *   1. Accept live market prices + dependency graph from Phase 02
 *   2. Compute per-market edge (YES + NO price gap after fees)
 *   3. Build and solve ILP model
 *   4. Validate and return a MultiLegBasket ready for execution
 *
 * Optionally publishes candidates to NATS `signal.crossmarket.candidate`.
 */

import { logger } from '../utils/logger';
import type { DependencyGraph, MarketRelationship } from '../types/semantic-relationships';
import { RelationType } from '../types/semantic-relationships';
import type { MarketOpportunity, ILPSolverConfig, MultiLegBasket } from '../types/ilp-types';
import { solveILP } from './integer-programming-solver';
import { buildValidatedBasket, formatBasketSummary } from './multi-leg-basket';
import { buildSolverConfig } from './ilp-constraint-builder';

// ── Raw price input ───────────────────────────────────────────────────────

/** Raw Polymarket price data for a single market */
export interface MarketPrice {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  /** Available liquidity in USDC */
  liquidity: number;
}

// ── Edge computation ──────────────────────────────────────────────────────

const POLYMARKET_FEE_RATE = 0.02;

/**
 * Compute expected edge for a market.
 * Edge = (1 - yesPrice - noPrice) — the gap vs fair value of 1.0.
 * Positive edge = YES+NO < 1.0 → arbitrage profit after fees.
 */
function computeEdge(price: MarketPrice): number {
  return 1.0 - price.yesPrice - price.noPrice - POLYMARKET_FEE_RATE;
}

/** Convert raw prices to MarketOpportunity objects with computed edge */
function pricesToOpportunities(prices: MarketPrice[]): MarketOpportunity[] {
  return prices.map(p => ({
    marketId: p.marketId,
    question: p.question,
    yesPrice: p.yesPrice,
    noPrice: p.noPrice,
    expectedEdge: computeEdge(p),
    liquidity: p.liquidity,
  }));
}

// ── Correlation penalty ───────────────────────────────────────────────────

/**
 * Apply a conservative liquidity penalty to mutually exclusive markets.
 * MUTUAL_EXCLUSION pairs cannot both pay out, so reduce effective liquidity
 * to avoid over-allocating to correlated bets.
 */
function applyCorrelationPenalties(
  opportunities: MarketOpportunity[],
  graph: DependencyGraph
): MarketOpportunity[] {
  const mutualExclusionPairs = new Set<string>();
  const exclusions = graph.relationships.filter(
    (r: MarketRelationship) => r.type === RelationType.MUTUAL_EXCLUSION && r.confidence > 0.7
  );

  for (const rel of exclusions) {
    mutualExclusionPairs.add(rel.marketA);
    mutualExclusionPairs.add(rel.marketB);
  }

  return opportunities.map(op => {
    if (mutualExclusionPairs.has(op.marketId)) {
      // Halve liquidity for mutually exclusive markets to reduce correlated exposure
      return { ...op, liquidity: op.liquidity * 0.5 };
    }
    return op;
  });
}

// ── Main detector ─────────────────────────────────────────────────────────

export interface DetectorResult {
  basket: MultiLegBasket | null;
  opportunitiesScanned: number;
  solveTimeMs: number;
}

/**
 * Detect and solve cross-market arbitrage opportunities.
 *
 * @param prices - Live YES/NO prices for all markets to consider
 * @param graph  - Dependency graph from Phase 02 (used for correlation penalty)
 * @param configOverrides - Optional config overrides (budget, thresholds, etc.)
 */
export function detectCrossMarketArbitrage(
  prices: MarketPrice[],
  graph: DependencyGraph,
  configOverrides: Partial<ILPSolverConfig> = {}
): DetectorResult {
  const config = buildSolverConfig(configOverrides);

  logger.info('[CrossMarketDetector] Starting detection', {
    markets: prices.length,
    graphRelationships: graph.relationships.length,
    budget: config.budgetUsdc,
  });

  // Step 1: Compute edge for all markets
  const opportunities = pricesToOpportunities(prices);

  // Step 2: Apply correlation penalties from dependency graph
  const adjusted = applyCorrelationPenalties(opportunities, graph);

  // Step 3: Solve ILP
  const result = solveILP(adjusted, config);

  // Step 4: Validate and build basket
  const basket = buildValidatedBasket(result, config);

  if (basket) {
    logger.info('[CrossMarketDetector] Basket ready', { summary: formatBasketSummary(basket) });
  } else {
    logger.info('[CrossMarketDetector] No valid basket — no actionable arbitrage found');
  }

  return {
    basket,
    opportunitiesScanned: adjusted.length,
    solveTimeMs: result.solveTimeMs,
  };
}
