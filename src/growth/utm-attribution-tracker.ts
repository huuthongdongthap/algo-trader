// UTM attribution tracker — captures signup source for marketing ROI analysis
// Stores utm_source, utm_medium, utm_campaign, utm_content per user registration
import { logger } from '../core/logger.js';

export interface UtmParams {
  source: string | null;   // utm_source (google, twitter, discord)
  medium: string | null;   // utm_medium (cpc, organic, referral)
  campaign: string | null;  // utm_campaign (launch-2026, polymarket-edge)
  content: string | null;   // utm_content (hero-cta, sidebar-ad)
  term: string | null;      // utm_term (search keyword)
}

export interface Attribution {
  userId: string;
  utm: UtmParams;
  referralCode: string | null;
  landingPage: string | null;
  registeredAt: number;
}

// SQLite types
type SqliteDb = { prepare: (sql: string) => SqliteStmt; exec: (sql: string) => void; close: () => void };
type SqliteStmt = { run: (...args: unknown[]) => void; all: (...args: unknown[]) => unknown[]; get: (...args: unknown[]) => unknown };

export class UtmAttributionTracker {
  private db: SqliteDb | null = null;
  private insertStmt: SqliteStmt | null = null;

  constructor(dbPath?: string) {
    if (dbPath) this.initDb(dbPath);
  }

  /** Extract UTM params from URL query string or request headers */
  static parseUtmFromUrl(url: string): UtmParams {
    try {
      const parsed = new URL(url, 'http://localhost');
      return {
        source: parsed.searchParams.get('utm_source'),
        medium: parsed.searchParams.get('utm_medium'),
        campaign: parsed.searchParams.get('utm_campaign'),
        content: parsed.searchParams.get('utm_content'),
        term: parsed.searchParams.get('utm_term'),
      };
    } catch {
      return { source: null, medium: null, campaign: null, content: null, term: null };
    }
  }

  /** Record attribution for a new user signup */
  recordAttribution(
    userId: string,
    utm: UtmParams,
    referralCode: string | null = null,
    landingPage: string | null = null,
  ): void {
    const attr: Attribution = { userId, utm, referralCode, landingPage, registeredAt: Date.now() };

    this.insertStmt?.run(
      userId,
      utm.source, utm.medium, utm.campaign, utm.content, utm.term,
      referralCode, landingPage, attr.registeredAt,
    );

    logger.debug('Attribution recorded', 'UtmTracker', {
      userId, source: utm.source, medium: utm.medium, campaign: utm.campaign,
    });
  }

  /** Get attribution breakdown by source for a time period */
  getSourceBreakdown(sinceDaysAgo = 30): Record<string, number> {
    if (!this.db) return {};
    const cutoff = Date.now() - sinceDaysAgo * 86_400_000;
    const rows = this.db.prepare(
      'SELECT utm_source, COUNT(*) as cnt FROM attributions WHERE registered_at >= ? AND utm_source IS NOT NULL GROUP BY utm_source ORDER BY cnt DESC',
    ).all(cutoff) as { utm_source: string; cnt: number }[];
    const result: Record<string, number> = {};
    for (const r of rows) result[r.utm_source] = r.cnt;
    return result;
  }

  /** Get attribution breakdown by campaign */
  getCampaignBreakdown(sinceDaysAgo = 30): Record<string, number> {
    if (!this.db) return {};
    const cutoff = Date.now() - sinceDaysAgo * 86_400_000;
    const rows = this.db.prepare(
      'SELECT utm_campaign, COUNT(*) as cnt FROM attributions WHERE registered_at >= ? AND utm_campaign IS NOT NULL GROUP BY utm_campaign ORDER BY cnt DESC',
    ).all(cutoff) as { utm_campaign: string; cnt: number }[];
    const result: Record<string, number> = {};
    for (const r of rows) result[r.utm_campaign] = r.cnt;
    return result;
  }

  /** Get total signups by referral vs organic */
  getReferralVsOrganic(sinceDaysAgo = 30): { referral: number; organic: number } {
    if (!this.db) return { referral: 0, organic: 0 };
    const cutoff = Date.now() - sinceDaysAgo * 86_400_000;
    const row = this.db.prepare(
      `SELECT
        SUM(CASE WHEN referral_code IS NOT NULL THEN 1 ELSE 0 END) as referral,
        SUM(CASE WHEN referral_code IS NULL THEN 1 ELSE 0 END) as organic
      FROM attributions WHERE registered_at >= ?`,
    ).get(cutoff) as { referral: number; organic: number } | undefined;
    return row ?? { referral: 0, organic: 0 };
  }

  destroy(): void {
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
      this.insertStmt = null;
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private initDb(dbPath: string): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      this.db = new Database(dbPath) as SqliteDb;
      this.db.exec('PRAGMA journal_mode = WAL');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS attributions (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id       TEXT NOT NULL,
          utm_source    TEXT,
          utm_medium    TEXT,
          utm_campaign  TEXT,
          utm_content   TEXT,
          utm_term      TEXT,
          referral_code TEXT,
          landing_page  TEXT,
          registered_at INTEGER NOT NULL
        )
      `);
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_attr_user ON attributions(user_id)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_attr_source ON attributions(utm_source, registered_at)');
      this.insertStmt = this.db.prepare(
        `INSERT INTO attributions (user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, referral_code, landing_page, registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      logger.info('UTM attribution tracker initialized', 'UtmTracker', { dbPath });
    } catch (err) {
      logger.warn('UTM attribution DB init failed — running without persistence', 'UtmTracker', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
