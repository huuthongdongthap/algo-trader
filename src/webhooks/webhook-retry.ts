// Webhook delivery retry with exponential backoff
// Retries failed webhook deliveries up to MAX_ATTEMPTS with 1s → 4s → 16s delays

import { logger } from '../core/logger.js';

export interface WebhookDelivery {
  id: string;
  url: string;
  payload: string;
  attempt: number;
  maxAttempts: number;
  lastAttemptAt: number;
  nextRetryAt: number;
  status: 'pending' | 'delivered' | 'failed';
  lastError?: string;
}

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 1_000;

/** Calculate delay using exponential backoff: 1s, 4s, 16s */
function getBackoffDelay(attempt: number): number {
  return BASE_DELAY_MS * Math.pow(4, attempt - 1);
}

export class WebhookRetryQueue {
  private queue: WebhookDelivery[] = [];
  private history: WebhookDelivery[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Start processing the retry queue every second */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.processQueue(), 1_000);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Enqueue a webhook for delivery with retry support */
  enqueue(id: string, url: string, payload: string): WebhookDelivery {
    const delivery: WebhookDelivery = {
      id,
      url,
      payload,
      attempt: 0,
      maxAttempts: MAX_ATTEMPTS,
      lastAttemptAt: 0,
      nextRetryAt: Date.now(),
      status: 'pending',
    };
    this.queue.push(delivery);
    logger.debug(`Webhook enqueued: ${id} → ${url}`, 'WebhookRetry');
    return delivery;
  }

  /** Process all deliveries that are due for retry */
  private async processQueue(): Promise<void> {
    const now = Date.now();
    const due = this.queue.filter(d => d.status === 'pending' && d.nextRetryAt <= now);

    for (const delivery of due) {
      delivery.attempt++;
      delivery.lastAttemptAt = now;

      try {
        const response = await fetch(delivery.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: delivery.payload,
          signal: AbortSignal.timeout(10_000),
        });

        if (response.ok) {
          delivery.status = 'delivered';
          this.archive(delivery);
          logger.info(`Webhook delivered: ${delivery.id} (attempt ${delivery.attempt})`, 'WebhookRetry');
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        delivery.lastError = msg;

        if (delivery.attempt >= delivery.maxAttempts) {
          delivery.status = 'failed';
          this.archive(delivery);
          logger.warn(`Webhook failed permanently: ${delivery.id} after ${delivery.attempt} attempts — ${msg}`, 'WebhookRetry');
        } else {
          delivery.nextRetryAt = now + getBackoffDelay(delivery.attempt);
          logger.info(`Webhook retry scheduled: ${delivery.id} attempt ${delivery.attempt + 1} in ${getBackoffDelay(delivery.attempt)}ms`, 'WebhookRetry');
        }
      }
    }
  }

  private archive(delivery: WebhookDelivery): void {
    this.queue = this.queue.filter(d => d.id !== delivery.id);
    this.history.push(delivery);
    if (this.history.length > 200) this.history.shift();
  }

  /** Get recent delivery history */
  getHistory(limit = 50): WebhookDelivery[] {
    return this.history.slice(-limit).reverse();
  }

  /** Get pending deliveries in queue */
  getPending(): WebhookDelivery[] {
    return this.queue.filter(d => d.status === 'pending');
  }

  /** Stats summary */
  getStats(): { pending: number; delivered: number; failed: number } {
    const delivered = this.history.filter(d => d.status === 'delivered').length;
    const failed = this.history.filter(d => d.status === 'failed').length;
    return { pending: this.getPending().length, delivered, failed };
  }
}
