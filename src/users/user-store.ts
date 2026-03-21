// User CRUD operations backed by SQLite (better-sqlite3, synchronous)
// Handles API key generation, hashing, and soft-delete lifecycle

import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import type { Tier } from './subscription-tier.js';

export interface User {
  id: string;
  email: string;
  /** Plaintext API key (only returned on creation) */
  apiKey: string;
  /** SHA-256 hash of the API secret */
  apiSecretHash: string;
  tier: Tier;
  createdAt: number;
  active: boolean;
}

/** Row shape stored in SQLite */
interface UserRow {
  id: string;
  email: string;
  api_key: string;
  api_secret_hash: string;
  tier: string;
  created_at: number;
  active: number; // 0 | 1
}

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  api_key         TEXT NOT NULL UNIQUE,
  api_secret_hash TEXT NOT NULL,
  tier            TEXT NOT NULL DEFAULT 'free',
  created_at      INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_users_api_key ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
`;

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    apiKey: row.api_key,
    apiSecretHash: row.api_secret_hash,
    tier: row.tier as Tier,
    createdAt: row.created_at,
    active: row.active === 1,
  };
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class UserStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  /**
   * Create a new user; generates a unique API key + hashed secret.
   * Returns the full User including plaintext apiKey (store it safely — shown once).
   */
  createUser(email: string, tier: Tier = 'free'): User {
    const id = randomUUID();
    const apiKey = randomUUID();
    const apiSecret = randomUUID();
    const apiSecretHash = hashSecret(apiSecret);
    const createdAt = Date.now();

    this.db.prepare(
      `INSERT INTO users (id, email, api_key, api_secret_hash, tier, created_at, active)
       VALUES (@id, @email, @api_key, @api_secret_hash, @tier, @created_at, 1)`
    ).run({ id, email, api_key: apiKey, api_secret_hash: apiSecretHash, tier, created_at: createdAt });

    return { id, email, apiKey, apiSecretHash, tier, createdAt, active: true };
  }

  /** Lookup user by API key (used for request auth) */
  getUserByApiKey(key: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE api_key = ? AND active = 1`)
      .get(key) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /** Direct lookup by user ID */
  getUserById(id: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(id) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /** Upgrade or downgrade subscription tier */
  updateTier(id: string, tier: Tier): boolean {
    const result = this.db
      .prepare(`UPDATE users SET tier = ? WHERE id = ?`)
      .run(tier, id);
    return result.changes > 0;
  }

  /** Soft delete — sets active=0, preserves historical data */
  deactivateUser(id: string): boolean {
    const result = this.db
      .prepare(`UPDATE users SET active = 0 WHERE id = ?`)
      .run(id);
    return result.changes > 0;
  }

  /** List all currently active users */
  listActiveUsers(): User[] {
    const rows = this.db
      .prepare(`SELECT * FROM users WHERE active = 1 ORDER BY created_at DESC`)
      .all() as UserRow[];
    return rows.map(rowToUser);
  }

  close(): void {
    this.db.close();
  }
}
