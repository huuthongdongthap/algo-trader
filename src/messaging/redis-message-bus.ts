/**
 * Redis Message Bus Implementation
 * Fallback IMessageBus using Redis pub/sub when NATS is unavailable
 */

import Redis from 'ioredis';
import type { IMessageBus, MessageEnvelope, MessageHandler } from './message-bus-interface';
import { logger } from '../utils/logger';

export class RedisMessageBus implements IMessageBus {
  private pub: Redis | null = null;
  private sub: Redis | null = null;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private redisUrl: string;

  constructor(redisUrl?: string) {
    this.redisUrl = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
  }

  async connect(): Promise<void> {
    this.pub = new Redis(this.redisUrl);
    this.sub = new Redis(this.redisUrl);

    this.sub.on('message', (channel: string, message: string) => {
      const topicHandlers = this.handlers.get(channel);
      if (!topicHandlers) return;

      try {
        const envelope = JSON.parse(message) as MessageEnvelope;
        topicHandlers.forEach((handler) => {
          Promise.resolve(handler(envelope)).catch((err) => {
            logger.error(`[Redis PubSub] Handler error on ${channel}: ${(err as Error).message}`);
          });
        });
      } catch (error) {
        logger.error(`[Redis PubSub] Parse error on ${channel}: ${(error as Error).message}`);
      }
    });

    logger.info('[Redis PubSub] Connected as message bus fallback');
  }

  async publish<T>(topic: string, data: T, source = 'algo-trader'): Promise<void> {
    if (!this.pub) throw new Error('[Redis PubSub] Not connected');

    const envelope: MessageEnvelope<T> = {
      topic,
      data,
      timestamp: Date.now(),
      source,
    };

    await this.pub.publish(topic, JSON.stringify(envelope));
  }

  async subscribe<T>(topic: string, handler: MessageHandler<T>): Promise<() => void> {
    if (!this.sub) throw new Error('[Redis PubSub] Not connected');

    if (!this.handlers.has(topic)) {
      this.handlers.set(topic, new Set());
      await this.sub.subscribe(topic);
    }

    this.handlers.get(topic)!.add(handler as MessageHandler);

    return () => {
      const topicHandlers = this.handlers.get(topic);
      if (topicHandlers) {
        topicHandlers.delete(handler as MessageHandler);
        if (topicHandlers.size === 0) {
          this.handlers.delete(topic);
          this.sub?.unsubscribe(topic);
        }
      }
    };
  }

  async request<TReq, TRes>(_topic: string, _data: TReq, _timeoutMs = 5000): Promise<TRes> {
    throw new Error('[Redis PubSub] Request-reply not supported. Use NATS for this pattern.');
  }

  isConnected(): boolean {
    return this.pub !== null && this.pub.status === 'ready';
  }

  async close(): Promise<void> {
    this.handlers.clear();
    if (this.sub) {
      this.sub.disconnect();
      this.sub = null;
    }
    if (this.pub) {
      this.pub.disconnect();
      this.pub = null;
    }
    logger.info('[Redis PubSub] Disconnected');
  }
}
