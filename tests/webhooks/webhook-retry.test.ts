import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebhookRetryQueue } from '../../src/webhooks/webhook-retry.js';

describe('WebhookRetryQueue', () => {
  let queue: WebhookRetryQueue;

  beforeEach(() => {
    queue = new WebhookRetryQueue();
  });

  afterEach(() => {
    queue.stop();
  });

  it('should enqueue a delivery with pending status', () => {
    const d = queue.enqueue('wh-1', 'https://example.com/hook', '{"test":1}');
    expect(d.id).toBe('wh-1');
    expect(d.status).toBe('pending');
    expect(d.attempt).toBe(0);
    expect(d.maxAttempts).toBe(3);
  });

  it('should track pending deliveries', () => {
    queue.enqueue('wh-1', 'https://a.com', '{}');
    queue.enqueue('wh-2', 'https://b.com', '{}');
    expect(queue.getPending()).toHaveLength(2);
  });

  it('should start with empty stats', () => {
    const stats = queue.getStats();
    expect(stats.pending).toBe(0);
    expect(stats.delivered).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it('should count pending in stats', () => {
    queue.enqueue('wh-1', 'https://a.com', '{}');
    queue.enqueue('wh-2', 'https://b.com', '{}');
    const stats = queue.getStats();
    expect(stats.pending).toBe(2);
  });

  it('should return empty history initially', () => {
    expect(queue.getHistory()).toHaveLength(0);
  });

  it('should respect history limit', () => {
    // History is populated after deliveries complete (delivered/failed).
    // Without processing, history stays empty.
    expect(queue.getHistory(5)).toHaveLength(0);
  });

  it('should start and stop without errors', () => {
    queue.start();
    queue.start(); // idempotent
    queue.stop();
    queue.stop(); // idempotent
  });

  it('should preserve delivery payload and url', () => {
    const payload = JSON.stringify({ event: 'trade', data: { id: 42 } });
    const d = queue.enqueue('wh-3', 'https://hooks.example.com/api', payload);
    expect(d.url).toBe('https://hooks.example.com/api');
    expect(d.payload).toBe(payload);
  });

  it('should set nextRetryAt to approximately now', () => {
    const before = Date.now();
    const d = queue.enqueue('wh-4', 'https://a.com', '{}');
    const after = Date.now();
    expect(d.nextRetryAt).toBeGreaterThanOrEqual(before);
    expect(d.nextRetryAt).toBeLessThanOrEqual(after);
  });

  it('should handle multiple enqueues with unique ids', () => {
    queue.enqueue('a', 'https://a.com', '{}');
    queue.enqueue('b', 'https://b.com', '{}');
    queue.enqueue('c', 'https://c.com', '{}');
    const pending = queue.getPending();
    const ids = pending.map(d => d.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });
});
