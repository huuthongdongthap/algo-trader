// Strategy lifecycle runner: manages start/stop/status for any strategy
import { logger } from '../core/logger.js';
import type { StrategyName, StrategyConfig } from '../core/types.js';

/** Common interface all strategies must implement */
export interface RunnableStrategy {
  start(...args: unknown[]): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Record<string, unknown>;
}

export type StrategyState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

interface RunnerEntry {
  name: StrategyName;
  strategy: RunnableStrategy;
  state: StrategyState;
  startedAt?: number;
  error?: string;
}

/**
 * Manages multiple strategy instances with lifecycle control.
 * Ensures graceful startup/shutdown ordering.
 */
export class StrategyRunner {
  private entries: Map<StrategyName, RunnerEntry> = new Map();

  /** Register a strategy for management */
  register(name: StrategyName, strategy: RunnableStrategy): void {
    if (this.entries.has(name)) {
      throw new Error(`Strategy "${name}" already registered`);
    }
    this.entries.set(name, { name, strategy, state: 'stopped' });
    logger.info(`Strategy registered: ${name}`, 'StrategyRunner');
  }

  /** Start a specific strategy */
  async startStrategy(name: StrategyName, ...args: unknown[]): Promise<void> {
    const entry = this.getEntry(name);
    if (entry.state === 'running') {
      logger.warn(`Strategy "${name}" already running`, 'StrategyRunner');
      return;
    }
    entry.state = 'starting';
    try {
      await entry.strategy.start(...args);
      entry.state = 'running';
      entry.startedAt = Date.now();
      entry.error = undefined;
      logger.info(`Strategy started: ${name}`, 'StrategyRunner');
    } catch (err) {
      entry.state = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      logger.error(`Strategy "${name}" failed to start: ${entry.error}`, 'StrategyRunner');
      throw err;
    }
  }

  /** Stop a specific strategy */
  async stopStrategy(name: StrategyName): Promise<void> {
    const entry = this.getEntry(name);
    if (entry.state === 'stopped') return;
    entry.state = 'stopping';
    try {
      await entry.strategy.stop();
      entry.state = 'stopped';
      logger.info(`Strategy stopped: ${name}`, 'StrategyRunner');
    } catch (err) {
      entry.state = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      logger.error(`Strategy "${name}" failed to stop: ${entry.error}`, 'StrategyRunner');
    }
  }

  /** Start all registered strategies that match provided configs */
  async startAll(configs: StrategyConfig[]): Promise<void> {
    const enabled = configs.filter(c => c.enabled);
    for (const cfg of enabled) {
      if (this.entries.has(cfg.name)) {
        await this.startStrategy(cfg.name);
      }
    }
  }

  /** Gracefully stop all running strategies */
  async stopAll(): Promise<void> {
    const running = [...this.entries.values()].filter(e => e.state === 'running');
    await Promise.allSettled(running.map(e => this.stopStrategy(e.name)));
    logger.info(`All strategies stopped (${running.length} total)`, 'StrategyRunner');
  }

  /** Get status of all strategies */
  getAllStatus(): Array<{ name: string; state: StrategyState; uptime?: number; error?: string }> {
    return [...this.entries.values()].map(e => ({
      name: e.name,
      state: e.state,
      uptime: e.startedAt ? Date.now() - e.startedAt : undefined,
      error: e.error,
    }));
  }

  private getEntry(name: StrategyName): RunnerEntry {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Strategy "${name}" not registered`);
    return entry;
  }
}
