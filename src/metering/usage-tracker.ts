// Usage tracking module for algo-trade RaaS billing metering
// Tracks API calls per user with sliding window and automatic cleanup
// Optional SQLite persistence via dbPath constructor option

import { logger } from '../core/logger.js';

const CLEANUP_INTERVAL_MS = 60_000; // run cleanup every minute
const MAX_RECORD_AGE_MS = 24 * 60 * 60 * 1_000; // 24 hours

export interface UsageRecord {
  userId: string;
  endpoint: string;
  timestamp: number;
  responseTimeMs: number;
}

export interface UsageTrackerOptions {
  /** Path to SQLite database for persistence. Omit for in-memory only. */
  dbPath?: string;
}

// SQLite types (lazy-loaded to keep unit tests fast)
type SqliteDb = { prepare: (sql: string) => SqliteStmt; exec: (sql: string) => void; close: () => void };
type SqliteStmt = { run: (...args: unknown[]) => void; all: (...args: unknown[]) => unknown[] };

export class UsageTracker {
  /** Primary store: userId → ordered list of records */
  private readonly records = new Map<string, UsageRecord[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private db: SqliteDb | null = null;
  private insertStmt: SqliteStmt | null = null;

  constructor(options?: UsageTrackerOptions) {
    if (options?.dbPath) {
      this.initDb(options.dbPath);
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /** Log a single API call for a user. */
  recordCall(userId: string, endpoint: string, responseTimeMs: number): void {
    const record: UsageRecord = {
      userId,
      endpoint,
      timestamp: Date.now(),
      responseTimeMs,
    };

    const bucket = this.records.get(userId);
    if (bucket) {
      bucket.push(record);
    } else {
      this.records.set(userId, [record]);
    }

    // Persist to SQLite if available
    this.insertStmt?.run(userId, endpoint, record.timestamp, responseTimeMs);
  }

  /** Total number of API calls made by a user within the last `periodMs` ms. */
  getUsage(userId: string, periodMs: number): number {
    return this.getRecordsInWindow(userId, periodMs).length;
  }

  /** Breakdown of call counts per endpoint for a user within the last `periodMs` ms. */
  getEndpointBreakdown(userId: string, periodMs: number = MAX_RECORD_AGE_MS): Record<string, number> {
    const recent = this.getRecordsInWindow(userId, periodMs);
    const breakdown: Record<string, number> = {};
    for (const r of recent) {
      breakdown[r.endpoint] = (breakdown[r.endpoint] ?? 0) + 1;
    }
    return breakdown;
  }

  /** List of unique userIds that have made at least one call within `periodMs` ms. */
  getActiveUsers(periodMs: number): string[] {
    const cutoff = Date.now() - periodMs;
    const active: string[] = [];
    for (const [userId, bucket] of this.records) {
      if (bucket.some((r) => r.timestamp >= cutoff)) {
        active.push(userId);
      }
    }
    return active;
  }

  /** Return raw records for a user within the sliding window. */
  getUserRecords(userId: string, periodMs: number = MAX_RECORD_AGE_MS): UsageRecord[] {
    return this.getRecordsInWindow(userId, periodMs);
  }

  /** All known userIds (including inactive ones still in memory). */
  getAllUserIds(): string[] {
    return Array.from(this.records.keys());
  }

  /** Stop the background cleanup timer and close DB (call during graceful shutdown). */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
      this.insertStmt = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private initDb(dbPath: string): void {
    try {
      // Dynamic import to avoid hard dependency on better-sqlite3
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      this.db = new Database(dbPath) as SqliteDb;
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS usage_records (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id   TEXT    NOT NULL,
          endpoint  TEXT    NOT NULL,
          timestamp INTEGER NOT NULL,
          response_time_ms INTEGER NOT NULL
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_usage_user_ts ON usage_records(user_id, timestamp)');
      this.insertStmt = this.db.prepare(
        'INSERT INTO usage_records (user_id, endpoint, timestamp, response_time_ms) VALUES (?, ?, ?, ?)',
      );

      // Load recent records into memory
      this.loadRecentRecords();

      logger.info('Usage tracker SQLite persistence enabled', 'UsageTracker', { dbPath });
    } catch (err) {
      logger.warn('Usage tracker SQLite init failed — falling back to in-memory', 'UsageTracker', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Load records from last 24h into memory on startup */
  private loadRecentRecords(): void {
    if (!this.db) return;
    const cutoff = Date.now() - MAX_RECORD_AGE_MS;
    const stmt = this.db.prepare(
      'SELECT user_id, endpoint, timestamp, response_time_ms FROM usage_records WHERE timestamp >= ?',
    );
    const rows = stmt.all(cutoff) as { user_id: string; endpoint: string; timestamp: number; response_time_ms: number }[];
    for (const row of rows) {
      const record: UsageRecord = {
        userId: row.user_id,
        endpoint: row.endpoint,
        timestamp: row.timestamp,
        responseTimeMs: row.response_time_ms,
      };
      const bucket = this.records.get(record.userId);
      if (bucket) {
        bucket.push(record);
      } else {
        this.records.set(record.userId, [record]);
      }
    }
    if (rows.length > 0) {
      logger.info(`Loaded ${rows.length} recent usage records from SQLite`, 'UsageTracker');
    }
  }

  private getRecordsInWindow(userId: string, periodMs: number): UsageRecord[] {
    const bucket = this.records.get(userId);
    if (!bucket) return [];
    const cutoff = Date.now() - periodMs;
    return bucket.filter((r) => r.timestamp >= cutoff);
  }

  /** Remove records older than 24 h; delete empty user buckets. Also cleans SQLite. */
  private cleanup(): void {
    const cutoff = Date.now() - MAX_RECORD_AGE_MS;
    for (const [userId, bucket] of this.records) {
      const trimmed = bucket.filter((r) => r.timestamp >= cutoff);
      if (trimmed.length === 0) {
        this.records.delete(userId);
      } else {
        this.records.set(userId, trimmed);
      }
    }
    // Also clean SQLite
    if (this.db) {
      try {
        this.db.prepare('DELETE FROM usage_records WHERE timestamp < ?').run(cutoff);
      } catch { /* non-critical */ }
    }
  }
}
