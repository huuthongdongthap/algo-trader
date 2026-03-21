// Main trading engine: orchestrates strategies, execution, and lifecycle
import { loadConfig, validateConfig } from '../core/config.js';
import { logger } from '../core/logger.js';
import type { AppConfig, StrategyName } from '../core/types.js';
import { RiskManager } from '../core/risk-manager.js';
import { StrategyRunner } from './strategy-runner.js';
import { TradeExecutor } from './trade-executor.js';
import type { ExecutionAdapters } from './trade-executor.js';

export interface EngineOptions {
  dryRun?: boolean;
  strategies?: StrategyName[];
  capital?: string;
  adapters?: ExecutionAdapters;
}

/**
 * Top-level trading engine that boots the platform:
 * 1. Loads config + validates
 * 2. Initializes risk manager
 * 3. Sets up execution adapters
 * 4. Registers and starts strategies
 * 5. Handles graceful shutdown via SIGINT/SIGTERM
 */
export class TradingEngine {
  private config: AppConfig;
  private runner: StrategyRunner;
  private executor: TradeExecutor;
  private riskManager: RiskManager;
  private running = false;

  constructor(options: EngineOptions = {}) {
    this.config = loadConfig();
    logger.setLevel(this.config.logLevel);

    // Validate config
    const errors = validateConfig(this.config);
    if (errors.length > 0) {
      logger.warn(`Config warnings: ${errors.join(', ')}`, 'Engine');
    }

    this.riskManager = new RiskManager(this.config.riskLimits);
    this.executor = new TradeExecutor(options.adapters ?? {});
    this.runner = new StrategyRunner();

    // Register signal handlers for graceful shutdown
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  /** Get engine components for external use */
  getRunner(): StrategyRunner { return this.runner; }
  getExecutor(): TradeExecutor { return this.executor; }
  getRiskManager(): RiskManager { return this.riskManager; }
  getConfig(): AppConfig { return this.config; }
  isRunning(): boolean { return this.running; }

  /** Start the engine and all configured strategies */
  async start(options: EngineOptions = {}): Promise<void> {
    if (this.running) {
      logger.warn('Engine already running', 'Engine');
      return;
    }

    const mode = options.dryRun ? 'PAPER TRADING' : 'LIVE';
    logger.info(`Engine starting in ${mode} mode`, 'Engine', {
      capital: options.capital ?? 'from config',
      strategies: options.strategies ?? 'all enabled',
    });

    this.running = true;

    // Start strategies
    const toStart = options.strategies
      ? this.config.strategies.filter(s => options.strategies!.includes(s.name))
      : this.config.strategies.filter(s => s.enabled);

    if (toStart.length === 0) {
      logger.warn('No strategies configured to start. Add strategies to config.', 'Engine');
      return;
    }

    await this.runner.startAll(toStart);
    logger.info(`Engine running with ${toStart.length} strategies`, 'Engine');
  }

  /** Get full engine status */
  getStatus(): {
    running: boolean;
    strategies: ReturnType<StrategyRunner['getAllStatus']>;
    tradeCount: number;
    config: { env: string; riskLimits: AppConfig['riskLimits'] };
  } {
    return {
      running: this.running,
      strategies: this.runner.getAllStatus(),
      tradeCount: this.executor.getTradeLog().length,
      config: {
        env: this.config.env,
        riskLimits: this.config.riskLimits,
      },
    };
  }

  /** Graceful shutdown */
  async shutdown(signal?: string): Promise<void> {
    if (!this.running) return;
    logger.info(`Shutting down engine${signal ? ` (${signal})` : ''}...`, 'Engine');
    this.running = false;
    await this.runner.stopAll();
    logger.info('Engine shut down complete', 'Engine');
  }
}
