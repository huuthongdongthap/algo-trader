// SQLite persistence layer for AI trading decisions (better-sqlite3, WAL mode)
// Table: ai_decisions — stores full audit trail for regulatory compliance

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';

export interface DecisionRow {
  id: string;
  timestamp: number;
  type: string;
  input_summary: string;
  output_summary: string;
  model: string;
  tokens: number;
  latency_ms: number;
  applied: number; // SQLite boolean: 0 | 1
  confidence: number;
}

export interface DecisionFilters {
  type?: string;
  model?: string;
  fromTs?: number;
  toTs?: number;
  applied?: boolean;
  limit?: number;
}

const CREATE_TABLE = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS ai_decisions (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL,
  input_summary TEXT NOT NULL,
  output_summary TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  applied INTEGER NOT NULL DEFAULT 0,
  confidence REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_decisions_ts   ON ai_decisions(timestamp);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON ai_decisions(type);
CREATE INDEX IF NOT EXISTS idx_decisions_model ON ai_decisions(model);
`;

export class DecisionStore {
  private db: Database.Database;
  private stmtInsert!: Database.Statement;
  private stmtQueryAll!: Database.Statement;

  constructor(dbPath: string) {
    // Ensure parent directory exists (fixes CI where data/ is missing)
    const dir = dbPath.includes('/') ? dbPath.slice(0, dbPath.lastIndexOf('/')) : '.';
    if (dir && dir !== '.') mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.exec(CREATE_TABLE);
    this.stmtInsert = this.db.prepare(
      `INSERT OR REPLACE INTO ai_decisions
       (id,timestamp,type,input_summary,output_summary,model,tokens,latency_ms,applied,confidence)
       VALUES (@id,@timestamp,@type,@input_summary,@output_summary,@model,@tokens,@latency_ms,@applied,@confidence)`
    );
    this.stmtQueryAll = this.db.prepare(
      `SELECT * FROM ai_decisions ORDER BY timestamp DESC LIMIT ?`
    );
  }

  saveDecision(row: DecisionRow): void {
    this.stmtInsert.run(row);
  }

  queryDecisions(filters: DecisionFilters = {}): DecisionRow[] {
    const parts: string[] = [];
    const params: unknown[] = [];
    if (filters.type)    { parts.push('type=?');           params.push(filters.type); }
    if (filters.model)   { parts.push('model=?');          params.push(filters.model); }
    if (filters.fromTs)  { parts.push('timestamp>=?');     params.push(filters.fromTs); }
    if (filters.toTs)    { parts.push('timestamp<=?');     params.push(filters.toTs); }
    if (filters.applied !== undefined) {
      parts.push('applied=?');
      params.push(filters.applied ? 1 : 0);
    }
    const where = parts.length ? `WHERE ${parts.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    params.push(limit);
    return this.db
      .prepare(`SELECT * FROM ai_decisions ${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...params) as DecisionRow[];
  }

  /** Aggregate stats for a rolling time window (periodMs from now) */
  getDecisionStats(periodMs: number): {
    total: number; byType: Record<string, number>;
    avgConfidence: number; avgLatency: number;
  } {
    const since = Date.now() - periodMs;
    const rows = this.db
      .prepare(`SELECT type, confidence, latency_ms FROM ai_decisions WHERE timestamp >= ?`)
      .all(since) as Pick<DecisionRow, 'type' | 'confidence' | 'latency_ms'>[];
    const byType: Record<string, number> = {};
    let totalConf = 0, totalLatency = 0;
    for (const r of rows) {
      byType[r.type] = (byType[r.type] ?? 0) + 1;
      totalConf += r.confidence;
      totalLatency += r.latency_ms;
    }
    const total = rows.length;
    return {
      total,
      byType,
      avgConfidence: total ? totalConf / total : 0,
      avgLatency:    total ? totalLatency / total : 0,
    };
  }

  /** Export decisions in [from, to] timestamp range for regulatory audit */
  exportDecisions(from: number, to: number): DecisionRow[] {
    return this.db
      .prepare(`SELECT * FROM ai_decisions WHERE timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`)
      .all(from, to) as DecisionRow[];
  }

  close(): void { this.db.close(); }
}

let _store: DecisionStore | null = null;

export function initDecisionStore(dbPath = 'data/algo-trade.db'): DecisionStore {
  if (!_store) _store = new DecisionStore(dbPath);
  return _store;
}
