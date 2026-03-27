/**
 * Binary Opportunity Detector
 * Detects mispriced binary prediction markets on Polymarket.
 * YES + NO prices should sum to ~1.00 (minus ~2% fees).
 * A sum < 0.97 means both sides are cheap → guaranteed profit at settlement.
 */

import { BinaryMarket, BinaryArbitrageOpportunity, ArbitrageLeg } from './types';

/** Configuration for binary market scanning thresholds */
export interface BinaryDetectorConfig {
  /** Minimum sum deviation from 1.0 to flag an opportunity (default 0.02) */
  minMispricing: number;
  /** Minimum market liquidity in USD (default 1000) */
  minLiquidity: number;
  /** Minimum 24h volume in USD (default 5000) */
  minVolume: number;
  /** Maximum number of markets to scan per cycle (default 50) */
  maxMarketsToScan: number;
}

const DEFAULT_CONFIG: BinaryDetectorConfig = {
  minMispricing: 0.02,
  minLiquidity: 1000,
  minVolume: 5000,
  maxMarketsToScan: 50,
};

/** Polymarket fee applied to each trade side */
const POLYMARKET_FEE = 0.01;

/** Expected sum of YES + NO prices after fees (efficient market) */
const EXPECTED_SUM = 1.0 - POLYMARKET_FEE * 2; // ~0.98

export class BinaryOpportunityDetector {
  private config: BinaryDetectorConfig;
  private opportunityCounter = 0;

  constructor(config: Partial<BinaryDetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Scan a list of binary markets for mispricing opportunities.
   * Returns ranked list of actionable opportunities.
   */
  scan(markets: BinaryMarket[]): BinaryArbitrageOpportunity[] {
    const eligible = markets
      .filter((m) => !m.resolved)
      .filter((m) => m.liquidity >= this.config.minLiquidity)
      .filter((m) => m.volume >= this.config.minVolume)
      .slice(0, this.config.maxMarketsToScan);

    const opportunities: BinaryArbitrageOpportunity[] = [];

    for (const market of eligible) {
      const opp = this.evaluateMarket(market);
      if (opp) opportunities.push(opp);
    }

    return this.rankOpportunities(opportunities);
  }

  /**
   * Calculate the edge and direction for a single market.
   * Returns edge as a fraction of stake (e.g. 0.03 = 3% edge).
   */
  calculateEdge(market: BinaryMarket): { edge: number; direction: string } {
    const sum = market.yesPrice + market.noPrice;
    const deviation = EXPECTED_SUM - sum; // positive = both-cheap

    if (deviation >= this.config.minMispricing) {
      return { edge: deviation, direction: 'both-cheap' };
    }

    // Single-side: YES clearly underpriced vs efficient probability
    const impliedYes = market.yesPrice / sum;
    const fairYes = 0.5; // neutral baseline; LLM calibration overrides this
    if (impliedYes < fairYes - this.config.minMispricing) {
      return { edge: fairYes - impliedYes, direction: 'yes-cheap' };
    }
    if (impliedYes > fairYes + this.config.minMispricing) {
      return { edge: impliedYes - fairYes, direction: 'no-cheap' };
    }

    return { edge: 0, direction: 'none' };
  }

  /**
   * Rank opportunities by descending expected profit.
   */
  rankOpportunities(opps: BinaryArbitrageOpportunity[]): BinaryArbitrageOpportunity[] {
    return [...opps].sort((a, b) => b.expectedProfit - a.expectedProfit);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private evaluateMarket(market: BinaryMarket): BinaryArbitrageOpportunity | null {
    const sum = market.yesPrice + market.noPrice;
    const mispricing = Math.abs(EXPECTED_SUM - sum);

    if (mispricing < this.config.minMispricing) return null;

    const { edge, direction } = this.calculateEdge(market);
    if (direction === 'none' || edge <= 0) return null;

    const edgeLabel = direction as BinaryArbitrageOpportunity['edge'];
    const legs = this.buildLegs(market, edgeLabel);
    const profit = edge * this.config.minLiquidity; // conservative estimate
    const profitPct = edge * 100;
    const now = Date.now();

    return {
      id: `bin_${++this.opportunityCounter}_${now}`,
      type: 'binary-arb',
      legs,
      expectedProfit: profit,
      expectedProfitPct: profitPct,
      totalFees: legs.reduce((s, l) => s + l.fee, 0),
      confidence: Math.min(95, 50 + edge * 500),
      detectedAt: now,
      expiresAt: market.endDate.getTime(),
      market,
      mispricing,
      edge: edgeLabel,
    };
  }

  private buildLegs(market: BinaryMarket, edge: BinaryArbitrageOpportunity['edge']): ArbitrageLeg[] {
    const baseAmount = this.config.minLiquidity;
    const fee = POLYMARKET_FEE;

    if (edge === 'both-cheap') {
      return [
        { exchange: 'polymarket', symbol: `${market.conditionId}-YES`, side: 'buy', price: market.yesPrice, amount: baseAmount, fee },
        { exchange: 'polymarket', symbol: `${market.conditionId}-NO`, side: 'buy', price: market.noPrice, amount: baseAmount, fee },
      ];
    }
    if (edge === 'yes-cheap') {
      return [
        { exchange: 'polymarket', symbol: `${market.conditionId}-YES`, side: 'buy', price: market.yesPrice, amount: baseAmount, fee },
      ];
    }
    return [
      { exchange: 'polymarket', symbol: `${market.conditionId}-NO`, side: 'buy', price: market.noPrice, amount: baseAmount, fee },
    ];
  }
}
