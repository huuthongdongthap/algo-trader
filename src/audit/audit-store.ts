// SQLite persistence layer for audit events
// Uses better-sqlite3 (synchronous) consistent with database.ts patterns
// Provides query, aggregate, and export capabilities for regulatory submission

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import type { AuditEvent, AuditCategory } from './audit-logger.js';

export interface AuditEventRow {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  user_id: string | null;
  details: string; // JSON string
  ip: string | null;
}

export interface AuditQueryFilters {
  category?: AuditCategory;
  userId?: string;
  /** ISO date string — inclusive lower bound */
  from?: string;
  /** ISO date string — inclusive upper bound */
  to?: string;
  limit?: number;
}

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS audit_events (
  id       TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  category TEXT NOT NULL,
  action   TEXT NOT NULL,
  user_id  TEXT,
  details  TEXT NOT NULL,
  ip       TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_category  ON audit_events(category);
CREATE INDEX IF NOT EXISTS idx_audit_user_id   ON audit_events(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
`;

function rowToEvent(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    category: row.category as AuditCategory,
    action: row.action,
    details: JSON.parse(row.details) as Record<string, unknown>,
    ...(row.user_id !== null && { userId: row.user_id }),
    ...(row.ip !== null && { ip: row.ip }),
  };
}

export class AuditStore {
  private db: Database.Database;
  private stmtInsert!: Database.Statement;

  constructor(dbPath = 'data/audit.db') {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
    this.stmtInsert = this.db.prepare(
      `INSERT OR IGNORE INTO audit_events (id, timestamp, category, action, user_id, details, ip)
       VALUES (@id, @timestamp, @category, @action, @user_id, @details, @ip)`
    );
  }

  /** Persist a single audit event. Idempotent — duplicate IDs are silently ignored. */
  saveEvent(event: AuditEvent): void {
    this.stmtInsert.run({
      id: event.id,
      timestamp: event.timestamp,
      category: event.category,
      action: event.action,
      user_id: event.userId ?? null,
      details: JSON.stringify(event.details),
      ip: event.ip ?? null,
    });
  }

  /**
   * Search audit events with optional filters.
   * Results ordered by timestamp DESC.
   */
  queryEvents(filters: AuditQueryFilters = {}): AuditEvent[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters.category) {
      conditions.push('category = @category');
      params['category'] = filters.category;
    }
    if (filters.userId) {
      conditions.push('user_id = @userId');
      params['userId'] = filters.userId;
    }
    if (filters.from) {
      conditions.push('timestamp >= @from');
      params['from'] = filters.from;
    }
    if (filters.to) {
      conditions.push('timestamp <= @to');
      params['to'] = filters.to;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 500;
    const sql = `SELECT * FROM audit_events ${where} ORDER BY timestamp DESC LIMIT ${limit}`;

    const rows = this.db.prepare(sql).all(params) as AuditEventRow[];
    return rows.map(rowToEvent);
  }

  /** Aggregate count of events per category, or filtered to a specific category */
  getEventCount(category?: AuditCategory): number {
    if (category) {
      const row = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM audit_events WHERE category = ?`)
        .get(category) as { cnt: number };
      return row.cnt;
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) as cnt FROM audit_events`)
      .get() as { cnt: number };
    return row.cnt;
  }

  /**
   * Export events within a date range for regulatory submission.
   * Returns events ordered by timestamp ASC (chronological order for auditors).
   */
  exportEvents(from: string, to: string): AuditEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_events WHERE timestamp >= ? AND timestamp <= ? ORDER BY timestamp ASC`
      )
      .all(from, to) as AuditEventRow[];
    return rows.map(rowToEvent);
  }

  close(): void {
    this.db.close();
  }
}

let _instance: AuditStore | null = null;

export function getAuditStore(dbPath?: string): AuditStore {
  if (!_instance) _instance = new AuditStore(dbPath);
  return _instance;
}
