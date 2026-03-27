/**
 * Pub/Sub for Orderbook Snapshots
 * Real-time orderbook updates via Redis Pub/Sub
 *
 * Channels:
 * - orderbook:{exchange}:{symbol}:snapshot
 * - orderbook:global:alert
 */

import { getRedisClient, getPubClient, getSubClient } from './index';
import { OrderBook } from './orderbook-manager';

export interface OrderbookSnapshot {
  exchange: string;
  symbol: string;
  bids: { price: number; amount: number }[];
  asks: { price: number; amount: number }[];
  timestamp: number;
  latency: number;
}

export type SnapshotHandler = (snapshot: OrderbookSnapshot) => void;
export type AlertHandler = (alert: { type: string; data: unknown }) => void;

export class PubSubManager {
  private pub: ReturnType<typeof getPubClient>;
  private sub: ReturnType<typeof getSubClient>;
  private snapshotHandlers: Map<string, Set<SnapshotHandler>> = new Map();
  private alertHandlers: Set<AlertHandler> = new Set();

  constructor() {
    this.pub = getPubClient();
    this.sub = getSubClient();
    this.setupSubscribers();
  }

  private getSnapshotChannel(exchange: string, symbol: string): string {
    return `orderbook:${exchange}:${symbol}:snapshot`;
  }

  private getAlertChannel(): string {
    return 'orderbook:global:alert';
  }

  private setupSubscribers(): void {
    this.sub.on('message', (channel, message) => {
      const data = JSON.parse(message);

      // Handle snapshot messages
      if (channel.includes('snapshot')) {
        const handlers = this.snapshotHandlers.get(channel);
        handlers?.forEach((handler) => handler(data));
      }

      // Handle alert messages
      if (channel === this.getAlertChannel()) {
        this.alertHandlers.forEach((handler) => handler(data));
      }
    });
  }

  /**
   * Subscribe to orderbook snapshots for a symbol
   */
  subscribeToSnapshot(
    exchange: string,
    symbol: string,
    handler: SnapshotHandler
  ): void {
    const channel = this.getSnapshotChannel(exchange, symbol);

    if (!this.snapshotHandlers.has(channel)) {
      this.snapshotHandlers.set(channel, new Set());
      this.sub.subscribe(channel);
    }

    this.snapshotHandlers.get(channel)!.add(handler);
  }

  /**
   * Unsubscribe from orderbook snapshots
   */
  unsubscribeFromSnapshot(
    exchange: string,
    symbol: string,
    handler: SnapshotHandler
  ): void {
    const channel = this.getSnapshotChannel(exchange, symbol);
    const handlers = this.snapshotHandlers.get(channel);

    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.snapshotHandlers.delete(channel);
        this.sub.unsubscribe(channel);
      }
    }
  }

  /**
   * Subscribe to global alerts
   */
  subscribeToAlerts(handler: AlertHandler): void {
    this.alertHandlers.add(handler);
    this.sub.subscribe(this.getAlertChannel());
  }

  /**
   * Unsubscribe from global alerts
   */
  unsubscribeFromAlerts(handler: AlertHandler): void {
    this.alertHandlers.delete(handler);
    if (this.alertHandlers.size === 0) {
      this.sub.unsubscribe(this.getAlertChannel());
    }
  }

  /**
   * Publish orderbook snapshot
   */
  async publishSnapshot(snapshot: OrderbookSnapshot): Promise<void> {
    const channel = this.getSnapshotChannel(snapshot.exchange, snapshot.symbol);
    await this.pub.publish(channel, JSON.stringify(snapshot));
  }

  /**
   * Publish global alert
   */
  async publishAlert(type: string, data: unknown): Promise<void> {
    const channel = this.getAlertChannel();
    await this.pub.publish(channel, JSON.stringify({ type, data }));
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.sub.quit();
    await this.pub.quit();
  }
}
