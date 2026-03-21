// Main application bootstrap — wires all modules together for algo-trade RaaS platform
// Initialization order: config → logger → event bus → database → risk → engine → servers → scheduler → recovery
import type { Server } from 'node:http';
import { loadConfig, validateConfig } from './core/config.js';
import { logger } from './core/logger.js';
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
import { RecoveryManager } from './resilience/recovery-manager.js';
import { startAllServers, stopAllServers } from './wiring/servers-wiring.js';
import { startRecoveryManager, startScheduler, wireProcessSignals } from './wiring/process-wiring.js';
import type { ServersBundle } from './wiring/servers-wiring.js';

// ── Ports ──────────────────────────────────────────────────────────────────

const APP_VERSION    = '0.1.0';
const API_PORT       = Number(process.env['API_PORT'])       || 3000;
const DASHBOARD_PORT = Number(process.env['DASHBOARD_PORT']) || 3001;
const LANDING_PORT   = Number(process.env['LANDING_PORT'])   || 3002;
const WS_PORT        = Number(process.env['WS_PORT'])        || 3003;
const WEBHOOK_PORT   = Number(process.env['WEBHOOK_PORT'])   || 3004;
const AUTO_SAVE_MS   = 5 * 60 * 1000;

// ── Module-level state ─────────────────────────────────────────────────────

let _engine: TradingEngine | null = null;
let _apiServer: Server | null = null;
let _dashServer: Server | null = null;
let _webhookServer: Server | null = null;
let _supplementary: ServersBundle | null = null;
let _scheduler: JobScheduler | null = null;
let _recovery: RecoveryManager | null = null;
let _notifier: NotificationRouter | null = null;
let _stopping = false;

// ── Banner ─────────────────────────────────────────────────────────────────

function printBanner(env: string, exchanges: string): void {
  const pad = (s: string) => s.slice(0, 30).padEnd(30);
  console.log([
    '╔══════════════════════════════════════════════╗',
    `║       algo-trade RaaS  v${APP_VERSION}              ║`,
    '╠══════════════════════════════════════════════╣',
    `║  API        → http://localhost:${API_PORT}          ║`,
    `║  Dashboard  → http://localhost:${DASHBOARD_PORT}          ║`,
    `║  Landing    → http://localhost:${LANDING_PORT}          ║`,
    `║  WebSocket  → ws://localhost:${WS_PORT}             ║`,
    `║  Webhook    → http://localhost:${WEBHOOK_PORT}          ║`,
    `║  Env        → ${pad(env)}║`,
    `║  Exchanges  → ${pad(exchanges)}║`,
    '╚══════════════════════════════════════════════╝',
  ].join('\n'));
}

// ── Graceful shutdown ──────────────────────────────────────────────────────

export async function stopApp(reason = 'manual'): Promise<void> {
  if (_stopping) return;
  _stopping = true;
  logger.info(`Shutting down (${reason})…`, 'App');
  try {
    if (_engine) { await _engine.shutdown(reason); _engine = null; }

    await Promise.allSettled([
      _apiServer     ? stopServer(_apiServer)            : Promise.resolve(),
      _dashServer    ? stopDashboardServer(_dashServer)  : Promise.resolve(),
      _webhookServer ? stopWebhookServer(_webhookServer) : Promise.resolve(),
      _supplementary ? stopAllServers(_supplementary)    : Promise.resolve(),
    ]);
    _apiServer = _dashServer = _webhookServer = _supplementary = null;

    if (_scheduler) { _scheduler.stop(); _scheduler = null; }
    if (_recovery)  { _recovery.stopAutoSave(); _recovery.clearState(); _recovery = null; }

    getDatabase().close();
    logger.info('Shutdown complete', 'App');
  } catch (err) {
    logger.error('Error during shutdown', 'App', { error: String(err) });
  }
}

// ── Startup ────────────────────────────────────────────────────────────────

export async function startApp(): Promise<void> {
  // 1. Config
  const config = loadConfig();
  const warnings = validateConfig(config);
  if (warnings.length > 0) logger.warn('Config warnings', 'App', { warnings });

  // 2. Logger
  logger.setLevel(config.logLevel);
  logger.info('Starting algo-trade platform', 'App', { version: APP_VERSION, env: config.env });

  // 3. Event bus + event logger
  const eventBus = getEventBus();
  new EventLogger().startLogging(eventBus, { logLevel: 'debug' });
  eventBus.emit('system.startup', { version: APP_VERSION, timestamp: Date.now() });

  // 4. Database
  const db = getDatabase(config.dbPath);
  logger.info('Database initialised', 'App', { path: config.dbPath });

  // 5. Trading engine
  _engine = new TradingEngine();
  logger.info('Trading engine initialised', 'App');

  // 6. API server (port 3000) — auth middleware + rate limiter wired inside createServer
  _apiServer = createServer(API_PORT, _engine);
  logger.info('API server started', 'App', { port: API_PORT });

  // 7. Dashboard server (port 3001)
  _dashServer = createDashboardServer(DASHBOARD_PORT, new DashboardDataProvider(_engine));
  logger.info('Dashboard server started', 'App', { port: DASHBOARD_PORT });

  // 8. Webhook server (port 3004)
  _webhookServer = createWebhookServer(WEBHOOK_PORT, async (signal) => {
    logger.info('Webhook signal received', 'App', { symbol: signal.symbol, side: signal.side });
    eventBus.emit('alert.triggered', {
      rule: 'webhook',
      message: `${signal.side} ${signal.symbol} @ ${signal.price ?? 'market'}`,
    });
  });
  logger.info('Webhook server started', 'App', { port: WEBHOOK_PORT });

  // 9. Supplementary servers: trading pipeline (paper mode default), landing page, WebSocket
  _supplementary = await startAllServers(LANDING_PORT, WS_PORT, {
    paperTrading: true,
    dbPath: config.dbPath,
  });
  logger.info('Supplementary servers started', 'App', {
    landing: LANDING_PORT, ws: WS_PORT,
    pipeline: _supplementary.pipeline.getStatus(),
  });

  // 10. Notification router
  _notifier = new NotificationRouter();
  logger.info('Notification router initialised', 'App', { channels: _notifier.enabledChannels() });

  // 11. Scheduler + built-in jobs
  _scheduler = new JobScheduler();
  startScheduler(_scheduler);

  // 12. Recovery manager
  _recovery = new RecoveryManager();
  startRecoveryManager(_recovery, AUTO_SAVE_MS, {
    strategies: config.strategies,
    getOpenPositions: () => db.getOpenPositions(),
  });

  // 13. Process signal handlers (SIGINT/SIGTERM/uncaughtException/unhandledRejection)
  wireProcessSignals({ eventBus, notifier: _notifier, stopApp });

  // 14. Banner
  printBanner(config.env, Object.keys(config.exchanges).join(', ') || 'none');
  logger.info('Platform ready', 'App', { version: APP_VERSION });
}

// Auto-start when run directly
startApp().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
