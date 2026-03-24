/**
 * Strategy Orchestrator — manages lifecycle of multiple concurrent trading strategies.
 * Each strategy runs on its own interval timer with error tracking and auto-stop.
 */
import { EventBus } from '../events/event-bus.js';

export interface StrategyConfig {
  id: string;
  name: string;
  type: 'polymarket-arb' | 'polymarket-mm' | 'grid' | 'dca' | 'funding-arb' | 'book-imbalance';
  enabled: boolean;
  params: Record<string, unknown>;
  intervalMs: number;
}

export interface StrategyStatus {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  lastTick: string | null;
  tickCount: number;
  errorCount: number;
  lastError: string | null;
}

const MAX_CONSECUTIVE_ERRORS = 10;

interface StrategyState {
  config: StrategyConfig;
  tickFn: () => Promise<void>;
  status: 'running' | 'stopped' | 'error';
  lastTick: string | null;
  tickCount: number;
  errorCount: number;
  lastError: string | null;
}

export class StrategyOrchestrator {
  private strategies: Map<string, StrategyState> = new Map();
  private timers: Map<string, NodeJS.Timeout> = new Map();

  constructor(private eventBus?: EventBus) {}

  register(config: StrategyConfig, tickFn: () => Promise<void>): void {
    this.strategies.set(config.id, {
      config, tickFn,
      status: 'stopped', lastTick: null,
      tickCount: 0, errorCount: 0, lastError: null,
    });
  }

  start(strategyId: string): boolean {
    const state = this.strategies.get(strategyId);
    if (!state || state.status === 'running') return false;
    state.status = 'running';
    state.errorCount = 0;
    this.timers.set(strategyId, setInterval(() => this._tick(strategyId), state.config.intervalMs));
    this.eventBus?.emit('strategy.started', { name: state.config.name, config: state.config });
    return true;
  }

  stop(strategyId: string): boolean {
    const state = this.strategies.get(strategyId);
    if (!state || state.status !== 'running') return false;
    this._clearTimer(strategyId);
    state.status = 'stopped';
    this.eventBus?.emit('strategy.stopped', { name: state.config.name, reason: 'manual stop' });
    return true;
  }

  startAll(): void {
    for (const [id, state] of this.strategies) {
      if (state.config.enabled && state.status !== 'running') this.start(id);
    }
  }

  stopAll(): void {
    for (const [id, state] of this.strategies) {
      if (state.status === 'running') this.stop(id);
    }
  }

  getStatus(): StrategyStatus[] {
    return Array.from(this.strategies.values()).map(toStatus);
  }

  getStrategyStatus(id: string): StrategyStatus | undefined {
    const state = this.strategies.get(id);
    return state ? toStatus(state) : undefined;
  }

  isHealthy(): boolean {
    for (const state of this.strategies.values()) {
      if (state.status === 'error') return false;
    }
    return true;
  }

  private async _tick(strategyId: string): Promise<void> {
    const state = this.strategies.get(strategyId);
    if (!state || state.status !== 'running') return;
    try {
      await state.tickFn();
      state.tickCount++;
      state.lastTick = new Date().toISOString();
      state.errorCount = 0;
    } catch (err) {
      state.errorCount++;
      state.lastError = err instanceof Error ? err.message : String(err);
      this.eventBus?.emit('strategy.error', { name: state.config.name, error: state.lastError });
      if (state.errorCount >= MAX_CONSECUTIVE_ERRORS) {
        this._clearTimer(strategyId);
        state.status = 'error';
        this.eventBus?.emit('strategy.stopped', {
          name: state.config.name,
          reason: `auto-stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`,
        });
      }
    }
  }

  private _clearTimer(strategyId: string): void {
    const timer = this.timers.get(strategyId);
    if (timer) { clearInterval(timer); this.timers.delete(strategyId); }
  }
}

function toStatus(state: StrategyState): StrategyStatus {
  return {
    id: state.config.id, name: state.config.name, status: state.status,
    lastTick: state.lastTick, tickCount: state.tickCount,
    errorCount: state.errorCount, lastError: state.lastError,
  };
}
