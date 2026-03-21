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
import { startNotifications, stopNotifications } from './wiring/notifications-wiring.js';
import { wireStrategies } from './wiring/strategy-wiring.js';
import { wireWsEvents } from './wiring/ws-event-wiring.js';
import { setOrchestrator } from './api/pipeline-routes.js';
import { setPortfolioTracker } from './api/portfolio-routes.js';
import { setSignalFeed } from './api/signal-routes.js';
import { PortfolioTracker } from './portfolio/portfolio-tracker.js';
import { MlSignalFeed } from './ml/ml-signal-feed.js';
import type { StrategyOrchestrator } from './strategies/strategy-orchestrator.js';
import type { TradeResult } from './core/types.js';
import type { WsEventWiring } from './wiring/ws-event-wiring.js';
import type { ServersBundle } from './wiring/servers-wiring.js';
import type { NotificationsBundle } from './wiring/notifications-wiring.js';
import { wireOpenClaw, type OpenClawBundle } from './wiring/openclaw-wiring.js';
import { setOpenClawDeps } from './api/routes.js';
import { setMetricsUserStore } from './api/metrics-route.js';
import { getMarketplaceService } from './marketplace/marketplace-service.js';
import { seedDemoStrategies } from './marketplace/seed-demo-strategies.js';
import { UserStore } from './users/user-store.js';

// ── Ports ──────────────────────────────────────────────────────────────────

const APP_VERSION    = '0.2.0';
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
let _notifications: NotificationsBundle | null = null;
let _orchestrator: StrategyOrchestrator | null = null;
let _wsWiring: WsEventWiring | null = null;
let _openClaw: OpenClawBundle | null = null;
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

    if (_orchestrator) { _orchestrator.stopAll(); _orchestrator = null; }
    if (_wsWiring) { _wsWiring.dispose(); _wsWiring = null; }
    if (_notifications) { stopNotifications(_notifications); _notifications = null; }
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

  // 5b. UserStore — shared across API server + dashboard for real analytics
  const userDbPath = process.env['USER_DB_PATH'] ?? 'data/users.db';
  const userStore = new UserStore(userDbPath);
  logger.info('UserStore initialised', 'App', { path: userDbPath });
  setMetricsUserStore(userStore);

  // 6. API server (port 3000) — auth middleware + rate limiter wired inside createServer
  const jwtSecret = process.env['JWT_SECRET'] ?? 'dev-secret-change-me';
  _apiServer = createServer({ port: API_PORT, engine: _engine, userStore, jwtSecret });
  logger.info('API server started', 'App', { port: API_PORT });

  // 7. Dashboard server (port 3001) — UserStore enables real revenue analytics
  _dashServer = createDashboardServer(DASHBOARD_PORT, new DashboardDataProvider(_engine), userStore);
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

  // 10. Strategy orchestrator — wire Polymarket arb + Grid/DCA strategies
  _orchestrator = wireStrategies({ eventBus });
  setOrchestrator(_orchestrator);
  logger.info('Strategy orchestrator wired', 'App', { strategies: _orchestrator.getStatus().length });

  // 11. WS event bridge — EventBus → WebSocket real-time streaming
  _wsWiring = wireWsEvents(eventBus, _supplementary.wsHandle);
  logger.info('WS event bridge active', 'App');

  // 12. Portfolio tracker — aggregate P&L across all strategies
  const portfolioTracker = new PortfolioTracker();
  setPortfolioTracker(portfolioTracker);
  eventBus.on('trade.executed', (payload: { trade: TradeResult }) => {
    portfolioTracker.addTrade(payload.trade);
  });
  logger.info('Portfolio tracker wired', 'App');

  // 13. ML signal feed — weighted scoring model for trading signals
  const mlFeed = new MlSignalFeed();
  setSignalFeed(mlFeed);
  logger.info('ML signal feed wired', 'App');

  // 14. OpenClaw AI subsystem — trade observer + AI router + decision logger
  _openClaw = wireOpenClaw(eventBus);
  setOpenClawDeps(_openClaw.deps);
  logger.info('OpenClaw AI subsystem ready', 'App', {
    gateway: _openClaw.deps.controller ? 'configured' : 'none',
  });

  // 15. Notifications: Telegram bot + trade alerts
  _notifications = startNotifications(eventBus, _engine);
  _notifier = _notifications.router;
  logger.info('Notification router initialised', 'App', { channels: _notifier.enabledChannels() });

  // 16. Scheduler + built-in jobs + OpenClaw auto-tuning
  _scheduler = new JobScheduler();
  startScheduler(_scheduler);
  if (_openClaw) {
    _scheduler.schedule('openclawAutoTune', 'every 1h', _openClaw.autoTuningHandler);
    logger.info('OpenClaw auto-tuning job registered (every 1h)', 'App');
  }

  // 17. Recovery manager
  _recovery = new RecoveryManager();
  startRecoveryManager(_recovery, AUTO_SAVE_MS, {
    strategies: config.strategies,
    getOpenPositions: () => db.getOpenPositions(),
  });

  // 18. Process signal handlers (SIGINT/SIGTERM/uncaughtException/unhandledRejection)
  wireProcessSignals({ eventBus, notifier: _notifier, stopApp });

  // 19. Seed demo data for marketplace (idempotent)
  try {
    const mktSvc = getMarketplaceService(config.dbPath);
    const seeded = seedDemoStrategies(mktSvc);
    if (seeded > 0) logger.info(`Seeded ${seeded} demo marketplace strategies`, 'App');
  } catch (err) {
    logger.warn('Demo seeding skipped', 'App', { error: String(err) });
  }

  // 21. Banner
  printBanner(config.env, Object.keys(config.exchanges).join(', ') || 'none');
  logger.info('Platform ready', 'App', { version: APP_VERSION });
}

// Auto-start when run directly
startApp().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
