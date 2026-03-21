// Funding rate arbitrage: long spot + short perp to collect funding payments.
// Delta-neutral: spot long offsets perp short. Entry when rate > entryThreshold.
// Exit when rate normalizes or stop-loss on combined P&L is hit.

import type { StrategyConfig, Order } from '../../core/types.js';
import { logger } from '../../core/logger.js';
import { sleep } from '../../core/utils.js';
import type { ExchangeClient, SupportedExchange } from '../../cex/exchange-client.js';
import { OrderExecutor } from '../../cex/order-executor.js';
import { MarketData } from '../../cex/market-data.js';

export interface FundingArbConfig {
  exchange: SupportedExchange;
  spotSymbol: string;           // e.g. 'BTC/USDT'
  perpSymbol: string;           // e.g. 'BTC/USDT:USDT'
  capitalUsdt: number;          // capital per trade
  entryThreshold: number;       // open when rate >= this (e.g. 0.0005 = 0.05%/8h)
  exitThreshold: number;        // close when rate <= this (e.g. 0.0001)
  stopLossPercent: number;      // close on loss > capital * this (e.g. 0.02)
  pollIntervalMs?: number;      // default 30s
}

interface ArbPosition {
  spotOrder: Order;
  perpOrder: Order;
  openedAt: number;
  entrySpotPrice: number;
  entryPerpPrice: number;
  fundingCollected: number;
}

export class FundingRateArbStrategy {
  readonly name = 'funding-rate-arb' as const;

  private executor: OrderExecutor;
  private marketData: MarketData;
  private position: ArbPosition | null = null;
  private running = false;
  private totalFundingCollected = 0;

  constructor(
    private config: FundingArbConfig,
    client: ExchangeClient,
    private strategyConfig: StrategyConfig,
  ) {
    this.executor = new OrderExecutor(client);
    this.marketData = new MarketData(client);
  }

  async start(): Promise<void> {
    this.running = true;
    const interval = this.config.pollIntervalMs ?? 30_000;
    logger.info('Funding rate arb started', 'FundingRateArbStrategy', {
      spot: this.config.spotSymbol, perp: this.config.perpSymbol,
    });
    while (this.running) {
      try { await this.tick(); }
      catch (err) { logger.error('Tick error', 'FundingRateArbStrategy', { error: String(err) }); }
      await sleep(interval);
    }
  }

  private async tick(): Promise<void> {
    const fundingData = await this.marketData.getFundingRate(
      this.config.exchange, this.config.perpSymbol,
    );
    if (!fundingData) return;
    const rate = parseFloat(fundingData.rate);
    logger.debug('Funding rate', 'FundingRateArbStrategy', { rate });

    if (!this.position) {
      // Positive rate: longs pay shorts → short perp + long spot (delta neutral)
      if (rate >= this.config.entryThreshold) await this.openPosition(rate);
    } else {
      this.accumulateFunding(rate);
      await this.checkExitConditions(rate);
    }
  }

  private async openPosition(rate: number): Promise<void> {
    const size = this.config.capitalUsdt;
    try {
      const spotOrder = await this.executor.placeMarketOrder({
        exchange: this.config.exchange, symbol: this.config.spotSymbol,
        side: 'buy', amount: size, strategy: 'funding-rate-arb', marketType: 'spot',
      });
      const perpOrder = await this.executor.placeMarketOrder({
        exchange: this.config.exchange, symbol: this.config.perpSymbol,
        side: 'sell', amount: size, strategy: 'funding-rate-arb', marketType: 'swap',
      });
      this.position = {
        spotOrder, perpOrder, openedAt: Date.now(),
        entrySpotPrice: parseFloat(spotOrder.price),
        entryPerpPrice: parseFloat(perpOrder.price),
        fundingCollected: 0,
      };
      logger.info('Arb position opened', 'FundingRateArbStrategy', {
        fundingRate: rate, spotPrice: spotOrder.price, perpPrice: perpOrder.price,
      });
    } catch (err) {
      logger.error('Failed to open arb position', 'FundingRateArbStrategy', { error: String(err) });
    }
  }

  /** Estimate funding income: interval / 8h * rate * capital */
  private accumulateFunding(rate: number): void {
    if (!this.position) return;
    const income = ((this.config.pollIntervalMs ?? 30_000) / (8 * 3600_000)) * rate * this.config.capitalUsdt;
    this.position.fundingCollected += income;
    this.totalFundingCollected += income;
  }

  private async checkExitConditions(rate: number): Promise<void> {
    if (!this.position) return;
    const stopLossHit = this.position.fundingCollected < -(this.config.capitalUsdt * this.config.stopLossPercent);
    const rateNormalized = rate <= this.config.exitThreshold;
    if (rateNormalized || stopLossHit) {
      logger.info('Closing arb position', 'FundingRateArbStrategy', {
        reason: stopLossHit ? 'stop-loss' : 'rate-normalized',
        fundingCollected: this.position.fundingCollected.toFixed(4),
      });
      await this.closePosition();
    }
  }

  private async closePosition(): Promise<void> {
    if (!this.position) return;
    try {
      await this.executor.placeMarketOrder({
        exchange: this.config.exchange, symbol: this.config.spotSymbol,
        side: 'sell', amount: parseFloat(this.position.spotOrder.size),
        strategy: 'funding-rate-arb', marketType: 'spot',
      });
      await this.executor.placeMarketOrder({
        exchange: this.config.exchange, symbol: this.config.perpSymbol,
        side: 'buy', amount: parseFloat(this.position.perpOrder.size),
        strategy: 'funding-rate-arb', marketType: 'swap',
      });
      logger.info('Arb position closed', 'FundingRateArbStrategy', {
        fundingCollected: this.position.fundingCollected.toFixed(4),
        heldMs: Date.now() - this.position.openedAt,
      });
      this.position = null;
    } catch (err) {
      logger.error('Failed to close arb position', 'FundingRateArbStrategy', { error: String(err) });
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.position) await this.closePosition();
    logger.info('Funding rate arb stopped', 'FundingRateArbStrategy', {
      totalFundingCollected: this.totalFundingCollected.toFixed(4),
    });
  }

  getState() {
    return {
      running: this.running,
      hasPosition: !!this.position,
      totalFundingCollected: this.totalFundingCollected.toFixed(4),
      ...(this.position ? {
        fundingCollectedThisTrade: this.position.fundingCollected.toFixed(4),
        openedAt: new Date(this.position.openedAt).toISOString(),
      } : {}),
    };
  }
}
