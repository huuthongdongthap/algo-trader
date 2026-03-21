// Order lifecycle manager: track open orders, handle fills, cancel stale orders
import type { Order, OrderStatus } from '../core/types.js';
import type { ClobClient, OrderArgs } from './clob-client.js';
import { logger } from '../core/logger.js';

const STALE_ORDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INTERVAL_MS = 10_000; // 10 seconds

export interface OrderRecord extends Order {
  filledSize: string;
  lastCheckedAt: number;
}

export class OrderManager {
  private orders = new Map<string, OrderRecord>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private client: ClobClient) {}

  /** Place a new limit order and start tracking it */
  async placeOrder(args: OrderArgs): Promise<OrderRecord> {
    const order = await this.client.postOrder(args);
    const record: OrderRecord = {
      ...order,
      filledSize: '0',
      lastCheckedAt: Date.now(),
    };
    this.orders.set(order.id, record);
    logger.info('Order placed', 'OrderManager', { orderId: order.id, side: order.side, price: order.price });
    return record;
  }

  /** Cancel an open order by ID */
  async cancelOrder(orderId: string): Promise<boolean> {
    const record = this.orders.get(orderId);
    if (!record) {
      logger.warn('Cancel: order not found', 'OrderManager', { orderId });
      return false;
    }
    if (record.status === 'cancelled' || record.status === 'filled') {
      return false;
    }
    const success = await this.client.cancelOrder(orderId);
    if (success) {
      this.updateStatus(orderId, 'cancelled');
    }
    return success;
  }

  /** Cancel all open orders for a market */
  async cancelAllForMarket(marketId: string): Promise<number> {
    const open = this.getOpenOrders().filter(o => o.marketId === marketId);
    let cancelled = 0;
    for (const order of open) {
      if (await this.cancelOrder(order.id)) cancelled++;
    }
    return cancelled;
  }

  /** Get all tracked orders */
  getAllOrders(): OrderRecord[] {
    return Array.from(this.orders.values());
  }

  /** Get orders in open/pending state */
  getOpenOrders(): OrderRecord[] {
    return this.getAllOrders().filter(o => o.status === 'open' || o.status === 'pending');
  }

  /** Get orders by market */
  getOrdersForMarket(marketId: string): OrderRecord[] {
    return this.getAllOrders().filter(o => o.marketId === marketId);
  }

  /** Update order status from external source (e.g. WS fill event) */
  updateStatus(orderId: string, status: OrderStatus, filledSize?: string): void {
    const record = this.orders.get(orderId);
    if (!record) return;
    record.status = status;
    if (filledSize !== undefined) record.filledSize = filledSize;
    if (status === 'filled') record.filledAt = Date.now();
    record.lastCheckedAt = Date.now();
    logger.debug('Order status updated', 'OrderManager', { orderId, status, filledSize });
  }

  /** Start polling to cancel stale orders */
  startStalePoll(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.cancelStaleOrders(), POLL_INTERVAL_MS);
    logger.info('Stale order poll started', 'OrderManager');
  }

  /** Stop background polling */
  stopStalePoll(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** Remove filled/cancelled orders older than retention window */
  pruneClosedOrders(olderThanMs: number = 60 * 60 * 1000): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [id, order] of this.orders) {
      const closed = order.status === 'filled' || order.status === 'cancelled' || order.status === 'rejected';
      if (closed && order.createdAt < cutoff) {
        this.orders.delete(id);
      }
    }
  }

  private async cancelStaleOrders(): Promise<void> {
    const now = Date.now();
    const stale = this.getOpenOrders().filter(o => now - o.createdAt > STALE_ORDER_TIMEOUT_MS);
    for (const order of stale) {
      logger.warn('Cancelling stale order', 'OrderManager', { orderId: order.id, ageMs: now - order.createdAt });
      await this.cancelOrder(order.id).catch(err =>
        logger.error('Failed to cancel stale order', 'OrderManager', { orderId: order.id, err: String(err) }),
      );
    }
  }
}
