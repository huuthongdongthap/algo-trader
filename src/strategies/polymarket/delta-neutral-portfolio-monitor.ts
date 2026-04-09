/**
 * Delta-Neutral Portfolio Monitor
 * Handles price updates, delta monitoring, and rebalance execution.
 * Separated from strategy class to keep files under 200 lines.
 *
 * Used by: delta-neutral-volatility-arbitrage
 */

import { EventEmitter } from 'events';
import logger from '../../utils/logger';
import {
  DeltaNeutralConfig,
  DeltaNeutralPortfolio,
} from '../../types/delta-neutral-types';
import {
  computePortfolioDelta,
  computePortfolioPnl,
} from './delta-calculator';
import {
  applyRebalanceSignals,
  computeRebalanceSignals,
  requiresRebalance,
} from './rebalance-engine';

export class DeltaNeutralPortfolioMonitor {
  private config: DeltaNeutralConfig;
  private portfolios: Map<string, DeltaNeutralPortfolio>;
  private emitter: EventEmitter;
  private timer?: NodeJS.Timeout;

  constructor(
    config: DeltaNeutralConfig,
    portfolios: Map<string, DeltaNeutralPortfolio>,
    emitter: EventEmitter
  ) {
    this.config = config;
    this.portfolios = portfolios;
    this.emitter = emitter;
  }

  /** Start the periodic delta monitoring loop */
  start(): void {
    if (this.timer) return;

    this.timer = setInterval(
      () => this.checkAll(),
      this.config.checkIntervalMs
    );

    logger.info(
      `[Monitor] Started | interval=${this.config.checkIntervalMs}ms | portfolios=${this.portfolios.size}`
    );
  }

  /** Stop the monitoring timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    logger.info('[Monitor] Stopped');
  }

  /**
   * Update market prices across all portfolios that reference this market.
   * Recomputes delta and PnL after each price change.
   */
  updatePrices(marketId: string, yesPrice: number, noPrice: number): void {
    for (const [id, portfolio] of this.portfolios) {
      let changed = false;

      for (const pos of portfolio.positions) {
        if (pos.marketId === marketId) {
          pos.currentPrice = pos.side === 'YES' ? yesPrice : noPrice;
          changed = true;
        }
      }

      if (!changed) continue;

      const deltaResult = computePortfolioDelta(
        portfolio.positions,
        this.config.deltaThreshold
      );
      portfolio.netDelta = deltaResult.netDelta;
      portfolio.unrealizedPnl = computePortfolioPnl(portfolio.positions);
      portfolio.updatedAt = Date.now();

      this.portfolios.set(id, portfolio);
      this.emitter.emit('portfolio:updated', portfolio);
    }
  }

  /** Check all portfolios and trigger rebalance where threshold exceeded */
  private checkAll(): void {
    for (const [id, portfolio] of this.portfolios) {
      if (!requiresRebalance(portfolio, this.config.deltaThreshold)) continue;

      logger.info(
        `[Monitor] Rebalance triggered | ${id} | delta=${portfolio.netDelta.toFixed(4)}`
      );

      const result = computeRebalanceSignals(
        portfolio,
        this.config.deltaThreshold,
        this.config.maxLegSizeUsdc
      );

      this.emitter.emit('rebalance:triggered', result.signals);

      if (this.config.paperTrading) {
        this.applyPaperRebalance(id, portfolio, result.signals.length);
      }
    }
  }

  /** Apply rebalance signals in paper trading mode (no real orders) */
  private applyPaperRebalance(
    portfolioId: string,
    portfolio: DeltaNeutralPortfolio,
    signalCount: number
  ): void {
    const result = computeRebalanceSignals(
      portfolio,
      this.config.deltaThreshold,
      this.config.maxLegSizeUsdc
    );

    const updated = applyRebalanceSignals(portfolio.positions, result.signals);
    const newDelta = computePortfolioDelta(updated, this.config.deltaThreshold);

    portfolio.positions = updated;
    portfolio.netDelta = newDelta.netDelta;
    portfolio.updatedAt = Date.now();

    this.portfolios.set(portfolioId, portfolio);
    this.emitter.emit('rebalance:completed', portfolio);

    logger.info(
      `[Monitor] Paper rebalance done | ${portfolioId} | delta=${newDelta.netDelta.toFixed(4)} | trades=${signalCount}`
    );
  }
}
