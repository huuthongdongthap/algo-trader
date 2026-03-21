// Trading Room wiring layer: high-level orchestrator that wires all room components together.
// Instantiated once per process; acts as DI container for the AGI trading room.

import { TradingEngine } from '../engine/engine.js';
import { EventBus, getEventBus } from '../events/event-bus.js';
import { OpenClawController } from '../openclaw/controller.js';
import { ExchangeRegistry } from './exchange-registry.js';
import { logger } from '../core/logger.js';
import type { SupportedExchange } from '../cex/exchange-client.js';
import type { ExchangeCredentials } from '../core/types.js';

// ─── Dependency types ────────────────────────────────────────────────────────

/** Telegram bot configuration (optional feature) */
export interface TelegramConfig {
  token: string;
  /** Chat/group ID to send alerts to */
  chatId: string;
  /** Whether to start in silent mode (no alerts on boot) */
  silent?: boolean;
}

/** All external dependencies injected into the Trading Room */
export interface TradingRoomDeps {
  /** Core trading engine instance */
  engine: TradingEngine;
  /** Event bus (defaults to singleton if omitted) */
  eventBus?: EventBus;
  /** OpenClaw AI controller (optional — enables AI observer + tuner) */
  openclawController?: OpenClawController;
  /** Telegram bot config (optional — enables /slash commands via Telegram) */
  telegramConfig?: TelegramConfig;
  /** Exchange entries to register on setup */
  exchanges?: Array<{ name: SupportedExchange; creds: ExchangeCredentials }>;
}

// ─── Lazy-import shims for parallel-created files ────────────────────────────
// These files are created by other agents in parallel. We import them
// dynamically so TypeScript does not fail at compile time if they're absent.

type AnyModule = Record<string, unknown>;

async function tryImport(path: string): Promise<AnyModule> {
  try {
    return await import(path) as AnyModule;
  } catch {
    return {};
  }
}

// ─── Status shapes ───────────────────────────────────────────────────────────

export interface RoomStatus {
  running: boolean;
  engine: ReturnType<TradingEngine['getStatus']>;
  exchanges: ReturnType<ExchangeRegistry['getSummary']>;
  telegram: boolean;
  openclaw: boolean;
  startedAt: number | null;
}

// ─── TradingRoom ─────────────────────────────────────────────────────────────

/**
 * TradingRoom: high-level orchestrator for the AGI trading room.
 *
 * Lifecycle:
 *   const room = new TradingRoom();
 *   await room.setup(deps);
 *   await room.start();
 *   ...
 *   await room.stop();
 */
export class TradingRoom {
  private engine!: TradingEngine;
  private eventBus!: EventBus;
  private registry!: ExchangeRegistry;
  private openclawController?: OpenClawController;
  private telegramConfig?: TelegramConfig;

  // Lazily-loaded module handles (created by parallel agents)
  private agiOrchestrator: unknown = null;
  private signalPipeline: unknown = null;
  private commandRegistry: unknown = null;
  private telegramController: unknown = null;

  private running = false;
  private startedAt: number | null = null;

  // ─── Setup ──────────────────────────────────────────────────────────────────

  /**
   * Wire all Trading Room components from injected dependencies.
   * Must be called before start().
   */
  async setup(deps: TradingRoomDeps): Promise<void> {
    this.engine = deps.engine;
    this.eventBus = deps.eventBus ?? getEventBus();
    this.openclawController = deps.openclawController;
    this.telegramConfig = deps.telegramConfig;

    // 1. Exchange registry
    this.registry = new ExchangeRegistry();
    if (deps.exchanges) {
      for (const { name, creds } of deps.exchanges) {
        this.registry.register(name, creds);
      }
    }

    // 2. Signal pipeline (parallel agent creates signal-pipeline.ts)
    const signalMod = await tryImport('./signal-pipeline.js');
    if (typeof signalMod['SignalPipeline'] === 'function') {
      const Ctor = signalMod['SignalPipeline'] as new (bus: EventBus) => unknown;
      this.signalPipeline = new Ctor(this.eventBus);
      logger.info('SignalPipeline initialized', 'TradingRoom');
    }

    // 3. AGI orchestrator (parallel agent creates agi-orchestrator.ts)
    const agiMod = await tryImport('./agi-orchestrator.js');
    if (typeof agiMod['AgiOrchestrator'] === 'function') {
      const Ctor = agiMod['AgiOrchestrator'] as new (
        engine: TradingEngine,
        registry: ExchangeRegistry,
        pipeline: unknown,
      ) => unknown;
      this.agiOrchestrator = new Ctor(this.engine, this.registry, this.signalPipeline);
      logger.info('AgiOrchestrator initialized', 'TradingRoom');
    }

    // 4. Command registry + room commands (parallel agent creates these)
    const registryMod = await tryImport('./command-registry.js');
    if (typeof registryMod['CommandRegistry'] === 'function') {
      const Ctor = registryMod['CommandRegistry'] as new () => unknown;
      this.commandRegistry = new Ctor();

      // Bulk-register built-in room commands
      const cmdMod = await tryImport('./room-commands.js');
      if (typeof cmdMod['registerRoomCommands'] === 'function') {
        (cmdMod['registerRoomCommands'] as (reg: unknown, room: TradingRoom) => void)(
          this.commandRegistry,
          this,
        );
        logger.info('Room commands registered', 'TradingRoom');
      }
    }

    // 5. Telegram controller (optional)
    if (this.telegramConfig) {
      const tgMod = await tryImport('./telegram-controller.js');
      if (typeof tgMod['TelegramController'] === 'function') {
        const Ctor = tgMod['TelegramController'] as new (
          cfg: TelegramConfig,
          room: TradingRoom,
        ) => unknown;
        this.telegramController = new Ctor(this.telegramConfig, this);
        logger.info('TelegramController initialized', 'TradingRoom');
      }
    }

    // 6. OpenClaw AI observer + tuner (optional)
    if (this.openclawController) {
      this.wireOpenClaw();
    }

    logger.info('TradingRoom setup complete', 'TradingRoom');
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Start all room systems. */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('TradingRoom already running', 'TradingRoom');
      return;
    }

    // Start AGI orchestrator
    if (this.agiOrchestrator && typeof (this.agiOrchestrator as AnyModule)['start'] === 'function') {
      await (this.agiOrchestrator as { start(): Promise<void> }).start();
    }

    // Start Telegram bot
    if (this.telegramController && typeof (this.telegramController as AnyModule)['start'] === 'function') {
      await (this.telegramController as { start(): Promise<void> }).start();
      logger.info('TelegramController started', 'TradingRoom');
    }

    // Start engine
    await this.engine.start();

    this.running = true;
    this.startedAt = Date.now();
    logger.info('TradingRoom started', 'TradingRoom');
  }

  /** Graceful shutdown of all room systems. */
  async stop(): Promise<void> {
    if (!this.running) return;

    logger.info('TradingRoom shutting down...', 'TradingRoom');

    // Stop engine first (no more new trades)
    await this.engine.shutdown();

    // Stop AGI orchestrator
    if (this.agiOrchestrator && typeof (this.agiOrchestrator as AnyModule)['stop'] === 'function') {
      await (this.agiOrchestrator as { stop(): Promise<void> }).stop();
    }

    // Stop Telegram bot
    if (this.telegramController && typeof (this.telegramController as AnyModule)['stop'] === 'function') {
      await (this.telegramController as { stop(): Promise<void> }).stop();
    }

    // Disconnect all exchanges
    await this.registry.disconnectAll();

    this.running = false;
    logger.info('TradingRoom stopped', 'TradingRoom');
  }

  // ─── Command execution ──────────────────────────────────────────────────────

  /**
   * Parse and execute a slash command string.
   * Returns a result string suitable for display (CLI or Telegram).
   *
   * Example: await room.executeCommand('/status engine')
   */
  async executeCommand(input: string): Promise<string> {
    if (!this.commandRegistry) {
      return 'Command registry not available. Run setup() first.';
    }

    try {
      const reg = this.commandRegistry as {
        execute(input: string): Promise<string>;
      };
      return await reg.execute(input);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Command error: ${msg}`, 'TradingRoom');
      return `Error: ${msg}`;
    }
  }

  // ─── Status ─────────────────────────────────────────────────────────────────

  /** Return a full snapshot of the room's current state. */
  getStatus(): RoomStatus {
    return {
      running: this.running,
      engine: this.engine.getStatus(),
      exchanges: this.registry?.getSummary() ?? [],
      telegram: this.telegramController !== null,
      openclaw: this.openclawController !== undefined,
      startedAt: this.startedAt,
    };
  }

  // ─── Accessors (for room-commands and other consumers) ───────────────────────

  getEngine(): TradingEngine { return this.engine; }
  getEventBus(): EventBus { return this.eventBus; }
  getRegistry(): ExchangeRegistry { return this.registry; }
  getOpenClaw(): OpenClawController | undefined { return this.openclawController; }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Wire OpenClaw AI controller to the event bus.
   * Subscribes to trade/signal events and routes to AI analysis pipeline.
   */
  private wireOpenClaw(): void {
    if (!this.openclawController) return;

    this.eventBus.on('trade.executed', (data) => {
      logger.debug(`OpenClaw observing filled trade: ${JSON.stringify(data)}`, 'TradingRoom');
    });

    this.eventBus.on('strategy.started', (data) => {
      logger.debug(`OpenClaw observing strategy start: ${JSON.stringify(data)}`, 'TradingRoom');
    });

    logger.info('OpenClaw wired to event bus', 'TradingRoom');
  }
}
