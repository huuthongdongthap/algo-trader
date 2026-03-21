// Persistent in-memory ring buffer for alert/notification history
// Captures EventBus events and provides query API for users to review past alerts

import type { EventBus } from '../events/event-bus.js';
import type { TradeResult } from '../core/types.js';

export interface AlertRecord {
  id: number;
  type: string;
  message: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

const DEFAULT_MAX_SIZE = 500;

export class AlertHistory {
  private readonly records: AlertRecord[] = [];
  private nextId = 1;
  private readonly maxSize: number;

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
  }

  /** Add an alert to history (ring buffer — evicts oldest when full) */
  push(type: string, message: string, metadata?: Record<string, unknown>): void {
    if (this.records.length >= this.maxSize) {
      this.records.shift();
    }
    this.records.push({
      id: this.nextId++,
      type,
      message,
      timestamp: Date.now(),
      metadata,
    });
  }

  /** Get most recent alerts (newest first) */
  getRecent(limit: number = 50): AlertRecord[] {
    return this.records.slice(-limit).reverse();
  }

  /** Get alerts filtered by type */
  getByType(type: string, limit: number = 50): AlertRecord[] {
    return this.records
      .filter((r) => r.type === type)
      .slice(-limit)
      .reverse();
  }

  /** Get alerts since a given timestamp */
  getSince(since: number, limit: number = 100): AlertRecord[] {
    return this.records
      .filter((r) => r.timestamp >= since)
      .slice(-limit)
      .reverse();
  }

  /** Total count of stored alerts */
  get count(): number {
    return this.records.length;
  }

  /** Available alert types in history */
  getTypes(): string[] {
    return [...new Set(this.records.map((r) => r.type))];
  }

  /**
   * Wire into EventBus — captures alert.triggered, trade.executed,
   * system.error, and notification events automatically.
   */
  wireEventBus(eventBus: EventBus): void {
    eventBus.on('alert.triggered', (payload: { rule: string; message: string }) => {
      this.push('alert', payload.message, { rule: payload.rule });
    });

    eventBus.on('trade.executed', (payload: { trade: TradeResult }) => {
      const t = payload.trade;
      this.push('trade', `${t.side} ${t.marketId} via ${t.strategy}`, { marketId: t.marketId, strategy: t.strategy });
    });

    eventBus.on('strategy.error', (payload: { name: string; error: string }) => {
      this.push('error', `${payload.name}: ${payload.error}`, { strategy: payload.name });
    });
  }
}
