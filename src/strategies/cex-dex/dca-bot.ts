// DCA (Dollar-Cost Averaging) bot: buys fixed amount at regular intervals
// Tracks average entry price and total invested across multiple symbols.

import type { StrategyConfig } from '../../core/types.js';
import { logger } from '../../core/logger.js';
import type { ExchangeClient, SupportedExchange } from '../../cex/exchange-client.js';
import { OrderExecutor } from '../../cex/order-executor.js';

export type DcaInterval = 'hourly' | 'daily' | 'weekly';

const INTERVAL_MS: Record<DcaInterval, number> = {
  hourly:  3_600_000,
  daily:  86_400_000,
  weekly: 604_800_000,
};

export interface DcaSymbolConfig {
  exchange: SupportedExchange;
  /** e.g. 'BTC/USDT' */
  symbol: string;
  /** USDT spend per buy */
  amountPerBuy: number;
  interval: DcaInterval;
}

interface DcaPosition {
  totalInvested: number;
  totalAmount: number;
  avgEntryPrice: number;
  buyCount: number;
  /** Timer handle (Node.js) */
  timer?: ReturnType<typeof setInterval>;
}

export class DcaBotStrategy {
  readonly name = 'dca-bot' as const;

  private executor: OrderExecutor;
  /** key: `${exchange}:${symbol}` */
  private positions: Map<string, DcaPosition> = new Map();

  constructor(
    private configs: DcaSymbolConfig[],
    client: ExchangeClient,
    private strategyConfig: StrategyConfig,
  ) {
    this.executor = new OrderExecutor(client);
  }

  /** Start DCA schedules for all configured symbols */
  start(): void {
    for (const cfg of this.configs) {
      const key = `${cfg.exchange}:${cfg.symbol}`;
      if (this.positions.has(key)) {
        logger.warn('DCA already running for symbol', 'DcaBotStrategy', { symbol: cfg.symbol });
        continue;
      }

      const position: DcaPosition = {
        totalInvested: 0,
        totalAmount: 0,
        avgEntryPrice: 0,
        buyCount: 0,
      };

      // Execute immediately on start, then on interval
      this.executeBuy(cfg, position);

      const timer = setInterval(() => {
        this.executeBuy(cfg, position);
      }, INTERVAL_MS[cfg.interval]);

      position.timer = timer;
      this.positions.set(key, position);

      logger.info('DCA started', 'DcaBotStrategy', {
        symbol: cfg.symbol,
        amountPerBuy: cfg.amountPerBuy,
        interval: cfg.interval,
      });
    }
  }

  /** Execute a single market buy and update position tracking */
  private async executeBuy(cfg: DcaSymbolConfig, position: DcaPosition): Promise<void> {
    try {
      // Fetch current price to estimate amount in base currency
      // amount = USDT / price (market order uses current ask)
      // We pass amountPerBuy as quote amount — CCXT handles conversion for market orders
      const order = await this.executor.placeMarketOrder({
        exchange: cfg.exchange,
        symbol: cfg.symbol,
        side: 'buy',
        amount: cfg.amountPerBuy,
        strategy: 'dca-bot',
      });

      const fillPrice = parseFloat(order.price);
      const fillSize = parseFloat(order.size);

      // Update running average: avgPrice = totalCost / totalAmount
      position.totalInvested += cfg.amountPerBuy;
      position.totalAmount += fillSize;
      position.avgEntryPrice = position.totalInvested / position.totalAmount;
      position.buyCount++;

      logger.info('DCA buy executed', 'DcaBotStrategy', {
        symbol: cfg.symbol,
        fillPrice,
        fillSize,
        avgEntryPrice: position.avgEntryPrice.toFixed(4),
        totalInvested: position.totalInvested.toFixed(2),
        buyCount: position.buyCount,
      });
    } catch (err) {
      logger.error('DCA buy failed', 'DcaBotStrategy', {
        symbol: cfg.symbol,
        error: String(err),
      });
    }
  }

  /** Stop DCA for a specific symbol */
  stop(exchange: SupportedExchange, symbol: string): void {
    const key = `${exchange}:${symbol}`;
    const pos = this.positions.get(key);
    if (!pos) return;

    clearInterval(pos.timer);
    this.positions.delete(key);
    logger.info('DCA stopped', 'DcaBotStrategy', { symbol });
  }

  /** Stop all active DCA schedules */
  stopAll(): void {
    for (const [key, pos] of this.positions.entries()) {
      clearInterval(pos.timer);
      logger.info('DCA stopped', 'DcaBotStrategy', { key });
    }
    this.positions.clear();
  }

  /** Get current state for all tracked symbols */
  getState(): Record<string, Omit<DcaPosition, 'timer'>> {
    const result: Record<string, Omit<DcaPosition, 'timer'>> = {};
    for (const [key, pos] of this.positions.entries()) {
      result[key] = {
        totalInvested: pos.totalInvested,
        totalAmount: pos.totalAmount,
        avgEntryPrice: pos.avgEntryPrice,
        buyCount: pos.buyCount,
      };
    }
    return result;
  }
}
