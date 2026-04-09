/**
 * Delta-Neutral Volatility Arbitrage Strategy
 * Constructs and monitors hedged positions across correlated Polymarket markets.
 *
 * Mechanism:
 * - Takes correlated market pairs from Phase 02 DependencyGraph
 * - Opens: long YES on Market A + long NO on correlated Market B
 * - Monitors net delta every checkIntervalMs
 * - Triggers rebalance when |netDelta| > threshold
 *
 * Separated into: strategy (this file) + portfolio-monitor.ts
 */

import { EventEmitter } from 'events';
import logger from '../../utils/logger';
import {
  DependencyGraph,
  MarketRelationship,
  RelationType,
} from '../../types/semantic-relationships';
import {
  DEFAULT_DELTA_NEUTRAL_CONFIG,
  DeltaNeutralConfig,
  DeltaNeutralPortfolio,
  HedgePosition,
  RebalanceSignal,
} from '../../types/delta-neutral-types';
import { computePortfolioDelta } from './delta-calculator';
import { DeltaNeutralPortfolioMonitor } from './delta-neutral-portfolio-monitor';

/** Events emitted by this strategy */
export interface DeltaNeutralEvents {
  'portfolio:updated': (portfolio: DeltaNeutralPortfolio) => void;
  'rebalance:triggered': (signals: RebalanceSignal[]) => void;
  'rebalance:completed': (portfolio: DeltaNeutralPortfolio) => void;
  'position:opened': (pair: MarketRelationship) => void;
}

export class DeltaNeutralVolatilityArbitrage extends EventEmitter {
  private config: DeltaNeutralConfig;
  private portfolios: Map<string, DeltaNeutralPortfolio> = new Map();
  private monitor: DeltaNeutralPortfolioMonitor;

  constructor(config: Partial<DeltaNeutralConfig> = {}) {
    super();
    this.config = { ...DEFAULT_DELTA_NEUTRAL_CONFIG, ...config };
    this.monitor = new DeltaNeutralPortfolioMonitor(this.config, this.portfolios, this);
  }

  /**
   * Initialize hedged positions from correlated market pairs in DependencyGraph.
   * Only CORRELATED or MUTUAL_EXCLUSION relationships qualify for hedging.
   */
  initializeFromGraph(
    graph: DependencyGraph,
    initialPrices: Record<string, { yes: number; no: number }>
  ): void {
    const eligiblePairs = graph.relationships.filter(
      (r) =>
        (r.type === RelationType.CORRELATED ||
          r.type === RelationType.MUTUAL_EXCLUSION) &&
        r.confidence >= this.config.minCorrelationConfidence
    );

    logger.info(
      `[DeltaNeutral] Found ${eligiblePairs.length} eligible pairs from ${graph.marketCount} markets`
    );

    for (const pair of eligiblePairs) {
      const pricesA = initialPrices[pair.marketA];
      const pricesB = initialPrices[pair.marketB];

      if (!pricesA || !pricesB) {
        logger.warn(
          `[DeltaNeutral] Missing prices for pair ${pair.marketA}/${pair.marketB}`
        );
        continue;
      }

      this.openHedgedPair(pair, pricesA, pricesB);
    }

    this.monitor.start();
  }

  /**
   * Open a hedged pair: long YES on marketA + long NO on marketB.
   * Splits maxPairExposureUsdc equally between the two legs.
   */
  private openHedgedPair(
    pair: MarketRelationship,
    pricesA: { yes: number; no: number },
    pricesB: { yes: number; no: number }
  ): void {
    const legSize = Math.min(
      this.config.maxPairExposureUsdc / 2,
      this.config.maxLegSizeUsdc
    );

    const positions: HedgePosition[] = [
      {
        marketId: pair.marketA,
        side: 'YES',
        size: legSize,
        entryPrice: pricesA.yes,
        currentPrice: pricesA.yes,
      },
      {
        marketId: pair.marketB,
        side: 'NO',
        size: legSize,
        entryPrice: pricesB.no,
        currentPrice: pricesB.no,
      },
    ];

    const portfolioId = `${pair.marketA}:${pair.marketB}`;
    const deltaResult = computePortfolioDelta(positions, this.config.deltaThreshold);

    const portfolio: DeltaNeutralPortfolio = {
      id: portfolioId,
      positions,
      netDelta: deltaResult.netDelta,
      totalExposure: legSize * 2,
      unrealizedPnl: 0,
      updatedAt: Date.now(),
    };

    this.portfolios.set(portfolioId, portfolio);
    this.emit('position:opened', pair);

    logger.info(
      `[DeltaNeutral] Opened pair ${portfolioId} | delta=${deltaResult.netDelta.toFixed(4)} | ` +
      `${this.config.paperTrading ? 'PAPER' : 'LIVE'}`
    );
  }

  /** Delegate price update to monitor */
  updatePrices(marketId: string, yesPrice: number, noPrice: number): void {
    this.monitor.updatePrices(marketId, yesPrice, noPrice);
  }

  /** Stop monitoring and clean up */
  stop(): void {
    this.monitor.stop();
  }

  /** Get all active portfolios (read-only snapshot) */
  getPortfolios(): DeltaNeutralPortfolio[] {
    return Array.from(this.portfolios.values());
  }
}
