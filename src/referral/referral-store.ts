// SQLite persistence layer for referral system
// Tables: referral_codes, referral_links, referral_payouts

import Database from 'better-sqlite3';

// ── Row types ──────────────────────────────────────────────────────────────

export interface ReferralCodeRow {
  code: string;
  owner_id: string;
  created_at: number;
  usage_count: number;
  max_uses: number;
  active: number; // SQLite boolean: 1 | 0
}

export interface ReferralLinkRow {
  id: number;
  referrer_id: string;
  referee_id: string;
  code: string;
  created_at: number;
}

export interface ReferralPayoutRow {
  id: number;
  referrer_id: string;
  amount_usdc: string;
  paid: number; // 1 | 0
  created_at: number;
}

// ── Schema ─────────────────────────────────────────────────────────────────

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS referral_codes (
  code       TEXT PRIMARY KEY,
  owner_id   TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 0,
  max_uses   INTEGER NOT NULL DEFAULT 100,
  active     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS referral_links (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id TEXT NOT NULL,
  referee_id  TEXT NOT NULL UNIQUE,
  code        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_payouts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  referrer_id TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  paid        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rc_owner    ON referral_codes(owner_id);
CREATE INDEX IF NOT EXISTS idx_rl_referrer ON referral_links(referrer_id);
CREATE INDEX IF NOT EXISTS idx_rp_referrer ON referral_payouts(referrer_id);
`;

// ── Store class ────────────────────────────────────────────────────────────

export class ReferralStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  // ── referral_codes ──────────────────────────────────────────────────────

  saveCode(code: string, ownerId: string, maxUses = 100): void {
    this.db.prepare(`
      INSERT INTO referral_codes (code, owner_id, created_at, max_uses)
      VALUES (?, ?, ?, ?)
    `).run(code, ownerId, Date.now(), maxUses);
  }

  getCodeByValue(code: string): ReferralCodeRow | undefined {
    return this.db.prepare(
      `SELECT * FROM referral_codes WHERE code = ?`
    ).get(code) as ReferralCodeRow | undefined;
  }

  getCodesForOwner(ownerId: string): ReferralCodeRow[] {
    return this.db.prepare(
      `SELECT * FROM referral_codes WHERE owner_id = ? ORDER BY created_at DESC`
    ).all(ownerId) as ReferralCodeRow[];
  }

  incrementUsage(code: string): void {
    this.db.prepare(
      `UPDATE referral_codes SET usage_count = usage_count + 1 WHERE code = ?`
    ).run(code);
  }

  deactivateCode(code: string): void {
    this.db.prepare(
      `UPDATE referral_codes SET active = 0 WHERE code = ?`
    ).run(code);
  }

  // ── referral_links ──────────────────────────────────────────────────────

  saveLink(referrerId: string, refereeId: string, code: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO referral_links (referrer_id, referee_id, code, created_at)
      VALUES (?, ?, ?, ?)
    `).run(referrerId, refereeId, code, Date.now());
  }

  getLinksForReferrer(referrerId: string): ReferralLinkRow[] {
    return this.db.prepare(
      `SELECT * FROM referral_links WHERE referrer_id = ? ORDER BY created_at DESC`
    ).all(referrerId) as ReferralLinkRow[];
  }

  getLinkForReferee(refereeId: string): ReferralLinkRow | undefined {
    return this.db.prepare(
      `SELECT * FROM referral_links WHERE referee_id = ?`
    ).get(refereeId) as ReferralLinkRow | undefined;
  }

  // ── referral_payouts ────────────────────────────────────────────────────

  savePayout(referrerId: string, amountUsdc: string): number {
    const result = this.db.prepare(`
      INSERT INTO referral_payouts (referrer_id, amount_usdc, created_at)
      VALUES (?, ?, ?)
    `).run(referrerId, amountUsdc, Date.now());
    return result.lastInsertRowid as number;
  }

  getPayoutsForReferrer(referrerId: string): ReferralPayoutRow[] {
    return this.db.prepare(
      `SELECT * FROM referral_payouts WHERE referrer_id = ? ORDER BY created_at DESC`
    ).all(referrerId) as ReferralPayoutRow[];
  }

  getPendingPayouts(): ReferralPayoutRow[] {
    return this.db.prepare(
      `SELECT * FROM referral_payouts WHERE paid = 0 ORDER BY created_at ASC`
    ).all() as ReferralPayoutRow[];
  }

  markPayoutPaid(id: number): void {
    this.db.prepare(`UPDATE referral_payouts SET paid = 1 WHERE id = ?`).run(id);
  }

  close(): void { this.db.close(); }
}
