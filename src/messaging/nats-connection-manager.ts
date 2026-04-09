/**
 * NATS Connection Manager
 * Handles connection lifecycle, auto-reconnect, and health monitoring
 */

import { connect, NatsConnection, StringCodec } from 'nats';
import { logger } from '../utils/logger';

export interface NatsConfig {
  url: string;
  name?: string;
  maxReconnectAttempts?: number;
  reconnectTimeWait?: number;
  token?: string;
}

const DEFAULT_CONFIG: NatsConfig = {
  url: process.env.NATS_URL || 'nats://localhost:4222',
  name: process.env.NATS_CLIENT_NAME || 'algo-trader',
  maxReconnectAttempts: -1,
  reconnectTimeWait: 2000,
  token: process.env.NATS_TOKEN,
};

let connection: NatsConnection | null = null;
let connectionConfig: NatsConfig = DEFAULT_CONFIG;

/**
 * Connect to NATS server
 * Returns existing connection if already connected
 */
export async function connectNats(config?: Partial<NatsConfig>): Promise<NatsConnection> {
  if (connection) return connection;

  connectionConfig = { ...DEFAULT_CONFIG, ...config };

  try {
    connection = await connect({
      servers: connectionConfig.url,
      name: connectionConfig.name,
      maxReconnectAttempts: connectionConfig.maxReconnectAttempts,
      reconnectTimeWait: connectionConfig.reconnectTimeWait,
      token: connectionConfig.token || undefined,
    });

    logger.info(`[NATS] Connected to ${connectionConfig.url}`);

    // Monitor connection events
    monitorConnection(connection);

    return connection;
  } catch (error) {
    logger.error(`[NATS] Connection failed: ${(error as Error).message}`);
    throw error;
  }
}

/**
 * Get existing NATS connection
 * Throws if not connected
 */
export function getNatsConnection(): NatsConnection {
  if (!connection) {
    throw new Error('[NATS] Not connected. Call connectNats() first.');
  }
  return connection;
}

/** Check if NATS is connected */
export function isNatsConnected(): boolean {
  return connection !== null && !connection.isClosed();
}

/** Get the shared StringCodec instance */
export function getCodec(): ReturnType<typeof StringCodec> {
  return StringCodec();
}

/** Graceful shutdown */
export async function closeNats(): Promise<void> {
  if (connection) {
    await connection.drain();
    connection = null;
    logger.info('[NATS] Connection closed');
  }
}

/** Monitor connection lifecycle events */
function monitorConnection(nc: NatsConnection): void {
  (async () => {
    for await (const status of nc.status()) {
      switch (status.type) {
        case 'reconnecting':
          logger.warn(`[NATS] Reconnecting...`);
          break;
        case 'reconnect':
          logger.info(`[NATS] Reconnected to ${status.data}`);
          break;
        case 'disconnect':
          logger.warn(`[NATS] Disconnected`);
          break;
        case 'error':
          logger.error(`[NATS] Error: ${String(status.data)}`);
          break;
      }
    }
  })().catch(() => {
    // Status iterator closed — connection is shutting down
  });
}
