// Main application bootstrap — wires all modules together for algo-trade RaaS platform
// Initialization order: config → logger → event bus → database → risk → engine → servers → scheduler → recovery
import type { Server } from 'node:http';
import { loadConfig, validateConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { RiskManager } from './core/risk-manager.js';
import { getEventBus } from './events/event-bus.js';
import { EventLogger } from './events/event-logger.js';
import { getDatabase } from './data/database.js';
import { TradingEngine } from './engine/engine.js';
import { createServer, stopServer } from './api/server.js';
import { createDashboardServer, stopDashboardServer } from './dashboard/dashboard-server.js';
import { DashboardDataProvider } from './dashboard/dashboard-data.js';
import { createWebhookServer, stopWebhookServer } from './webhooks/webhook-server.js';
import { NotificationRouter } from './notifications/notification-router.js';
import { JobScheduler } from './scheduler/job-scheduler.js';
import { registerBuiltInJobs } from './scheduler/job-registry.js';
import { RecoveryManager } from './resilience/recovery-manager.js';

// ── Module-level state ─────────────────────────────────────────────────────

const APP_VERSION = '0.1.0';
const API_PORT = 3000;
const DASHBOARD_PORT = 3001;
const WEBHOOK_PORT = 3002;
const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _engine: TradingEngine | null = null;
let _apiServer: Server | null = null;
let _dashServer: Server | null = null;
let _webhookServer: Server | null = null;
let _scheduler: JobScheduler | null = null;
let _recovery: RecoveryManager | null = null;
let _notifier: NotificationRouter | null = null;
let _stopping = false;

// ── Banner ─────────────────────────────────────────────────────────────────

function printBanner(config: ReturnType<typeof loadConfig>): void {
  const enabledExchanges = Object.keys(config.exchanges).join(', ') || 'none';
  const lines = [
    '╔══════════════════════════════════════════════╗',
    `║       algo-trade RaaS  v${APP_VERSION}              ║`,
    '╠══════════════════════════════════════════════╣',
    `║  API        → http://localhost:${API_PORT}          ║`,
    `║  Dashboard  → http://localhost:${DASHBOARD_PORT}          ║`,
    `║  Webhook    → http://localhost:${WEBHOOK_PORT}          ║`,
    `║  Env        → ${config.env.padEnd(30)}║`,
    `║  Exchanges  → ${enabledExchanges.slice(0, 30).padEnd(30)}║`,
    '╚══════════════════════════════════════════════╝',
  ];
  for (const line of lines) console.log(line);
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

/** Gracefully stop all running services and save state before exit. */
export async function stopApp(reason = 'manual'): Promise<void> {
  if (_stopping) return;
  _stopping = true;

  logger.info(`Shutting down (${reason})…`, 'App');

  try {
    // 1. Stop trading engine first — no more orders
    if (_engine) {
      await _engine.shutdown(reason);
      _engine = null;
    }

    // 2. Stop HTTP servers in parallel
    await Promise.allSettled([
      _apiServer ? stopServer(_apiServer) : Promise.resolve(),
      _dashServer ? stopDashboardServer(_dashServer) : Promise.resolve(),
      _webhookServer ? stopWebhookServer(_webhookServer) : Promise.resolve(),
    ]);
    _apiServer = _dashServer = _webhookServer = null;

    // 3. Stop scheduler jobs
    if (_scheduler) {
      _scheduler.stop();
      _scheduler = null;
    }

    // 4. Save final recovery state + clear clean-shutdown marker
    if (_recovery) {
      _recovery.stopAutoSave();
      _recovery.clearState(); // clean exit — skip recovery on next start
      _recovery = null;
    }

    // 5. Close database
    getDatabase().close();

    logger.info('Shutdown complete', 'App');
  } catch (err) {
    logger.error('Error during shutdown', 'App', { error: String(err) });
  }
}

// ── Startup ────────────────────────────────────────────────────────────────

/** Boot the entire application. Returns once all services are ready. */
export async function startApp(): Promise<void> {
  // ── 1. Config ────────────────────────────────────────────────────────────
  const config = loadConfig();
  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    logger.warn('Config warnings detected', 'App', { warnings: configErrors });
  }

  // ── 2. Logger ────────────────────────────────────────────────────────────
  logger.setLevel(config.logLevel);
  logger.info('Starting algo-trade platform', 'App', { version: APP_VERSION, env: config.env });

  // ── 3. Event bus + event logger ──────────────────────────────────────────
  const eventBus = getEventBus();
  const eventLogger = new EventLogger();
  eventLogger.startLogging(eventBus, { logLevel: 'debug' });

  eventBus.emit('system.startup', { version: APP_VERSION, timestamp: Date.now() });

  // ── 4. Database ──────────────────────────────────────────────────────────
  const db = getDatabase(config.dbPath);
  logger.info('Database initialised', 'App', { path: config.dbPath });

  // ── 5. Risk manager ──────────────────────────────────────────────────────
  const riskManager = new RiskManager(config.riskLimits);
  logger.info('Risk manager initialised', 'App', {
    maxDrawdown: config.riskLimits.maxDrawdown,
    maxPositions: config.riskLimits.maxOpenPositions,
  });

  // ── 6. Trading engine ────────────────────────────────────────────────────
  _engine = new TradingEngine();
  logger.info('Trading engine initialised', 'App');

  // ── 7. API server (port 3000) ────────────────────────────────────────────
  _apiServer = createServer(API_PORT, _engine);
  logger.info('API server started', 'App', { port: API_PORT });

  // ── 8. Dashboard server (port 3001) ──────────────────────────────────────
  // portfolio tracker is optional — pass undefined to use engine-only metrics
  const dashboardData = new DashboardDataProvider(_engine);
  _dashServer = createDashboardServer(DASHBOARD_PORT, dashboardData);
  logger.info('Dashboard server started', 'App', { port: DASHBOARD_PORT });

  // ── 9. Webhook server (port 3002) ────────────────────────────────────────
  _webhookServer = createWebhookServer(WEBHOOK_PORT, async (signal) => {
    logger.info('Webhook signal received', 'App', {
      symbol: signal.symbol,
      side: signal.side,
      source: signal.source,
    });
    // Route signal to engine via event bus
    eventBus.emit('alert.triggered', {
      rule: 'webhook',
      message: `${signal.side} ${signal.symbol} @ ${signal.price ?? 'market'}`,
    });
  });
  logger.info('Webhook server started', 'App', { port: WEBHOOK_PORT });

  // ── 10. Notification router ──────────────────────────────────────────────
  _notifier = new NotificationRouter();
  // Channels are registered by env-driven setup; router starts empty but wired
  logger.info('Notification router initialised', 'App', {
    channels: _notifier.enabledChannels(),
  });

  // ── 11. Scheduler + built-in jobs ────────────────────────────────────────
  _scheduler = new JobScheduler();
  registerBuiltInJobs(_scheduler);
  logger.info('Scheduler started with built-in jobs', 'App');

  // ── 12. Recovery manager ─────────────────────────────────────────────────
  _recovery = new RecoveryManager();

  if (_recovery.shouldRecover()) {
    const state = _recovery.loadState();
    if (state) {
      logger.info('Recovering from previous crash', 'App', {
        strategies: state.strategies.length,
        positions: state.positions.length,
        lastEquity: state.lastEquity,
      });
    }
  }

  // Start periodic auto-save of recovery state
  _recovery.startAutoSave(AUTO_SAVE_INTERVAL_MS, () => ({
    strategies: config.strategies,
    positions: db.getOpenPositions().map((p) => ({
      marketId: p.market,
      side: p.side as 'long' | 'short',
      entryPrice: p.entry_price,
      size: p.size,
      unrealizedPnl: p.unrealized_pnl,
      openedAt: p.opened_at,
    })),
    lastEquity: '0', // placeholder — real impl fetches from portfolio tracker
    timestamp: Date.now(),
  }));

  logger.info('Recovery manager started', 'App');

  // ── Signal handlers ───────────────────────────────────────────────────────
  const onSignal = async (signal: string) => {
    logger.info(`Received ${signal}`, 'App');
    eventBus.emit('system.shutdown', { reason: signal });
    await stopApp(signal);
    process.exit(0);
  };

  process.once('SIGINT', () => { void onSignal('SIGINT'); });
  process.once('SIGTERM', () => { void onSignal('SIGTERM'); });

  // ── Uncaught exception safety net ────────────────────────────────────────
  process.on('uncaughtException', async (err) => {
    logger.error('Uncaught exception — initiating emergency shutdown', 'App', {
      error: err.message,
      stack: err.stack,
    });
    try {
      await _notifier?.send(`[CRITICAL] Uncaught exception: ${err.message}`);
    } catch { /* notification failure must not block shutdown */ }
    await stopApp('uncaughtException');
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error('Unhandled promise rejection', 'App', { reason: message });
    try {
      await _notifier?.send(`[ERROR] Unhandled rejection: ${message}`);
    } catch { /* ignore notification errors */ }
  });

  // ── Banner ────────────────────────────────────────────────────────────────
  printBanner(config);
  logger.info('Platform ready', 'App', { version: APP_VERSION });
}

// Auto-start when run directly
startApp().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
