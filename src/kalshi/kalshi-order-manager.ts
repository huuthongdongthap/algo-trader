// Kalshi order lifecycle management — wraps KalshiClient, maps to core Order type
import type { KalshiClient, KalshiOrder } from './kalshi-client.js';
import type { CrossPlatformOpportunity } from './kalshi-market-scanner.js';
import type { Order } from '../core/types.js';
import { logger } from '../core/logger.js';

export class KalshiOrderManager {
  constructor(private client: KalshiClient) {}

  /**
   * Submit a limit order based on an arb opportunity.
   * size = number of contracts to buy.
   */
  async submitOrder(opportunity: CrossPlatformOpportunity, size: number): Promise<Order> {
    const { kalshiMarket, direction, kalshiPrice } = opportunity;
    const ticker = kalshiMarket.ticker;

    // We always trade the Kalshi leg: buy YES when Kalshi is cheaper, buy NO otherwise
    const side: 'yes' | 'no' = direction === 'buy-kalshi' ? 'yes' : 'no';

    // Convert normalized price back to cents for Kalshi API
    const priceCents = Math.round(kalshiPrice * 100);

    logger.info('Submitting Kalshi arb order', 'KalshiOrderManager', {
      ticker, side, priceCents, size,
    });

    const raw = await this.client.placeOrder(ticker, side, 'limit', priceCents, size);
    return this.toOrder(raw);
  }

  /** List all open (unfilled) orders */
  async getOpenOrders(): Promise<Order[]> {
    const positions = await this.client.getPositions();
    // Kalshi doesn't expose resting orders via positions; we rely on stored state
    // Return empty — caller should track via submitOrder return values
    logger.debug('getOpenOrders: positions count', 'KalshiOrderManager', { count: positions.length });
    return [];
  }

  /** Cancel all open orders by order IDs provided */
  async cancelAllOrders(orderIds: string[]): Promise<void> {
    const results = await Promise.allSettled(
      orderIds.map(id => this.client.cancelOrder(id)),
    );
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warn('Some cancellations failed', 'KalshiOrderManager', { failed, total: orderIds.length });
    } else {
      logger.info('All orders cancelled', 'KalshiOrderManager', { count: orderIds.length });
    }
  }

  /** Map Kalshi raw order to core Order type */
  private toOrder(raw: KalshiOrder): Order {
    const side = raw.side === 'yes' ? 'buy' : 'sell';
    // Use yes_price as canonical price (cents → decimal string)
    const price = (raw.yes_price / 100).toFixed(2);

    return {
      id: raw.order_id,
      marketId: raw.ticker,
      side,
      price,
      size: raw.count.toString(),
      status: this.mapStatus(raw.status),
      type: raw.type,
      createdAt: new Date(raw.created_time).getTime(),
    };
  }

  private mapStatus(kalshiStatus: string): Order['status'] {
    switch (kalshiStatus.toLowerCase()) {
      case 'resting': return 'open';
      case 'executed': return 'filled';
      case 'partially_filled': return 'partially_filled';
      case 'cancelled': return 'cancelled';
      case 'pending': return 'pending';
      default: return 'open';
    }
  }
}
