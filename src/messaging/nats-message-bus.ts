/**
 * NATS Message Bus Implementation
 * Implements IMessageBus using NATS as the transport
 */

import { NatsConnection, Subscription, StringCodec } from 'nats';
import { connectNats, closeNats, isNatsConnected, type NatsConfig } from './nats-connection-manager';
import type { IMessageBus, MessageEnvelope, MessageHandler } from './message-bus-interface';
import { logger } from '../utils/logger';

const sc = StringCodec();

export class NatsMessageBus implements IMessageBus {
  private nc: NatsConnection | null = null;
  private subscriptions: Subscription[] = [];
  private config?: Partial<NatsConfig>;

  constructor(config?: Partial<NatsConfig>) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.nc = await connectNats(this.config);
  }

  async publish<T>(topic: string, data: T, source = 'algo-trader'): Promise<void> {
    if (!this.nc) throw new Error('[NATS] Not connected');

    const envelope: MessageEnvelope<T> = {
      topic,
      data,
      timestamp: Date.now(),
      source,
    };

    this.nc.publish(topic, sc.encode(JSON.stringify(envelope)));
  }

  async subscribe<T>(topic: string, handler: MessageHandler<T>): Promise<() => void> {
    if (!this.nc) throw new Error('[NATS] Not connected');

    const sub = this.nc.subscribe(topic);
    this.subscriptions.push(sub);

    // Process messages in background
    (async () => {
      for await (const msg of sub) {
        try {
          const envelope = JSON.parse(sc.decode(msg.data)) as MessageEnvelope<T>;
          await handler(envelope);
        } catch (error) {
          logger.error(`[NATS] Handler error on ${topic}: ${(error as Error).message}`);
        }
      }
    })().catch(() => {
      // Subscription closed
    });

    return () => {
      sub.unsubscribe();
    };
  }

  async request<TReq, TRes>(topic: string, data: TReq, timeoutMs = 5000): Promise<TRes> {
    if (!this.nc) throw new Error('[NATS] Not connected');

    const envelope: MessageEnvelope<TReq> = {
      topic,
      data,
      timestamp: Date.now(),
      source: 'algo-trader',
    };

    const response = await this.nc.request(topic, sc.encode(JSON.stringify(envelope)), {
      timeout: timeoutMs,
    });

    const parsed = JSON.parse(sc.decode(response.data)) as MessageEnvelope<TRes>;
    return parsed.data;
  }

  isConnected(): boolean {
    return isNatsConnected();
  }

  async close(): Promise<void> {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    await closeNats();
    this.nc = null;
  }
}
