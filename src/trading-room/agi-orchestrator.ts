// AgiOrchestrator: master wiring — ExchangeRegistry → SignalPipeline → StrategyRunner → OpenClaw
// Lifecycle: goLive(config) → runCycle() loop → goSafe() on shutdown

import type { TradingEngine } from '../engine/engine.js';
import type { OpenClawController } from '../openclaw/controller.js';
import { logger } from '../core/logger.js';
import type { ExchangeRegistry } from './exchange-registry.js';
import { SignalPipeline, type TradingSignal } from './signal-pipeline.js';

export interface GoLiveConfig {
  /** 'auto' = fully autonomous; 'semi-auto' = AI suggests, human approves */
  mode: 'auto' | 'semi-auto';
  cycleIntervalMs?: number;
  watchSymbols?: string[];
  /** Health-check all exchanges before going live (default: true) */
  preflightCheck?: boolean;
}

export interface OrchestratorStatus {
  live: boolean;
  mode: GoLiveConfig['mode'] | null;
  uptime: number | null;
  exchanges: ReturnType<ExchangeRegistry['getSummary']>;
  strategies: ReturnType<TradingEngine['getStatus']>['strategies'];
  activePipeline: number;
  completedSignals: number;
  cycleCount: number;
  lastCycleAt: number | null;
  lastAutoTuneAt: number | null;
}

export class AgiOrchestrator {
  private live = false;
  private startedAt: number | null = null;
  private currentMode: GoLiveConfig['mode'] | null = null;
  private cycleInterval: ReturnType<typeof setInterval> | null = null;
  private cycleCount = 0;
  private lastCycleAt: number | null = null;
  private lastAutoTuneAt: number | null = null;
  private completedSignals = 0;

  constructor(
    private readonly engine: TradingEngine,
    private readonly registry: ExchangeRegistry,
    private readonly pipeline: SignalPipeline,
    private readonly openclaw: OpenClawController,
  ) {
    this.pipeline.onStageComplete(record => {
      if (record.stage === 'confirm' && !record.error) this.completedSignals++;
    });
  }

  /** Start all systems and begin the trading cycle loop. Throws if already live. */
  async goLive(config: GoLiveConfig): Promise<void> {
    if (this.live) {
      logger.warn('AgiOrchestrator already live', 'AgiOrchestrator');
      return;
    }

    logger.info(`Going LIVE in ${config.mode} mode`, 'AgiOrchestrator');

    if (config.preflightCheck !== false) {
      await this.registry.healthCheck();
      const healthy = this.registry.getHealthy();
      if (healthy.length === 0) throw new Error('Preflight failed: no healthy exchanges');
      logger.info(`Preflight OK — ${healthy.length} exchange(s)`, 'AgiOrchestrator');
    }

    await this.engine.start({ dryRun: config.mode === 'semi-auto' });
    this.live = true;
    this.startedAt = Date.now();
    this.currentMode = config.mode;

    const intervalMs = config.cycleIntervalMs ?? 5_000;
    this.cycleInterval = setInterval(
      () => this.runCycle().catch(err => logger.error(`Cycle error: ${err}`, 'AgiOrchestrator')),
      intervalMs,
    );
    logger.info('AgiOrchestrator is LIVE', 'AgiOrchestrator');
  }

  /** Graceful shutdown: drain pipeline, stop engine, disconnect exchanges. */
  async goSafe(): Promise<void> {
    if (!this.live) return;
    logger.info('Going SAFE', 'AgiOrchestrator');

    if (this.cycleInterval) { clearInterval(this.cycleInterval); this.cycleInterval = null; }

    // Drain in-flight signals (max 10 s)
    const deadline = Date.now() + 10_000;
    while (this.pipeline.getActivePipeline().length > 0 && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 200));
    }

    await this.engine.shutdown('goSafe');
    await this.registry.disconnectAll();
    this.live = false;
    logger.info('AgiOrchestrator is SAFE', 'AgiOrchestrator');
  }

  /** Full system status snapshot */
  getStatus(): OrchestratorStatus {
    return {
      live: this.live,
      mode: this.currentMode,
      uptime: this.startedAt ? Date.now() - this.startedAt : null,
      exchanges: this.registry.getSummary(),
      strategies: this.engine.getStatus().strategies,
      activePipeline: this.pipeline.getActivePipeline().length,
      completedSignals: this.completedSignals,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastAutoTuneAt: this.lastAutoTuneAt,
    };
  }

  /** Single trading cycle: scan healthy exchanges → emit signals via OpenClaw sentiment. */
  async runCycle(): Promise<void> {
    if (!this.live) return;
    this.cycleCount++;
    this.lastCycleAt = Date.now();

    const healthy = this.registry.getHealthy();
    if (healthy.length === 0) {
      logger.warn('runCycle: no healthy exchanges — skipping', 'AgiOrchestrator');
      return;
    }

    logger.debug(`Cycle #${this.cycleCount} — ${healthy.length} exchange(s)`, 'AgiOrchestrator');

    // TODO: replace with real signal generators (strategies, ML, AI router)
    for (const entry of healthy) {
      try {
        const sentiment = await this.openclaw.quickCheck(
          `In one word, is ${entry.name} BTC/USDT currently bullish, bearish, or neutral?`,
        );
        const side = sentiment.toLowerCase().includes('bullish') ? 'buy' : 'sell';
        const signal: TradingSignal = {
          id: `${entry.name}-${this.cycleCount}-${Date.now()}`,
          source: 'openclaw',
          symbol: 'BTC/USDT',
          side,
          confidence: 0.6,
          timestamp: Date.now(),
          meta: { exchange: entry.name, sentiment },
        };
        this.pipeline.addSignal(signal);
      } catch (err) {
        logger.warn(`Cycle signal error on ${entry.name}: ${err}`, 'AgiOrchestrator');
      }
    }
  }

  /** Ask OpenClaw to analyze performance and suggest parameter tuning. */
  async autoTune(): Promise<void> {
    if (!this.live) { logger.warn('autoTune called while not live', 'AgiOrchestrator'); return; }

    const engineStatus = this.engine.getStatus();
    const metrics: Record<string, unknown> = {
      tradeCount: engineStatus.tradeCount,
      strategies: engineStatus.strategies,
      completedSignals: this.completedSignals,
      cycleCount: this.cycleCount,
    };

    logger.info('Running autoTune via OpenClaw...', 'AgiOrchestrator');
    const activeStrategy = this.engine.getConfig().strategies.find(s => s.enabled);
    if (activeStrategy) {
      try {
        const suggestions = await this.openclaw.suggestParameters(
          activeStrategy.name, activeStrategy.params, metrics,
        );
        logger.info(`autoTune: ${suggestions.length} suggestion(s)`, 'AgiOrchestrator', { suggestions });
      } catch (err) {
        logger.warn(`autoTune failed: ${err}`, 'AgiOrchestrator');
      }
    }
    this.lastAutoTuneAt = Date.now();
  }
}
