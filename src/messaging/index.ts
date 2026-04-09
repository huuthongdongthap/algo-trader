/**
 * Messaging Module — barrel export
 * Event-driven message bus (NATS primary, Redis fallback)
 */

// Interface
export type { IMessageBus, MessageEnvelope, MessageHandler } from './message-bus-interface';

// Factory
export { createMessageBus, getMessageBus, closeMessageBus } from './create-message-bus';

// NATS specifics (for advanced usage)
export { connectNats, closeNats, isNatsConnected, getNatsConnection } from './nats-connection-manager';
export { NatsMessageBus } from './nats-message-bus';
export { RedisMessageBus } from './redis-message-bus';

// JetStream (persistent streaming)
export { initializeJetStreams, getJetStreamClient, createReplayConsumer } from './jetstream-manager';

// Topic schema
export { Topics, marketTopic } from './topic-schema';
export type { TopicName } from './topic-schema';
