/**
 * JetStream Manager
 * Persistent message streaming with replay capability for backtesting
 *
 * Streams:
 * - TRADES: all order events (30-day retention)
 * - SIGNALS: all signal detections (7-day retention)
 * - MARKET_DATA: market updates (24h retention, high volume)
 */

import { JetStreamClient, RetentionPolicy, StorageType, AckPolicy, DeliverPolicy } from 'nats';
import type { JetStreamManager } from 'nats';
import { getNatsConnection } from './nats-connection-manager';
import { logger } from '../utils/logger';

export interface StreamConfig {
  name: string;
  subjects: string[];
  maxAge: number; // nanoseconds
  maxBytes?: number;
  storage?: 'file' | 'memory';
}

const STREAM_CONFIGS: StreamConfig[] = [
  {
    name: 'TRADES',
    subjects: ['order.>'],
    maxAge: 30 * 24 * 60 * 60 * 1e9, // 30 days
    storage: 'file',
  },
  {
    name: 'SIGNALS',
    subjects: ['signal.>'],
    maxAge: 7 * 24 * 60 * 60 * 1e9, // 7 days
    storage: 'file',
  },
  {
    name: 'MARKET_DATA',
    subjects: ['market.>'],
    maxAge: 24 * 60 * 60 * 1e9, // 24 hours
    maxBytes: 1024 * 1024 * 512, // 512MB cap
    storage: 'memory',
  },
];

/**
 * Initialize JetStream streams
 * Creates or updates stream configurations
 */
export async function initializeJetStreams(): Promise<void> {
  const nc = getNatsConnection();
  const jsm = await nc.jetstreamManager();

  for (const config of STREAM_CONFIGS) {
    await ensureStream(jsm, config);
  }

  logger.info(`[JetStream] Initialized ${STREAM_CONFIGS.length} streams`);
}

/** Get JetStream client for publishing/consuming */
export function getJetStreamClient(): JetStreamClient {
  const nc = getNatsConnection();
  return nc.jetstream();
}

/** Create a durable consumer for replaying messages */
export async function createReplayConsumer(
  streamName: string,
  consumerName: string,
  startTime?: Date
): Promise<void> {
  const nc = getNatsConnection();
  const jsm = await nc.jetstreamManager();

  await jsm.consumers.add(streamName, {
    durable_name: consumerName,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: startTime ? DeliverPolicy.StartTime : DeliverPolicy.All,
    opt_start_time: startTime?.toISOString(),
  });

  logger.info(`[JetStream] Consumer ${consumerName} created on ${streamName}`);
}

async function ensureStream(jsm: JetStreamManager, config: StreamConfig): Promise<void> {
  const storageType = config.storage === 'memory' ? StorageType.Memory : StorageType.File;

  const streamDef = {
    name: config.name,
    subjects: config.subjects,
    retention: RetentionPolicy.Limits,
    max_age: config.maxAge,
    max_bytes: config.maxBytes || -1,
    storage: storageType,
  };

  try {
    await jsm.streams.info(config.name);
    // Stream exists — update mutable fields only
    await jsm.streams.update(config.name, {
      subjects: config.subjects,
      max_age: config.maxAge,
      max_bytes: config.maxBytes || -1,
    });
    logger.info(`[JetStream] Updated stream: ${config.name}`);
  } catch {
    // Stream doesn't exist — create with full config
    try {
      await jsm.streams.add(streamDef);
      logger.info(`[JetStream] Created stream: ${config.name}`);
    } catch (createErr) {
      logger.error(`[JetStream] Failed to create stream ${config.name}: ${(createErr as Error).message}`);
    }
  }
}
