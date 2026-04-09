/**
 * NATS Strategy Bridge
 * Connects NATS message bus to the strategy engine via callback registry.
 *
 * Strategies register callbacks here; the bridge routes NATS messages to them.
 * Strategies can also publish signals back onto the bus via publishSignal().
 */

import type { IMessageBus, MessageEnvelope } from '../messaging/index.js';
import { Topics } from '../messaging/index.js';
import { logger } from '../utils/logger.js';

// --- Callback types ---

export interface MarketUpdateData {
  marketId: string;
  price?: number;
  volume?: number;
  [key: string]: unknown;
}

export interface SignalDetectedData {
  signalType: string;
  marketId?: string;
  confidence?: number;
  [key: string]: unknown;
}

export interface DependencyUpdateData {
  nodes: string[];
  edges: Array<{ from: string; to: string; weight: number }>;
  [key: string]: unknown;
}

export interface StrategyCallbacks {
  onMarketUpdate?: (data: MarketUpdateData, topic: string) => void | Promise<void>;
  onSignalDetected?: (data: SignalDetectedData, topic: string) => void | Promise<void>;
  onDependencyUpdate?: (data: DependencyUpdateData) => void | Promise<void>;
}

// --- Bridge ---

export class NatsStrategyBridge {
  private bus: IMessageBus;
  private strategies = new Map<string, StrategyCallbacks>();
  private unsubscribers: Array<() => void> = [];
  private subscribed = false;

  constructor(bus: IMessageBus) {
    this.bus = bus;
  }

  /**
   * Register a strategy to receive NATS-dispatched events.
   * Safe to call before subscribeAll() — callbacks fire once subscriptions are live.
   */
  registerStrategy(name: string, callbacks: StrategyCallbacks): void {
    this.strategies.set(name, callbacks);
    logger.info(`[NatsBridge] Strategy registered: ${name}`);
  }

  /** Remove a strategy from the dispatch table */
  unregisterStrategy(name: string): void {
    this.strategies.delete(name);
    logger.info(`[NatsBridge] Strategy unregistered: ${name}`);
  }

  /**
   * Subscribe to all relevant NATS topics and start routing.
   * Idempotent — safe to call multiple times.
   */
  async subscribeAll(): Promise<void> {
    if (this.subscribed) return;
    this.subscribed = true;

    const [unsub1, unsub2, unsub3] = await Promise.all([
      this.bus.subscribe<MarketUpdateData>(Topics.MARKET_UPDATE, (env) =>
        this.dispatchMarketUpdate(env),
      ),
      this.bus.subscribe<SignalDetectedData>('signal.*.detected', (env) =>
        this.dispatchSignalDetected(env),
      ),
      this.bus.subscribe<DependencyUpdateData>(Topics.INTELLIGENCE_DEPENDENCIES, (env) =>
        this.dispatchDependencyUpdate(env),
      ),
    ]);

    this.unsubscribers.push(unsub1, unsub2, unsub3);
    logger.info('[NatsBridge] Subscribed to market/signal/intelligence topics');
  }

  /**
   * Publish a signal to a NATS topic.
   * Strategies call this to emit trade decisions back onto the bus.
   */
  async publishSignal(topic: string, data: unknown): Promise<void> {
    try {
      await this.bus.publish(topic, data, 'strategy-bridge');
    } catch (err) {
      logger.error('[NatsBridge] Failed to publish signal', { topic, err });
    }
  }

  /** Stop all subscriptions */
  async unsubscribeAll(): Promise<void> {
    this.unsubscribers.forEach((fn) => fn());
    this.unsubscribers = [];
    this.subscribed = false;
    logger.info('[NatsBridge] All subscriptions removed');
  }

  // --- Dispatch helpers ---

  private async dispatchMarketUpdate(env: MessageEnvelope<MarketUpdateData>): Promise<void> {
    for (const [name, cbs] of this.strategies) {
      if (!cbs.onMarketUpdate) continue;
      try {
        await cbs.onMarketUpdate(env.data, env.topic);
      } catch (err) {
        logger.error(`[NatsBridge] onMarketUpdate error in strategy ${name}`, { err });
      }
    }
  }

  private async dispatchSignalDetected(env: MessageEnvelope<SignalDetectedData>): Promise<void> {
    for (const [name, cbs] of this.strategies) {
      if (!cbs.onSignalDetected) continue;
      try {
        await cbs.onSignalDetected(env.data, env.topic);
      } catch (err) {
        logger.error(`[NatsBridge] onSignalDetected error in strategy ${name}`, { err });
      }
    }
  }

  private async dispatchDependencyUpdate(env: MessageEnvelope<DependencyUpdateData>): Promise<void> {
    for (const [name, cbs] of this.strategies) {
      if (!cbs.onDependencyUpdate) continue;
      try {
        await cbs.onDependencyUpdate(env.data);
      } catch (err) {
        logger.error(`[NatsBridge] onDependencyUpdate error in strategy ${name}`, { err });
      }
    }
  }
}
