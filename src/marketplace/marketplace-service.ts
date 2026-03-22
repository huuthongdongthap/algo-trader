// Marketplace service: strategy publishing and purchasing
// Tables: marketplace_listings, marketplace_purchases
// Revenue split: 70% creator / 30% platform

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type MarketplaceCategory = 'polymarket' | 'crypto' | 'forex' | 'equities' | 'other';

export interface MarketplaceListing {
  id: string;
  authorId: string;
  name: string;
  description: string;
  configJson: string;
  priceCents: number;
  category: MarketplaceCategory;
  downloads: number;
  rating: number;
  createdAt: number;
  active: boolean;
}

export interface MarketplacePurchase {
  id: string;
  buyerId: string;
  strategyId: string;
  pricePaid: number;
  creatorShare: number;
  platformShare: number;
  purchasedAt: number;
}

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS marketplace_listings (
  id           TEXT PRIMARY KEY,
  author_id    TEXT NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  price_cents  INTEGER NOT NULL DEFAULT 0,
  category     TEXT NOT NULL,
  downloads    INTEGER NOT NULL DEFAULT 0,
  rating       REAL NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id             TEXT PRIMARY KEY,
  buyer_id       TEXT NOT NULL,
  strategy_id    TEXT NOT NULL,
  price_paid     INTEGER NOT NULL,
  creator_share  INTEGER NOT NULL,
  platform_share INTEGER NOT NULL,
  purchased_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ml_author   ON marketplace_listings(author_id);
CREATE INDEX IF NOT EXISTS idx_ml_category ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_mp_buyer    ON marketplace_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_mp_strategy ON marketplace_purchases(strategy_id);
`;

export class MarketplaceService {
  private db: Database.Database;

  constructor(dbPath = 'data/algo-trade.db') {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  /** Publish a new strategy listing — Pro/Enterprise only (caller enforces tier) */
  publishStrategy(
    authorId: string,
    name: string,
    description: string,
    config: Record<string, unknown>,
    priceCents: number,
    category: MarketplaceCategory,
  ): MarketplaceListing {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO marketplace_listings
        (id, author_id, name, description, config_json, price_cents, category, downloads, rating, created_at, active)
      VALUES
        (@id, @author_id, @name, @description, @config_json, @price_cents, @category, 0, 0, @created_at, 1)
    `).run({
      id, author_id: authorId, name, description,
      config_json: JSON.stringify(config),
      price_cents: priceCents, category, created_at: now,
    });
    return this.getStrategy(id)!;
  }

  /** Paginated browse — public, no config_json exposed */
  browseStrategies(
    page: number,
    limit: number,
    category?: MarketplaceCategory,
  ): { items: Omit<MarketplaceListing, 'configJson'>[]; total: number } {
    const offset = (page - 1) * limit;
    const where = category ? `WHERE active=1 AND category=?` : `WHERE active=1`;
    const params = category ? [category] : [];

    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM marketplace_listings ${where}`)
      .get(...params) as { n: number }).n;

    const rows = this.db.prepare(
      `SELECT id,author_id,name,description,price_cents,category,downloads,rating,created_at,active
       FROM marketplace_listings ${where} ORDER BY downloads DESC LIMIT ? OFFSET ?`
    ).all(...params, limit, offset) as Record<string, unknown>[];

    return { items: rows.map(rowToListingPublic), total };
  }

  /** Single strategy with config exposed (for purchased users — caller checks ownership) */
  getStrategy(id: string): MarketplaceListing | undefined {
    const row = this.db.prepare(
      `SELECT * FROM marketplace_listings WHERE id=?`
    ).get(id) as Record<string, unknown> | undefined;
    return row ? rowToListing(row) : undefined;
  }

  /** Record purchase; returns strategy config. Caller must verify not already purchased. */
  purchaseStrategy(buyerId: string, strategyId: string): { purchase: MarketplacePurchase; config: Record<string, unknown> } {
    const listing = this.getStrategy(strategyId);
    if (!listing || !listing.active) throw new Error('Strategy not found or inactive');

    const alreadyBought = this.db.prepare(
      `SELECT id FROM marketplace_purchases WHERE buyer_id=? AND strategy_id=?`
    ).get(buyerId, strategyId);
    if (alreadyBought) throw new Error('Already purchased');

    const id = randomUUID();
    const creatorShare = Math.floor(listing.priceCents * 0.7);
    const platformShare = listing.priceCents - creatorShare;
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO marketplace_purchases (id, buyer_id, strategy_id, price_paid, creator_share, platform_share, purchased_at)
      VALUES (@id, @buyer_id, @strategy_id, @price_paid, @creator_share, @platform_share, @purchased_at)
    `).run({ id, buyer_id: buyerId, strategy_id: strategyId, price_paid: listing.priceCents, creator_share: creatorShare, platform_share: platformShare, purchased_at: now });

    this.db.prepare(`UPDATE marketplace_listings SET downloads=downloads+1 WHERE id=?`).run(strategyId);

    const purchase: MarketplacePurchase = { id, buyerId, strategyId, pricePaid: listing.priceCents, creatorShare, platformShare, purchasedAt: now };
    return { purchase, config: JSON.parse(listing.configJson) as Record<string, unknown> };
  }

  getMyPublished(authorId: string): Omit<MarketplaceListing, 'configJson'>[] {
    const rows = this.db.prepare(
      `SELECT id,author_id,name,description,price_cents,category,downloads,rating,created_at,active
       FROM marketplace_listings WHERE author_id=? ORDER BY created_at DESC`
    ).all(authorId) as Record<string, unknown>[];
    return rows.map(rowToListingPublic);
  }

  getMyPurchased(buyerId: string): { purchase: MarketplacePurchase; strategy: Omit<MarketplaceListing, 'configJson'> }[] {
    const rows = this.db.prepare(`
      SELECT p.id as pid, p.buyer_id, p.strategy_id, p.price_paid, p.creator_share, p.platform_share, p.purchased_at,
             l.id,l.author_id,l.name,l.description,l.price_cents,l.category,l.downloads,l.rating,l.created_at,l.active
      FROM marketplace_purchases p
      JOIN marketplace_listings l ON l.id=p.strategy_id
      WHERE p.buyer_id=? ORDER BY p.purchased_at DESC
    `).all(buyerId) as Record<string, unknown>[];

    return rows.map(r => ({
      purchase: { id: r['pid'] as string, buyerId: r['buyer_id'] as string, strategyId: r['strategy_id'] as string, pricePaid: r['price_paid'] as number, creatorShare: r['creator_share'] as number, platformShare: r['platform_share'] as number, purchasedAt: r['purchased_at'] as number },
      strategy: rowToListingPublic(r),
    }));
  }

  /** Get top-rated active strategies sorted by rating desc */
  getTopStrategies(limit = 10): Omit<MarketplaceListing, 'configJson'>[] {
    const rows = this.db.prepare(
      `SELECT id,author_id,name,description,price_cents,category,downloads,rating,created_at,active
       FROM marketplace_listings WHERE active=1 ORDER BY rating DESC, downloads DESC LIMIT ?`
    ).all(limit) as Record<string, unknown>[];
    return rows.map(rowToListingPublic);
  }

  /** Update strategy rating score (0-100 fitness score from backtest) */
  updateRating(id: string, rating: number): void {
    this.db.prepare(`UPDATE marketplace_listings SET rating=? WHERE id=?`).run(
      Math.max(0, Math.min(100, rating)), id,
    );
  }

  close(): void { this.db.close(); }
}

function rowToListing(r: Record<string, unknown>): MarketplaceListing {
  return {
    id: r['id'] as string, authorId: r['author_id'] as string,
    name: r['name'] as string, description: r['description'] as string,
    configJson: r['config_json'] as string, priceCents: r['price_cents'] as number,
    category: r['category'] as MarketplaceCategory, downloads: r['downloads'] as number,
    rating: r['rating'] as number, createdAt: r['created_at'] as number,
    active: Boolean(r['active']),
  };
}

function rowToListingPublic(r: Record<string, unknown>): Omit<MarketplaceListing, 'configJson'> {
  const { configJson: _c, ...rest } = rowToListing({ ...r, config_json: '' });
  void _c;
  return rest;
}

let _svc: MarketplaceService | null = null;
export function getMarketplaceService(dbPath = 'data/algo-trade.db'): MarketplaceService {
  if (!_svc) _svc = new MarketplaceService(dbPath);
  return _svc;
}
