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
import { createDashboardServer, stopDashboardServer, type DashboardDeps } from './dashboard/dashboard-server.js';
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
import { LeaderBoard } from './copy-trading/leader-board.js';
import { seedDemoLeaders } from './copy-trading/seed-demo-leaders.js';
import { setAnalyticsEngine } from './api/analytics-routes.js';
import { AlertHistory } from './notifications/alert-history.js';
import { setAlertHistory } from './api/alert-history-routes.js';
import { setExportDeps } from './api/routes.js';
import { getAuditLogger } from './audit/audit-logger.js';
import { getAuditStore } from './audit/audit-store.js';
import { setSystemHealthDeps } from './api/system-health-routes.js';
import { UserWebhookRegistry } from './webhooks/user-webhook-registry.js';
import { setUserWebhookRegistry } from './api/user-webhook-routes.js';
import { UsageTracker } from './metering/usage-tracker.js';
import { setUsageTracker } from './api/usage-routes.js';
import { PluginRegistry } from './plugins/plugin-registry.js';
import { setPluginRegistry } from './api/plugin-routes.js';
import { InstanceManager } from './scaling/instance-manager.js';
import { setInstanceManager } from './api/scaling-routes.js';
import { setPnlSnapshotProvider } from './api/pnl-snapshot-routes.js';
import { savePnlSnapshot, type PnlSnapshot } from './portfolio/pnl-snapshot-store.js';
import { ExchangeClient } from './cex/exchange-client.js';
import { setExchangeClient } from './api/exchange-routes.js';
import { SwapRouter } from './dex/swap-router.js';
import { setSwapRouter } from './api/dex-routes.js';
import { createKalshiClient } from './kalshi/index.js';
import { setKalshiDeps } from './api/kalshi-routes.js';
import { TradingRoom } from './trading-room/room-wiring.js';
import { setTradingRoomOrchestrator } from './api/trading-room-routes.js';
import { TradingCircuitBreakers } from './core/trading-circuit-breakers.js';

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
let _userWebhookRegistry: UserWebhookRegistry | null = null;
let _usageTracker: UsageTracker | null = null;
let _stopping = false;

// ── Banner ─────────────────────────────────────────────────────────────────

function printBanner(env: string, exchanges: string): void {
  const pad = (s: string) => s.slice(0, 30).padEnd(30);
  logger.info([
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
  ].join('\n'), 'App');
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
    if (_userWebhookRegistry) { _userWebhookRegistry.stop(); _userWebhookRegistry = null; }
    if (_usageTracker) { _usageTracker.destroy(); _usageTracker = null; }
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

  // 5.1 Trading circuit breakers — unified 5-breaker safety system
  const circuitBreakers = new TradingCircuitBreakers({
    dailyLossLimit: Number(process.env['DAILY_LOSS_LIMIT'] ?? 0.05),
    maxConsecutiveLosses: Number(process.env['MAX_CONSECUTIVE_LOSSES'] ?? 3),
    consecutiveLossCooldownMs: Number(process.env['CONSECUTIVE_LOSS_COOLDOWN_MS'] ?? 3_600_000),
    brierThreshold: Number(process.env['BRIER_THRESHOLD'] ?? 0.30),
    apiErrorThreshold: Number(process.env['API_ERROR_THRESHOLD'] ?? 5),
    apiErrorWindowMs: Number(process.env['API_ERROR_WINDOW_MS'] ?? 60_000),
    dbPath: config.dbPath,
    onAlert: (msg: string) => {
      eventBus.emit('alert.triggered', { rule: 'circuit-breaker', message: msg });
    },
  });
  // Wire trade results to circuit breaker tracking
  eventBus.on('trade.executed', (payload: { trade: TradeResult }) => {
    const pnl = Number(payload.trade.fillPrice ?? 0);
    circuitBreakers.recordTrade(pnl >= 0);
  });
  logger.info('Trading circuit breakers wired', 'App');

  // 5a. Wire performance analytics API to engine
  setAnalyticsEngine(_engine);
  logger.info('Performance analytics API wired', 'App');

  // 5a2. Alert history — ring buffer capturing EventBus alerts/trades/errors
  const alertHistory = new AlertHistory();
  alertHistory.wireEventBus(eventBus);
  setAlertHistory(alertHistory);
  logger.info('Alert history wired', 'App');

  // 5a3. Audit logger — captures trade/auth/system events to JSONL + SQLite
  const auditLogger = getAuditLogger();
  const auditStore = getAuditStore();
  eventBus.on('trade.executed', (payload: { trade: TradeResult }) => {
    const evt = auditLogger.logEvent({ category: 'trade', action: 'trade.executed', details: { marketId: payload.trade.marketId, side: payload.trade.side, strategy: payload.trade.strategy } });
    auditStore.saveEvent(evt);
  });
  eventBus.on('system.startup', (payload: { version: string }) => {
    const evt = auditLogger.logEvent({ category: 'system', action: 'system.startup', details: { version: payload.version } });
    auditStore.saveEvent(evt);
  });
  logger.info('Audit logger wired', 'App');

  // 5a4. Export API — wire trade/PnL/portfolio export to main router
  setExportDeps({
    getTrades: () => _engine!.getExecutor().getTradeLog(),
    getPnlSnapshots: () => [],
    getPortfolioSummary: () => ({ totalEquity: '0', totalUnrealizedPnl: '0', openPositions: 0, strategies: [] }),
  });
  logger.info('Export API wired', 'App');

  // 5a4. User webhook registry — outbound notifications to user-registered URLs
  _userWebhookRegistry = new UserWebhookRegistry();
  _userWebhookRegistry.wireEventBus(eventBus);
  setUserWebhookRegistry(_userWebhookRegistry);
  logger.info('User webhook registry wired', 'App');

  // 5a5. Usage metering — sliding window tracker with optional SQLite persistence
  const usageDbPath = process.env['USAGE_DB_PATH'];
  _usageTracker = new UsageTracker(usageDbPath ? { dbPath: usageDbPath } : undefined);
  const usageTracker = _usageTracker;
  setUsageTracker(usageTracker);
  logger.info('Usage tracker wired', 'App', { persistent: !!usageDbPath });

  // 5a6. Plugin registry — strategy plugin management (Enterprise feature)
  const pluginRegistry = new PluginRegistry();
  setPluginRegistry(pluginRegistry);
  logger.info('Plugin registry wired', 'App');

  // 5a7. Instance manager — multi-strategy scaling (Enterprise feature)
  const instanceManager = new InstanceManager();
  setInstanceManager(instanceManager);
  logger.info('Instance manager wired', 'App');

  // 5a8. CEX exchange client — connects to configured exchanges (paper mode by default)
  const exchangeClient = new ExchangeClient();
  setExchangeClient(exchangeClient);
  // Auto-connect exchanges from config if API keys present
  for (const [name, creds] of Object.entries(config.exchanges)) {
    try {
      exchangeClient.connect(name as any, { apiKey: creds.apiKey, apiSecret: creds.apiSecret });
      logger.info(`Exchange connected: ${name}`, 'App');
    } catch (err) {
      logger.warn(`Failed to connect exchange ${name}`, 'App', { error: String(err) });
    }
  }
  logger.info('Exchange client wired', 'App', { connected: exchangeClient.listConnected().length });

  // 5a9. DEX SwapRouter — multi-chain swap routing (paper mode unless RPC configured)
  const dexChainConfig: import('./dex/swap-router.js').ChainConfig = {};
  if (process.env['ETH_RPC_URL']) {
    dexChainConfig.evm = {
      ethereum: { rpcUrl: process.env['ETH_RPC_URL']!, privateKey: process.env['ETH_PRIVATE_KEY'] ?? '' },
    } as any;
  }
  if (process.env['SOLANA_RPC_URL']) {
    dexChainConfig.solana = {
      rpcUrl: process.env['SOLANA_RPC_URL']!,
      privateKey: process.env['SOLANA_PRIVATE_KEY'] ?? '',
    } as any;
  }
  const swapRouter = new SwapRouter(dexChainConfig);
  setSwapRouter(swapRouter);
  logger.info('DEX SwapRouter wired', 'App', { chains: swapRouter.getConfiguredChains() });

  // 5a10. Kalshi prediction market client (paper mode by default)
  const kalshiBundle = createKalshiClient({
    apiKey: process.env['KALSHI_API_KEY'],
    privateKey: process.env['KALSHI_PRIVATE_KEY'],
    paperMode: process.env['LIVE_TRADING'] !== 'true',
  });
  setKalshiDeps(kalshiBundle);
  logger.info('Kalshi client wired', 'App', { paperMode: process.env['LIVE_TRADING'] !== 'true' });

  // 5b. UserStore — shared across API server + dashboard for real analytics
  const userDbPath = process.env['USER_DB_PATH'] ?? 'data/users.db';
  const userStore = new UserStore(userDbPath);
  logger.info('UserStore initialised', 'App', { path: userDbPath });
  setMetricsUserStore(userStore);

  // Auto-seed admin from ADMIN_EMAIL + ADMIN_PASSWORD env vars (idempotent)
  const seedEmail = process.env['ADMIN_EMAIL'];
  const seedPass = process.env['ADMIN_PASSWORD'];
  if (seedEmail && seedPass) {
    const existing = userStore.getUserByEmail(seedEmail.toLowerCase().trim());
    if (!existing) {
      const { hashPassword } = await import('./users/user-store.js');
      const hash = await hashPassword(seedPass);
      const admin = userStore.createUserWithPassword(seedEmail.toLowerCase().trim(), hash);
      if (admin.role !== 'admin') userStore.updateRole(admin.id, 'admin');
      logger.info('Admin user seeded', 'App', { email: seedEmail, role: 'admin' });
    } else if (existing.role !== 'admin') {
      userStore.updateRole(existing.id, 'admin');
      logger.info('Existing user promoted to admin', 'App', { email: seedEmail });
    }
  }

  // 5c. Shared LeaderBoard for copy-trading (used by API server + dashboard)
  const leaderBoard = new LeaderBoard();
  seedDemoLeaders(leaderBoard);
  logger.info('LeaderBoard initialised', 'App');

  // 6. API server (port 3000) — auth middleware + rate limiter wired inside createServer
  const jwtSecret = process.env['JWT_SECRET'] ?? 'dev-secret-change-me';
  _apiServer = createServer({ port: API_PORT, engine: _engine, userStore, jwtSecret, leaderBoard });
  logger.info('API server started', 'App', { port: API_PORT });

  // 7. Dashboard server — deferred to step 14b (after OpenClaw wiring provides live AI data)

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

  // 12b. P&L snapshot provider — daily performance tracking
  setPnlSnapshotProvider(() => ({
    totalEquity: '0',
    unrealizedPnl: '0',
    realizedPnl: '0',
    openPositions: 0,
    tradeCount: _engine ? _engine.getExecutor().getTradeLog().length : 0,
    winRate: 0,
  }));
  logger.info('P&L snapshot provider wired', 'App');

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

  // 14c. Trading Room AGI orchestrator — wires engine + exchanges + signal pipeline + OpenClaw
  {
    const { AgiOrchestrator } = await import('./trading-room/agi-orchestrator.js');
    const { SignalPipeline } = await import('./trading-room/signal-pipeline.js');
    const { ExchangeRegistry } = await import('./trading-room/exchange-registry.js');
    const registry = new ExchangeRegistry();
    const pipeline = new SignalPipeline();
    if (_openClaw?.deps.controller) {
      const orchestrator = new AgiOrchestrator(_engine, registry, pipeline, _openClaw.deps.controller as any);
      setTradingRoomOrchestrator(orchestrator);
      logger.info('AgiOrchestrator wired for Trading Room', 'App');
    } else {
      logger.info('AgiOrchestrator skipped — OpenClaw controller not available', 'App');
    }
  }

  // 14b. Dashboard server (port 3001) — wired AFTER OpenClaw for live AI data
  const dashDeps: DashboardDeps = {
    signalGenerator: _openClaw.signalGenerator,
    tradeObserver: _openClaw.observer,
    leaderBoard,
  };
  _dashServer = createDashboardServer(DASHBOARD_PORT, new DashboardDataProvider(_engine), userStore, dashDeps);
  logger.info('Dashboard server started', 'App', { port: DASHBOARD_PORT });

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

  // 16b. Daily P&L snapshot job — captures portfolio state every 24h
  _scheduler.schedule('dailyPnlSnapshot', 'every 24h', async () => {
    const trades = _engine ? _engine.getExecutor().getTradeLog() : [];
    const snapshot: PnlSnapshot = {
      date: new Date().toISOString().slice(0, 10),
      totalEquity: '0',
      unrealizedPnl: '0',
      realizedPnl: '0',
      openPositions: 0,
      tradeCount: trades.length,
      winRate: 0,
      timestamp: Date.now(),
    };
    savePnlSnapshot(snapshot);
    logger.info('Daily P&L snapshot captured', 'App', { date: snapshot.date, tradeCount: snapshot.tradeCount });
  });
  logger.info('Daily P&L snapshot job registered (every 24h)', 'App');

  // 17. Recovery manager
  _recovery = new RecoveryManager();
  startRecoveryManager(_recovery, AUTO_SAVE_MS, {
    strategies: config.strategies,
    getOpenPositions: () => db.getOpenPositions(),
  });

  // 17b. System health aggregate endpoint
  setSystemHealthDeps({
    engine: _engine,
    getSchedulerStatus: () => ({ running: !!_scheduler, jobCount: _scheduler ? 3 : 0 }),
    getWebhookStats: () => _userWebhookRegistry?.getStats().deliveryStats ?? { pending: 0, delivered: 0, failed: 0 },
    getOpenClawStatus: () => _openClaw?.deps.controller ? 'configured' : 'none',
    getDbStatus: () => { try { db.getOpenPositions(); return true; } catch { return false; } },
  });
  logger.info('System health endpoint wired', 'App');

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
  logger.error(`Fatal startup error: ${String(err)}`, 'App');
  process.exit(1);
});
