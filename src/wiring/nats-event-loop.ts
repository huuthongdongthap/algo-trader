/**
 * NATS Event Loop — Startup initializer for event-driven strategy routing.
 *
 * Connects the message bus, subscribes to core topics, and wires the
 * NatsStrategyBridge into the runtime. Falls back to no-op when NATS_URL
 * (or REDIS_URL) is not configured so the tick-based engine still works.
 *
 * Usage:
 *   const loop = await startNatsEventLoop();
 *   loop.bridge.registerStrategy('my-strat', callbacks);
 *   // on shutdown:
 *   await loop.stop();
 */

import { createMessageBus, closeMessageBus } from '../messaging/index.js';
import { NatsStrategyBridge } from './nats-strategy-bridge.js';
import { logger } from '../utils/logger.js';

export interface NatsEventLoop {
  bridge: NatsStrategyBridge;
  isConnected: () => boolean;
  stop: () => Promise<void>;
}

/** No-op loop returned when messaging is not configured */
function makeNoopLoop(): NatsEventLoop {
  const noop = new NatsStrategyBridge({
    connect: async () => {},
    publish: async () => {},
    subscribe: async () => () => {},
    request: async () => { throw new Error('noop'); },
    isConnected: () => false,
    close: async () => {},
  });

  return {
    bridge: noop,
    isConnected: () => false,
    stop: async () => {},
  };
}

/**
 * Initialize NATS event loop.
 * - If NATS_URL is not set and REDIS_URL is not set, returns no-op loop.
 * - Registers SIGTERM/SIGINT handlers for graceful shutdown once.
 */
export async function startNatsEventLoop(): Promise<NatsEventLoop> {
  const hasTransport = !!(process.env.NATS_URL || process.env.REDIS_URL);

  if (!hasTransport) {
    logger.info('[NatsEventLoop] No NATS_URL/REDIS_URL — event-driven bridge disabled, using tick-based fallback');
    return makeNoopLoop();
  }

  let bus;
  try {
    bus = await createMessageBus();
  } catch (err) {
    logger.warn('[NatsEventLoop] Message bus connection failed — falling back to tick-based polling', { err });
    return makeNoopLoop();
  }

  const bridge = new NatsStrategyBridge(bus);
  await bridge.subscribeAll();

  logger.info('[NatsEventLoop] Event-driven strategy loop active');

  const stop = async (): Promise<void> => {
    logger.info('[NatsEventLoop] Shutting down...');
    await bridge.unsubscribeAll();
    await closeMessageBus();
    logger.info('[NatsEventLoop] Shutdown complete');
  };

  // Register process signal handlers exactly once
  registerShutdownHandlers(stop);

  return {
    bridge,
    isConnected: () => bus.isConnected(),
    stop,
  };
}

// Tracks whether signal handlers were already registered to avoid duplicates
let signalHandlersRegistered = false;

function registerShutdownHandlers(stop: () => Promise<void>): void {
  if (signalHandlersRegistered) return;
  signalHandlersRegistered = true;

  const handler = (signal: string) => async () => {
    logger.info(`[NatsEventLoop] Received ${signal} — initiating graceful shutdown`);
    try {
      await stop();
    } catch (err) {
      logger.error('[NatsEventLoop] Error during shutdown', { err });
    } finally {
      // Reset flag so tests / re-init can re-register
      signalHandlersRegistered = false;
      process.exit(0);
    }
  };

  process.once('SIGTERM', handler('SIGTERM'));
  process.once('SIGINT', handler('SIGINT'));
}
