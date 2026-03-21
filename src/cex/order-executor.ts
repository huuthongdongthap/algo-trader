// Order execution via CCXT with retry logic and audit logging
// Supports limit/market orders, cancellation, spot and futures

import type * as ccxt from 'ccxt';
import type { Order, OrderSide, TradeResult, StrategyName } from '../core/types.js';
import { retry, generateId } from '../core/utils.js';
import { logger } from '../core/logger.js';
import type { ExchangeClient, SupportedExchange } from './exchange-client.js';

export interface PlaceOrderParams {
  exchange: SupportedExchange;
  symbol: string;
  side: OrderSide;
  amount: number;
  price?: number;      // undefined = market order
  strategy: StrategyName;
  /** 'swap' for perpetual futures, 'spot' default */
  marketType?: 'spot' | 'swap';
}

/** Map CCXT order status string to core OrderStatus */
function mapStatus(ccxtStatus: string): Order['status'] {
  switch (ccxtStatus) {
    case 'open':        return 'open';
    case 'closed':      return 'filled';
    case 'canceled':
    case 'cancelled':   return 'cancelled';
    case 'rejected':    return 'rejected';
    case 'expired':     return 'cancelled';
    default:            return 'pending';
  }
}

/** Map a raw CCXT Order object to core Order type */
function mapOrder(raw: ccxt.Order, fallback: { side: OrderSide; price: number; amount: number }): Order {
  return {
    id: raw.id ?? generateId('ord'),
    marketId: raw.symbol,
    side: fallback.side,
    price: String(raw.price ?? fallback.price),
    size: String(raw.amount ?? fallback.amount),
    status: mapStatus(raw.status ?? 'open'),
    type: (raw.type === 'market' ? 'market' : 'limit') as Order['type'],
    createdAt: raw.timestamp ?? Date.now(),
    ...(raw.lastTradeTimestamp ? { filledAt: raw.lastTradeTimestamp } : {}),
  };
}

export class OrderExecutor {
  constructor(private client: ExchangeClient) {}

  /** Place a limit order; retries up to 3x on transient failures */
  async placeLimitOrder(params: PlaceOrderParams & { price: number }): Promise<Order> {
    const { exchange, symbol, side, amount, price, strategy, marketType } = params;
    const ex = this.client.getInstance(exchange);

    const extraParams: Record<string, unknown> = {};
    if (marketType === 'swap') extraParams['type'] = 'swap';

    const raw = await retry(
      () => ex.createLimitOrder(symbol, side, amount, price, extraParams),
      3,
      500,
    );

    const order = mapOrder(raw, { side, price, amount });

    logger.info('Limit order placed', 'OrderExecutor', {
      exchange, symbol, side, price: order.price, size: order.size, strategy,
    });
    return order;
  }

  /** Place a market order; retries up to 3x */
  async placeMarketOrder(params: PlaceOrderParams): Promise<Order> {
    const { exchange, symbol, side, amount, strategy, marketType } = params;
    const ex = this.client.getInstance(exchange);

    const extraParams: Record<string, unknown> = {};
    if (marketType === 'swap') extraParams['type'] = 'swap';

    const raw = await retry(
      () => ex.createMarketOrder(symbol, side, amount, undefined, extraParams),
      3,
      500,
    );

    // Market orders fill immediately — use average fill price
    const fillPrice = raw.average ?? raw.price ?? 0;
    const order: Order = {
      id: raw.id ?? generateId('ord'),
      marketId: raw.symbol,
      side,
      price: String(fillPrice),
      size: String(raw.filled ?? amount),
      status: mapStatus(raw.status ?? 'closed'),
      type: 'market',
      createdAt: raw.timestamp ?? Date.now(),
      filledAt: raw.lastTradeTimestamp ?? Date.now(),
    };

    logger.info('Market order placed', 'OrderExecutor', {
      exchange, symbol, side, size: order.size, strategy,
    });
    return order;
  }

  /** Cancel an open order by ID */
  async cancelOrder(
    exchange: SupportedExchange,
    orderId: string,
    symbol: string,
  ): Promise<boolean> {
    const ex = this.client.getInstance(exchange);
    try {
      await ex.cancelOrder(orderId, symbol);
      logger.info('Order cancelled', 'OrderExecutor', { exchange, orderId, symbol });
      return true;
    } catch (err) {
      logger.error('Cancel order failed', 'OrderExecutor', {
        exchange, orderId, error: String(err),
      });
      return false;
    }
  }

  /** Build a TradeResult from a filled Order (for PnL tracking) */
  toTradeResult(order: Order, fees: string, strategy: StrategyName): TradeResult {
    return {
      orderId: order.id,
      marketId: order.marketId,
      side: order.side,
      fillPrice: order.price,
      fillSize: order.size,
      fees,
      timestamp: order.filledAt ?? order.createdAt,
      strategy,
    };
  }
}
