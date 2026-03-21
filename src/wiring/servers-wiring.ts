// Servers wiring layer — initialises trading pipeline, landing page, and WebSocket server
// Pure orchestration: creates instances, starts them, returns shutdown hooks.
import type { Server } from 'node:http';
import { TradingPipeline } from '../polymarket/trading-pipeline.js';
import { createLandingServer, stopLandingServer } from '../landing/landing-server.js';
import { createWsServer } from '../ws/ws-server.js';
import type { WsServerHandle } from '../ws/ws-server.js';
import { logger } from '../core/logger.js';
import type { PipelineConfig } from '../polymarket/trading-pipeline.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ServersBundle {
  pipeline: TradingPipeline;
  landingServer: Server;
  wsHandle: WsServerHandle;
}

export interface ServersShutdownHandles {
  pipeline: TradingPipeline;
  landingServer: Server;
  wsHandle: WsServerHandle;
}

// ---------------------------------------------------------------------------
// Trading pipeline
// ---------------------------------------------------------------------------

/**
 * Initialise TradingPipeline in paper mode (safe default).
 * Does NOT start the pipeline — call pipeline.start() when ready.
 */
export function createTradingPipeline(overrides: PipelineConfig = {}): TradingPipeline {
  const config: PipelineConfig = {
    paperTrading: true, // safe default — override via LIVE_TRADING=true env
    ...overrides,
  };

  // Honour env-level opt-in to live trading
  if (process.env['LIVE_TRADING'] === 'true') {
    config.paperTrading = false;
    config.privateKey = process.env['POLYMARKET_PRIVATE_KEY'] ?? config.privateKey;
  }

  if (process.env['DB_PATH']) {
    config.dbPath = process.env['DB_PATH'];
  }

  const pipeline = new TradingPipeline(config);

  pipeline.on('started', ({ mode }: { mode: string }) => {
    logger.info(`Trading pipeline started in ${mode} mode`, 'ServersWiring');
  });

  pipeline.on('error', (err: unknown) => {
    logger.error('Trading pipeline error', 'ServersWiring', { err: String(err) });
  });

  pipeline.on('stream_disconnected', () => {
    logger.warn('Orderbook stream disconnected — pipeline may have degraded feed', 'ServersWiring');
  });

  return pipeline;
}

// ---------------------------------------------------------------------------
// Landing page server
// ---------------------------------------------------------------------------

/**
 * Start the landing page HTTP server on the given port (default 3002).
 */
export function startLandingServer(port: number): Server {
  const server = createLandingServer(port);
  logger.info('Landing page server started', 'ServersWiring', { port });
  return server;
}

// ---------------------------------------------------------------------------
// WebSocket server (attached to dashboard port)
// ---------------------------------------------------------------------------

/**
 * Start a WebSocket server on the given port (recommended: same as dashboard or 3003).
 * Returns a WsServerHandle for broadcasting and graceful shutdown.
 */
export function startWsServer(port: number): WsServerHandle {
  const handle = createWsServer(port);
  logger.info('WebSocket server started', 'ServersWiring', { port });
  return handle;
}

// ---------------------------------------------------------------------------
// Composite start — pipeline + landing + WS in one call
// ---------------------------------------------------------------------------

/**
 * Start all supplementary servers: trading pipeline (paper), landing page, WebSocket.
 * Returns handles needed for graceful shutdown.
 */
export async function startAllServers(
  landingPort: number,
  wsPort: number,
  pipelineConfig: PipelineConfig = {},
): Promise<ServersBundle> {
  const pipeline = createTradingPipeline(pipelineConfig);

  // Start pipeline in background — errors are logged but don't crash the app
  pipeline.start().catch((err: unknown) => {
    logger.error('Trading pipeline failed to start', 'ServersWiring', { err: String(err) });
  });

  const landingServer = startLandingServer(landingPort);
  const wsHandle = startWsServer(wsPort);

  return { pipeline, landingServer, wsHandle };
}

// ---------------------------------------------------------------------------
// Composite shutdown
// ---------------------------------------------------------------------------

/**
 * Gracefully shut down pipeline + landing + WS servers.
 */
export async function stopAllServers(bundle: ServersShutdownHandles): Promise<void> {
  await Promise.allSettled([
    bundle.pipeline.stop(),
    stopLandingServer(bundle.landingServer),
    bundle.wsHandle.shutdown(),
  ]);
  logger.info('All supplementary servers stopped', 'ServersWiring');
}
