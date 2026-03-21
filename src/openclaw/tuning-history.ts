// Tuning History: audit trail for all parameter tuning decisions
// In-memory store with optional SQLite persistence via better-sqlite3

import type { StrategyName } from '../core/types.js';
import type { TuningMode } from './tuning-executor.js';

export type TuningOutcome = 'improved' | 'degraded' | 'neutral';

export interface TuningRecord {
  id: string;
  timestamp: number;
  strategy: StrategyName;
  previousParams: Record<string, unknown>;
  newParams: Record<string, unknown>;
  reasoning: string;
  confidence: number;
  mode: TuningMode;
  /** Whether params were actually applied (false = manual/skipped) */
  applied: boolean;
  /** Set after observing post-tuning performance */
  outcome?: TuningOutcome;
}

export interface EffectivenessReport {
  total: number;
  applied: number;
  withOutcome: number;
  improved: number;
  degraded: number;
  neutral: number;
  /** Improvement rate among resolved records (0..1) */
  improvementRate: number;
}

/** Minimal SQLite interface — only what we need (avoids hard dependency) */
interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...args: unknown[]): void;
    get(...args: unknown[]): unknown;
  };
}

export class TuningHistory {
  private readonly records: Map<string, TuningRecord> = new Map();
  private db: SqliteDb | null = null;

  /** Optionally wire in a better-sqlite3 Database for persistence */
  useSqlite(db: SqliteDb): void {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tuning_history (
        id TEXT PRIMARY KEY,
        timestamp INTEGER NOT NULL,
        strategy TEXT NOT NULL,
        previous_params TEXT NOT NULL,
        new_params TEXT NOT NULL,
        reasoning TEXT NOT NULL,
        confidence REAL NOT NULL,
        mode TEXT NOT NULL,
        applied INTEGER NOT NULL,
        outcome TEXT
      )
    `);
  }

  /** Log a tuning decision (applied or skipped) */
  record(entry: Omit<TuningRecord, 'id'>): string {
    const id = `tune_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const record: TuningRecord = { id, ...entry };

    this.records.set(id, record);

    if (this.db) {
      this.db.prepare(
        `INSERT INTO tuning_history
         (id, timestamp, strategy, previous_params, new_params, reasoning, confidence, mode, applied, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        record.timestamp,
        record.strategy,
        JSON.stringify(record.previousParams),
        JSON.stringify(record.newParams),
        record.reasoning,
        record.confidence,
        record.mode,
        record.applied ? 1 : 0,
        record.outcome ?? null,
      );
    }

    return id;
  }

  /**
   * Query past tuning records.
   * @param strategy filter by strategy name (optional)
   * @param limit max records returned, most recent first (default 50)
   */
  getHistory(strategy?: StrategyName, limit = 50): TuningRecord[] {
    let results = [...this.records.values()];

    if (strategy) {
      results = results.filter(r => r.strategy === strategy);
    }

    // Sort descending by timestamp
    results.sort((a, b) => b.timestamp - a.timestamp);

    return results.slice(0, limit);
  }

  /** Summary of how many applied tunings improved vs degraded performance */
  getEffectiveness(): EffectivenessReport {
    const all = [...this.records.values()];
    const applied = all.filter(r => r.applied);
    const withOutcome = applied.filter(r => r.outcome !== undefined);
    const improved = withOutcome.filter(r => r.outcome === 'improved').length;
    const degraded = withOutcome.filter(r => r.outcome === 'degraded').length;
    const neutral = withOutcome.filter(r => r.outcome === 'neutral').length;

    return {
      total: all.length,
      applied: applied.length,
      withOutcome: withOutcome.length,
      improved,
      degraded,
      neutral,
      improvementRate: withOutcome.length > 0 ? improved / withOutcome.length : 0,
    };
  }

  /**
   * Record observed outcome after monitoring post-tuning performance.
   * Returns false if id not found.
   */
  markOutcome(id: string, outcome: TuningOutcome): boolean {
    const record = this.records.get(id);
    if (!record) return false;

    record.outcome = outcome;

    if (this.db) {
      this.db.prepare(
        `UPDATE tuning_history SET outcome = ? WHERE id = ?`,
      ).run(outcome, id);
    }

    return true;
  }
}
