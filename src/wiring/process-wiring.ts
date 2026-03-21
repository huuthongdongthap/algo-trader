// Process lifecycle wiring — signal handlers, uncaught exceptions, recovery manager setup
// Extracted from app.ts to keep bootstrap file under 200 lines.
import type { EventBus } from '../events/event-bus.js';
import type { NotificationRouter } from '../notifications/notification-router.js';
import type { RecoveryManager } from '../resilience/recovery-manager.js';
import type { JobScheduler } from '../scheduler/job-scheduler.js';
import { registerBuiltInJobs } from '../scheduler/job-registry.js';
import { logger } from '../core/logger.js';
import type { StrategyConfig } from '../core/types.js';
import type { PositionRow } from '../data/database.js';

// ---------------------------------------------------------------------------
// Recovery manager
// ---------------------------------------------------------------------------

export interface RecoveryAutoSaveContext {
  strategies: StrategyConfig[];
  getOpenPositions: () => PositionRow[];
}

/**
 * Boot RecoveryManager: check for crash state, then start auto-save loop.
 */
export function startRecoveryManager(
  recovery: RecoveryManager,
  intervalMs: number,
  ctx: RecoveryAutoSaveContext,
): void {
  if (recovery.shouldRecover()) {
    const state = recovery.loadState();
    if (state) {
      logger.info('Recovering from previous crash', 'ProcessWiring', {
        strategies: state.strategies.length,
        positions: state.positions.length,
        lastEquity: state.lastEquity,
      });
    }
  }

  recovery.startAutoSave(intervalMs, () => ({
    strategies: ctx.strategies,
    positions: ctx.getOpenPositions().map((p) => ({
      marketId: p.market,
      side: p.side as 'long' | 'short',
      entryPrice: p.entry_price,
      size: p.size,
      unrealizedPnl: p.unrealized_pnl,
      openedAt: p.opened_at,
    })),
    lastEquity: '0',
    timestamp: Date.now(),
  }));

  logger.info('Recovery manager started', 'ProcessWiring');
}

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

/**
 * Start scheduler and register all built-in jobs.
 */
export function startScheduler(scheduler: JobScheduler): void {
  registerBuiltInJobs(scheduler);
  logger.info('Scheduler started with built-in jobs', 'ProcessWiring');
}

// ---------------------------------------------------------------------------
// Process signal + error handlers
// ---------------------------------------------------------------------------

export interface SignalHandlerDeps {
  eventBus: EventBus;
  notifier: NotificationRouter | null;
  stopApp: (reason: string) => Promise<void>;
}

/**
 * Register SIGINT, SIGTERM, uncaughtException, and unhandledRejection handlers.
 * Call once per process — handles do not stack safely.
 */
export function wireProcessSignals(deps: SignalHandlerDeps): void {
  const { eventBus, stopApp } = deps;

  const onSignal = async (signal: string) => {
    logger.info(`Received ${signal}`, 'ProcessWiring');
    eventBus.emit('system.shutdown', { reason: signal });
    await stopApp(signal);
    process.exit(0);
  };

  process.once('SIGINT',  () => { void onSignal('SIGINT'); });
  process.once('SIGTERM', () => { void onSignal('SIGTERM'); });

  process.on('uncaughtException', async (err: Error) => {
    logger.error('Uncaught exception — emergency shutdown', 'ProcessWiring', {
      error: err.message, stack: err.stack,
    });
    try {
      await deps.notifier?.send(`[CRITICAL] Uncaught exception: ${err.message}`);
    } catch { /* notification failure must not block shutdown */ }
    await stopApp('uncaughtException');
    process.exit(1);
  });

  process.on('unhandledRejection', async (reason: unknown) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error('Unhandled promise rejection', 'ProcessWiring', { reason: message });
    try {
      await deps.notifier?.send(`[ERROR] Unhandled rejection: ${message}`);
    } catch { /* ignore */ }
  });
}
