// User webhook registry: users register callback URLs to receive trade/alert notifications
// Stores registrations in-memory (persists via EventBus wiring, not DB)
// Dispatches events to registered URLs via WebhookRetryQueue

import { randomUUID } from 'node:crypto';
import { logger } from '../core/logger.js';
import type { EventBus } from '../events/event-bus.js';
import type { TradeResult } from '../core/types.js';
import { WebhookRetryQueue } from './webhook-retry.js';

export interface WebhookRegistration {
  id: string;
  userId: string;
  url: string;
  events: string[]; // 'trade' | 'alert' | 'error'
  createdAt: number;
  active: boolean;
}

export class UserWebhookRegistry {
  private registrations: WebhookRegistration[] = [];
  private readonly retryQueue: WebhookRetryQueue;

  constructor() {
    this.retryQueue = new WebhookRetryQueue();
    this.retryQueue.start();
  }

  /** Register a webhook URL for a user */
  register(userId: string, url: string, events: string[]): WebhookRegistration {
    const reg: WebhookRegistration = {
      id: randomUUID(),
      userId,
      url,
      events: events.length > 0 ? events : ['trade'],
      createdAt: Date.now(),
      active: true,
    };
    this.registrations.push(reg);
    logger.info(`Webhook registered: ${reg.id} for user ${userId}`, 'UserWebhookRegistry');
    return reg;
  }

  /** Get all registrations for a user */
  getByUser(userId: string): WebhookRegistration[] {
    return this.registrations.filter(r => r.userId === userId && r.active);
  }

  /** Remove a registration */
  remove(id: string, userId: string): boolean {
    const reg = this.registrations.find(r => r.id === id && r.userId === userId);
    if (!reg) return false;
    reg.active = false;
    return true;
  }

  /** Dispatch an event to all matching user webhooks */
  dispatch(eventType: string, payload: Record<string, unknown>): void {
    const matching = this.registrations.filter(
      r => r.active && r.events.includes(eventType),
    );
    for (const reg of matching) {
      const body = JSON.stringify({ event: eventType, data: payload, timestamp: Date.now() });
      this.retryQueue.enqueue(`${reg.id}-${Date.now()}`, reg.url, body);
    }
  }

  /** Wire into EventBus to auto-dispatch trade and alert events */
  wireEventBus(eventBus: EventBus): void {
    eventBus.on('trade.executed', (payload: { trade: TradeResult }) => {
      const t = payload.trade;
      this.dispatch('trade', {
        orderId: t.orderId,
        marketId: t.marketId,
        side: t.side,
        fillPrice: t.fillPrice,
        fillSize: t.fillSize,
        strategy: t.strategy,
      });
    });

    eventBus.on('alert.triggered', (payload: { rule: string; message: string }) => {
      this.dispatch('alert', { rule: payload.rule, message: payload.message });
    });

    eventBus.on('strategy.error', (payload: { name: string; error: string }) => {
      this.dispatch('error', { strategy: payload.name, error: payload.error });
    });
  }

  /** Get delivery stats */
  getStats() {
    return {
      registrations: this.registrations.filter(r => r.active).length,
      deliveryStats: this.retryQueue.getStats(),
    };
  }

  stop(): void {
    this.retryQueue.stop();
  }
}
