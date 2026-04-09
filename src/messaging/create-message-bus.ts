/**
 * Message Bus Factory
 * Creates NATS or Redis message bus based on configuration
 *
 * Priority: NATS if NATS_URL is set, otherwise Redis fallback
 */

import type { IMessageBus } from './message-bus-interface';
import { NatsMessageBus } from './nats-message-bus';
import { RedisMessageBus } from './redis-message-bus';
import { logger } from '../utils/logger';

let messageBusInstance: IMessageBus | null = null;

/**
 * Create and connect the message bus
 * Uses NATS if NATS_URL env var is set, Redis otherwise
 */
export async function createMessageBus(): Promise<IMessageBus> {
  if (messageBusInstance?.isConnected()) return messageBusInstance;

  const natsUrl = process.env.NATS_URL;

  if (natsUrl) {
    logger.info(`[MessageBus] Using NATS transport: ${natsUrl}`);
    messageBusInstance = new NatsMessageBus({ url: natsUrl });
  } else {
    logger.info('[MessageBus] NATS_URL not set — using Redis pub/sub fallback');
    messageBusInstance = new RedisMessageBus();
  }

  await messageBusInstance.connect();
  return messageBusInstance;
}

/**
 * Get the active message bus instance
 * Throws if not yet created via createMessageBus()
 */
export function getMessageBus(): IMessageBus {
  if (!messageBusInstance) {
    throw new Error('[MessageBus] Not initialized. Call createMessageBus() first.');
  }
  return messageBusInstance;
}

/** Shutdown message bus */
export async function closeMessageBus(): Promise<void> {
  if (messageBusInstance) {
    await messageBusInstance.close();
    messageBusInstance = null;
  }
}
