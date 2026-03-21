// SQLite persistence layer for marketplace strategies and purchases
// Tables: marketplace_strategies, marketplace_purchases
// Uses better-sqlite3 (synchronous) consistent with src/data/database.ts pattern

import Database from 'better-sqlite3';
import type { StrategyListing, StrategyCategory } from './strategy-registry.js';

export type SortBy = 'downloads' | 'rating' | 'price_asc' | 'price_desc' | 'newest';

export interface PurchaseRow {
  id: number;
  user_id: string;
  strategy_id: string;
  price_usdc: string;
  purchased_at: number;
}

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS marketplace_strategies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  author         TEXT NOT NULL,
  version        TEXT NOT NULL,
  category       TEXT NOT NULL,
  perf_stats     TEXT NOT NULL,
  price_usdc     TEXT NOT NULL DEFAULT '0',
  downloads      INTEGER NOT NULL DEFAULT 0,
  rating         REAL NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL,
  strategy_id    TEXT NOT NULL,
  price_usdc     TEXT NOT NULL,
  purchased_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mp_strat_category ON marketplace_strategies(category);
CREATE INDEX IF NOT EXISTS idx_mp_strat_downloads ON marketplace_strategies(downloads DESC);
CREATE INDEX IF NOT EXISTS idx_mp_purchases_user  ON marketplace_purchases(user_id);
CREATE INDEX IF NOT EXISTS idx_mp_purchases_strat ON marketplace_purchases(strategy_id);
`;

/** Serialise StrategyListing to a flat DB row object */
function listingToRow(listing: StrategyListing): Record<string, unknown> {
  return {
    id: listing.id,
    name: listing.name,
    description: listing.description,
    author: listing.author,
    version: listing.version,
    category: listing.category,
    perf_stats: JSON.stringify(listing.performanceStats),
    price_usdc: listing.priceUsdc,
    downloads: listing.downloads,
    rating: listing.rating,
    created_at: listing.createdAt,
    updated_at: listing.updatedAt,
  };
}

/** Deserialise a DB row back to StrategyListing */
function rowToListing(row: Record<string, unknown>): StrategyListing {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    description: row['description'] as string,
    author: row['author'] as string,
    version: row['version'] as string,
    category: row['category'] as StrategyCategory,
    performanceStats: JSON.parse(row['perf_stats'] as string),
    priceUsdc: row['price_usdc'] as string,
    downloads: row['downloads'] as number,
    rating: row['rating'] as number,
    createdAt: row['created_at'] as number,
    updatedAt: row['updated_at'] as number,
  };
}

export class StrategyStore {
  private db: Database.Database;
  private stmtUpsert: Database.Statement;
  private stmtById: Database.Statement;
  private stmtPurchase: Database.Statement;
  private stmtIncrDownloads: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);

    this.stmtUpsert = this.db.prepare(`
      INSERT INTO marketplace_strategies
        (id,name,description,author,version,category,perf_stats,price_usdc,downloads,rating,created_at,updated_at)
      VALUES
        (@id,@name,@description,@author,@version,@category,@perf_stats,@price_usdc,@downloads,@rating,@created_at,@updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description, author=excluded.author,
        version=excluded.version, category=excluded.category, perf_stats=excluded.perf_stats,
        price_usdc=excluded.price_usdc, downloads=excluded.downloads, rating=excluded.rating,
        updated_at=excluded.updated_at
    `);

    this.stmtById = this.db.prepare(
      `SELECT * FROM marketplace_strategies WHERE id = ?`,
    );

    this.stmtPurchase = this.db.prepare(`
      INSERT INTO marketplace_purchases (user_id,strategy_id,price_usdc,purchased_at)
      VALUES (@user_id,@strategy_id,@price_usdc,@purchased_at)
    `);

    this.stmtIncrDownloads = this.db.prepare(
      `UPDATE marketplace_strategies SET downloads = downloads + 1 WHERE id = ?`,
    );
  }

  /** Insert or update a strategy listing */
  saveListing(listing: StrategyListing): void {
    this.stmtUpsert.run(listingToRow(listing));
  }

  /** Fetch single listing by id — returns undefined if not found */
  getListingById(id: string): StrategyListing | undefined {
    const row = this.stmtById.get(id) as Record<string, unknown> | undefined;
    return row ? rowToListing(row) : undefined;
  }

  /** Search listings with optional category filter and sort */
  searchListings(
    query: string,
    category?: StrategyCategory,
    sortBy: SortBy = 'downloads',
  ): StrategyListing[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (query.trim()) {
      conditions.push(`(name LIKE ? OR description LIKE ? OR author LIKE ?)`);
      const like = `%${query.trim()}%`;
      params.push(like, like, like);
    }

    if (category) {
      conditions.push(`category = ?`);
      params.push(category);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const ORDER_MAP: Record<SortBy, string> = {
      downloads: 'downloads DESC',
      rating: 'rating DESC',
      price_asc: 'CAST(price_usdc AS REAL) ASC',
      price_desc: 'CAST(price_usdc AS REAL) DESC',
      newest: 'created_at DESC',
    };

    const sql = `SELECT * FROM marketplace_strategies ${where} ORDER BY ${ORDER_MAP[sortBy]} LIMIT 100`;
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map(rowToListing);
  }

  /** Record a purchase and increment download counter */
  recordPurchase(userId: string, strategyId: string, priceUsdc: string): number {
    const info = this.stmtPurchase.run({
      user_id: userId,
      strategy_id: strategyId,
      price_usdc: priceUsdc,
      purchased_at: Date.now(),
    });
    this.stmtIncrDownloads.run(strategyId);
    return info.lastInsertRowid as number;
  }

  /** Get all strategies purchased by a user */
  getUserPurchases(userId: string): PurchaseRow[] {
    return this.db
      .prepare(`SELECT * FROM marketplace_purchases WHERE user_id = ? ORDER BY purchased_at DESC`)
      .all(userId) as PurchaseRow[];
  }

  close(): void { this.db.close(); }
}

let _store: StrategyStore | null = null;

export function getStrategyStore(dbPath = 'data/algo-trade.db'): StrategyStore {
  if (!_store) _store = new StrategyStore(dbPath);
  return _store;
}
