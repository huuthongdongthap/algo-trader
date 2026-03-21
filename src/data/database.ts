// SQLite database layer via better-sqlite3 (synchronous, WAL mode)
// Tables: trades, positions, pnl_snapshots, strategy_state

import Database from 'better-sqlite3';
import type { TradeResult, Position, PnlSnapshot } from '../core/types.js';

export interface TradeRow {
  id: number; strategy: string; market: string; side: string;
  price: string; size: string; fees: string; pnl: string | null;
  timestamp: number; metadata: string | null;
}

export interface PositionRow {
  id: number; strategy: string; market: string; side: string;
  entry_price: string; size: string; unrealized_pnl: string;
  opened_at: number; closed_at: number | null;
}

export interface PnlSnapshotRow {
  id: number; strategy: string; equity: string;
  daily_pnl: string; cumulative_pnl: string; timestamp: number;
}

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL,
  market TEXT NOT NULL, side TEXT NOT NULL, price TEXT NOT NULL,
  size TEXT NOT NULL, fees TEXT DEFAULT '0', pnl TEXT,
  timestamp INTEGER NOT NULL, metadata TEXT
);
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL,
  market TEXT NOT NULL, side TEXT NOT NULL, entry_price TEXT NOT NULL,
  size TEXT NOT NULL, unrealized_pnl TEXT DEFAULT '0',
  opened_at INTEGER NOT NULL, closed_at INTEGER
);
CREATE TABLE IF NOT EXISTS pnl_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, strategy TEXT NOT NULL,
  equity TEXT NOT NULL, daily_pnl TEXT NOT NULL,
  cumulative_pnl TEXT NOT NULL, timestamp INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS strategy_state (
  strategy TEXT PRIMARY KEY, state TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trades_strategy  ON trades(strategy);
CREATE INDEX IF NOT EXISTS idx_trades_ts        ON trades(timestamp);
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market);
CREATE INDEX IF NOT EXISTS idx_pnl_strategy     ON pnl_snapshots(strategy);
`;

export class AlgoDatabase {
  private db: Database.Database;
  private stmtInsertTrade!: Database.Statement;
  private stmtInsertPosition!: Database.Statement;
  private stmtClosePosition!: Database.Statement;
  private stmtInsertPnl!: Database.Statement;
  private stmtUpsertState!: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
    this.stmtInsertTrade = this.db.prepare(
      `INSERT INTO trades (strategy,market,side,price,size,fees,pnl,timestamp,metadata)
       VALUES (@strategy,@market,@side,@price,@size,@fees,@pnl,@timestamp,@metadata)`
    );
    this.stmtInsertPosition = this.db.prepare(
      `INSERT INTO positions (strategy,market,side,entry_price,size,unrealized_pnl,opened_at)
       VALUES (@strategy,@market,@side,@entry_price,@size,@unrealized_pnl,@opened_at)`
    );
    this.stmtClosePosition = this.db.prepare(
      `UPDATE positions SET closed_at=@closed_at,unrealized_pnl=@unrealized_pnl WHERE id=@id`
    );
    this.stmtInsertPnl = this.db.prepare(
      `INSERT INTO pnl_snapshots (strategy,equity,daily_pnl,cumulative_pnl,timestamp)
       VALUES (@strategy,@equity,@daily_pnl,@cumulative_pnl,@timestamp)`
    );
    this.stmtUpsertState = this.db.prepare(
      `INSERT INTO strategy_state (strategy,state,updated_at) VALUES (@strategy,@state,@updated_at)
       ON CONFLICT(strategy) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`
    );
  }

  // Trades
  insertTrade(trade: TradeResult & { pnl?: string; metadata?: Record<string, unknown> }): number {
    const r = this.stmtInsertTrade.run({
      strategy: trade.strategy, market: trade.marketId, side: trade.side,
      price: trade.fillPrice, size: trade.fillSize, fees: trade.fees,
      pnl: trade.pnl ?? null, timestamp: trade.timestamp,
      metadata: trade.metadata ? JSON.stringify(trade.metadata) : null,
    });
    return r.lastInsertRowid as number;
  }

  getTrades(strategy?: string, limit = 100): TradeRow[] {
    return strategy
      ? this.db.prepare(`SELECT * FROM trades WHERE strategy=? ORDER BY timestamp DESC LIMIT ?`).all(strategy, limit) as TradeRow[]
      : this.db.prepare(`SELECT * FROM trades ORDER BY timestamp DESC LIMIT ?`).all(limit) as TradeRow[];
  }

  // Positions
  insertPosition(position: Position & { strategy: string }): number {
    const r = this.stmtInsertPosition.run({
      strategy: position.strategy, market: position.marketId, side: position.side,
      entry_price: position.entryPrice, size: position.size,
      unrealized_pnl: position.unrealizedPnl, opened_at: position.openedAt,
    });
    return r.lastInsertRowid as number;
  }

  getOpenPositions(strategy?: string): PositionRow[] {
    return strategy
      ? this.db.prepare(`SELECT * FROM positions WHERE strategy=? AND closed_at IS NULL`).all(strategy) as PositionRow[]
      : this.db.prepare(`SELECT * FROM positions WHERE closed_at IS NULL`).all() as PositionRow[];
  }

  closePosition(id: number, unrealizedPnl: string): void {
    this.stmtClosePosition.run({ id, closed_at: Date.now(), unrealized_pnl: unrealizedPnl });
  }

  // PnL snapshots
  insertPnlSnapshot(
    strategy: string,
    snap: Pick<PnlSnapshot, 'equity' | 'realizedPnl'> & { dailyPnl: string; cumulativePnl: string }
  ): void {
    this.stmtInsertPnl.run({
      strategy, equity: snap.equity, daily_pnl: snap.dailyPnl,
      cumulative_pnl: snap.cumulativePnl, timestamp: Date.now(),
    });
  }

  getPnlHistory(strategy: string, limit = 30): PnlSnapshotRow[] {
    return this.db
      .prepare(`SELECT * FROM pnl_snapshots WHERE strategy=? ORDER BY timestamp DESC LIMIT ?`)
      .all(strategy, limit) as PnlSnapshotRow[];
  }

  // Strategy state
  saveStrategyState(strategy: string, state: Record<string, unknown>): void {
    this.stmtUpsertState.run({ strategy, state: JSON.stringify(state), updated_at: Date.now() });
  }

  loadStrategyState(strategy: string): Record<string, unknown> | null {
    const row = this.db
      .prepare(`SELECT state FROM strategy_state WHERE strategy=?`)
      .get(strategy) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as Record<string, unknown>) : null;
  }

  close(): void { this.db.close(); }
}

let _instance: AlgoDatabase | null = null;

export function getDatabase(dbPath = 'data/algo-trade.db'): AlgoDatabase {
  if (!_instance) _instance = new AlgoDatabase(dbPath);
  return _instance;
}
