// Grid trading strategy: automated buy/sell within a defined price range
// Places buy orders below current price, sell orders above.
// On fill: places opposite order at adjacent grid level.

import type { StrategyConfig, Order } from '../../core/types.js';
import { logger } from '../../core/logger.js';
import type { ExchangeClient, SupportedExchange } from '../../cex/exchange-client.js';
import { OrderExecutor } from '../../cex/order-executor.js';

export interface GridConfig {
  exchange: SupportedExchange;
  /** e.g. 'BTC/USDT' */
  symbol: string;
  /** Lower bound of grid range */
  lowerPrice: number;
  /** Upper bound of grid range */
  upperPrice: number;
  /** Number of grid levels (10–50) */
  gridCount: number;
  /** USDT amount per grid order */
  amountPerGrid: number;
}

interface GridOrder {
  gridIndex: number;
  price: number;
  side: 'buy' | 'sell';
  orderId: string;
  status: 'open' | 'filled' | 'cancelled';
}

/** Compute evenly-spaced price levels */
function linspace(low: number, high: number, count: number): number[] {
  const step = (high - low) / (count - 1);
  return Array.from({ length: count }, (_, i) => +(low + i * step).toFixed(8));
}

export class GridTradingStrategy {
  readonly name = 'grid-trading' as const;

  private executor: OrderExecutor;
  private gridLevels: number[] = [];
  private openOrders: Map<string, GridOrder> = new Map(); // orderId → GridOrder
  private realizedPnl = 0;
  private filledCount = 0;
  private running = false;
  private stopPoll?: () => void;

  constructor(
    private config: GridConfig,
    client: ExchangeClient,
    private strategyConfig: StrategyConfig,
  ) {
    this.executor = new OrderExecutor(client);
  }

  /** Initialize grid: fetch current price, place initial buy/sell orders */
  async start(currentPrice: number): Promise<void> {
    this.gridLevels = linspace(this.config.lowerPrice, this.config.upperPrice, this.config.gridCount);
    this.running = true;

    // Auto-pause if price outside range by >10%
    const rangeSize = this.config.upperPrice - this.config.lowerPrice;
    if (
      currentPrice < this.config.lowerPrice - rangeSize * 0.1 ||
      currentPrice > this.config.upperPrice + rangeSize * 0.1
    ) {
      logger.warn('Grid paused: price outside range by >10%', 'GridTradingStrategy', {
        currentPrice,
        lower: this.config.lowerPrice,
        upper: this.config.upperPrice,
      });
      this.running = false;
      return;
    }

    await this.placeInitialOrders(currentPrice);
    logger.info('Grid trading started', 'GridTradingStrategy', {
      symbol: this.config.symbol,
      gridCount: this.config.gridCount,
      lower: this.config.lowerPrice,
      upper: this.config.upperPrice,
    });
  }

  /** Place buy orders below current price, sell orders above */
  private async placeInitialOrders(currentPrice: number): Promise<void> {
    const tasks = this.gridLevels.map(async (price, idx) => {
      const side = price < currentPrice ? 'buy' : 'sell';
      // Skip the level closest to current price to avoid immediate fill
      if (Math.abs(price - currentPrice) / currentPrice < 0.001) return;

      try {
        const amount = this.config.amountPerGrid / price;
        const order = await this.executor.placeLimitOrder({
          exchange: this.config.exchange,
          symbol: this.config.symbol,
          side,
          amount,
          price,
          strategy: 'grid-trading',
        });

        this.openOrders.set(order.id, {
          gridIndex: idx,
          price,
          side,
          orderId: order.id,
          status: 'open',
        });
      } catch (err) {
        logger.error('Failed to place grid order', 'GridTradingStrategy', { price, side, error: String(err) });
      }
    });

    await Promise.allSettled(tasks);
  }

  /**
   * Call when an order fill is detected (e.g. from WebSocket or polling).
   * Places the opposite order at the adjacent grid level.
   */
  async onOrderFilled(orderId: string, fillPrice: number): Promise<void> {
    const gridOrder = this.openOrders.get(orderId);
    if (!gridOrder) return;

    gridOrder.status = 'filled';
    this.filledCount++;

    // Calculate realized PnL contribution (simplified: spread per grid level)
    const gridStep = (this.config.upperPrice - this.config.lowerPrice) / (this.config.gridCount - 1);
    this.realizedPnl += gridStep * (this.config.amountPerGrid / fillPrice);

    // Place opposite order at adjacent grid level
    const oppositeIdx = gridOrder.side === 'buy'
      ? gridOrder.gridIndex + 1
      : gridOrder.gridIndex - 1;

    if (oppositeIdx < 0 || oppositeIdx >= this.gridLevels.length) return;

    const oppositePrice = this.gridLevels[oppositeIdx];
    const oppositeSide = gridOrder.side === 'buy' ? 'sell' : 'buy';

    try {
      const amount = this.config.amountPerGrid / oppositePrice;
      const newOrder = await this.executor.placeLimitOrder({
        exchange: this.config.exchange,
        symbol: this.config.symbol,
        side: oppositeSide,
        amount,
        price: oppositePrice,
        strategy: 'grid-trading',
      });

      this.openOrders.set(newOrder.id, {
        gridIndex: oppositeIdx,
        price: oppositePrice,
        side: oppositeSide,
        orderId: newOrder.id,
        status: 'open',
      });

      logger.info('Grid: placed opposite order', 'GridTradingStrategy', {
        side: oppositeSide,
        price: oppositePrice,
        gridIndex: oppositeIdx,
      });
    } catch (err) {
      logger.error('Failed to place opposite grid order', 'GridTradingStrategy', { error: String(err) });
    }
  }

  /** Cancel all open grid orders and stop strategy */
  async stop(): Promise<void> {
    this.running = false;
    this.stopPoll?.();

    const cancelTasks = Array.from(this.openOrders.values())
      .filter(o => o.status === 'open')
      .map(o => this.executor.cancelOrder(this.config.exchange, o.orderId, this.config.symbol));

    await Promise.allSettled(cancelTasks);
    this.openOrders.clear();
    logger.info('Grid trading stopped', 'GridTradingStrategy', {
      symbol: this.config.symbol,
      realizedPnl: this.realizedPnl.toFixed(4),
      filledCount: this.filledCount,
    });
  }

  getState() {
    return {
      running: this.running,
      openOrderCount: Array.from(this.openOrders.values()).filter(o => o.status === 'open').length,
      filledCount: this.filledCount,
      realizedPnl: this.realizedPnl.toFixed(4),
    };
  }
}
