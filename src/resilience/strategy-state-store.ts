import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../core/logger.js';

const STATE_DIR_DEFAULT = 'data/strategy-state';

export interface StrategyStateEntry {
  strategyId: string;
  state: Record<string, unknown>;
  savedAt: number;
  version: number;
}

export class StrategyStateStore {
  private readonly stateDir: string;
  private dirty: Map<string, StrategyStateEntry> = new Map();
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(stateDir: string = STATE_DIR_DEFAULT) {
    this.stateDir = stateDir;
    if (!existsSync(this.stateDir)) {
      mkdirSync(this.stateDir, { recursive: true });
    }
  }

  /** Save strategy state (buffered - flushed periodically) */
  save(strategyId: string, state: Record<string, unknown>): void {
    const existing = this.dirty.get(strategyId);
    this.dirty.set(strategyId, {
      strategyId,
      state,
      savedAt: Date.now(),
      version: (existing?.version ?? 0) + 1,
    });
  }

  /** Load strategy state from disk. Returns null if not found or corrupted. */
  load(strategyId: string): Record<string, unknown> | null {
    // Check in-memory first
    const buffered = this.dirty.get(strategyId);
    if (buffered) return buffered.state;

    const filePath = this.filePath(strategyId);
    if (!existsSync(filePath)) return null;
    try {
      const raw = readFileSync(filePath, 'utf8');
      const entry = JSON.parse(raw) as StrategyStateEntry;
      // Reject states older than 2 hours
      if (Date.now() - entry.savedAt > 2 * 60 * 60 * 1000) {
        logger.warn('Strategy state too old, discarding', 'StrategyStateStore', {
          strategyId, ageMinutes: Math.round((Date.now() - entry.savedAt) / 60000),
        });
        return null;
      }
      return entry.state;
    } catch (err) {
      logger.error('Failed to load strategy state', 'StrategyStateStore', {
        strategyId, error: String(err),
      });
      return null;
    }
  }

  /** Flush all dirty entries to disk */
  flush(): void {
    for (const [id, entry] of this.dirty) {
      try {
        const filePath = this.filePath(id);
        writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
      } catch (err) {
        logger.error('Failed to flush strategy state', 'StrategyStateStore', {
          strategyId: id, error: String(err),
        });
      }
    }
    if (this.dirty.size > 0) {
      logger.debug(`Flushed ${this.dirty.size} strategy states`, 'StrategyStateStore');
    }
    this.dirty.clear();
  }

  /** Start periodic flush (default every 30 seconds) */
  startPeriodicFlush(intervalMs: number = 30_000): void {
    if (this.flushTimer) this.stopPeriodicFlush();
    this.flushTimer = setInterval(() => this.flush(), intervalMs);
    logger.info('Periodic state flush started', 'StrategyStateStore', { intervalMs });
  }

  /** Stop periodic flush */
  stopPeriodicFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /** Delete state for a strategy */
  delete(strategyId: string): void {
    this.dirty.delete(strategyId);
    const filePath = this.filePath(strategyId);
    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    } catch { /* ignore */ }
  }

  /** List all strategy IDs that have saved state */
  listSaved(): string[] {
    try {
      const files = readdirSync(this.stateDir) as string[];
      return files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  /** Shutdown: flush remaining and stop timer */
  shutdown(): void {
    this.stopPeriodicFlush();
    this.flush();
    logger.info('Strategy state store shut down', 'StrategyStateStore');
  }

  private filePath(strategyId: string): string {
    // Sanitize ID for filename safety
    const safe = strategyId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return join(this.stateDir, `${safe}.json`);
  }
}

/** Singleton instance */
export const strategyStateStore = new StrategyStateStore();
