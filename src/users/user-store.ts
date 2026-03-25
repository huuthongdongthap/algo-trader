// User CRUD operations backed by SQLite (better-sqlite3, synchronous)
// Handles API key generation, hashing, and soft-delete lifecycle

import Database from 'better-sqlite3';
import { randomUUID, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Tier, Role } from './subscription-tier.js';

export interface User {
  id: string;
  email: string;
  /** Plaintext API key (only returned on creation) */
  apiKey: string;
  /** SHA-256 hash of the API secret */
  apiSecretHash: string;
  /** scrypt hash of password: "salt:hash" (null for API-key-only users) */
  passwordHash: string | null;
  tier: Tier;
  /** Access control role: first registered user auto-promoted to admin */
  role: Role;
  createdAt: number;
  active: boolean;
  /** Polar customer ID, set after first checkout completion */
  polarCustomerId: string | null;
  /** Polar subscription ID for the active subscription */
  polarSubscriptionId: string | null;
}

/** Row shape stored in SQLite */
interface UserRow {
  id: string;
  email: string;
  api_key: string;
  api_secret_hash: string;
  password_hash: string | null;
  tier: string;
  role: string;
  created_at: number;
  active: number; // 0 | 1
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
}

const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  email                 TEXT NOT NULL UNIQUE,
  api_key               TEXT NOT NULL UNIQUE,
  api_secret_hash       TEXT NOT NULL,
  password_hash         TEXT,
  tier                  TEXT NOT NULL DEFAULT 'free',
  role                  TEXT NOT NULL DEFAULT 'user',
  created_at            INTEGER NOT NULL,
  active                INTEGER NOT NULL DEFAULT 1,
  polar_customer_id     TEXT,
  polar_subscription_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_api_key           ON users(api_key);
CREATE INDEX IF NOT EXISTS idx_users_email             ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_polar_customer_id ON users(polar_customer_id);
`;

/** Migrate existing DB: add columns if they don't exist */
const MIGRATION_SQL = `
ALTER TABLE users ADD COLUMN polar_customer_id     TEXT;
ALTER TABLE users ADD COLUMN polar_subscription_id TEXT;
ALTER TABLE users ADD COLUMN password_hash         TEXT;
ALTER TABLE users ADD COLUMN tv_webhook_secret     TEXT;
ALTER TABLE users ADD COLUMN role                  TEXT NOT NULL DEFAULT 'user';
CREATE INDEX IF NOT EXISTS idx_users_polar_customer_id ON users(polar_customer_id);
`;

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    apiKey: row.api_key,
    apiSecretHash: row.api_secret_hash,
    passwordHash: row.password_hash ?? null,
    tier: row.tier as Tier,
    role: (row.role || 'user') as Role,
    createdAt: row.created_at,
    active: row.active === 1,
    polarCustomerId: row.polar_customer_id ?? null,
    polarSubscriptionId: row.polar_subscription_id ?? null,
  };
}

/** Hash a plaintext password with scrypt + random salt; returns "salt:hash" */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

/** Verify a plaintext password against a stored "salt:hash" string */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else {
        const hashBuf = Buffer.from(hash, 'hex');
        const derivedBuf = derivedKey;
        if (hashBuf.length !== derivedBuf.length) { resolve(false); return; }
        resolve(timingSafeEqual(hashBuf, derivedBuf));
      }
    });
  });
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export class UserStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
    // Run column migrations; SQLite throws on duplicate columns — ignore those errors
    for (const stmt of MIGRATION_SQL.trim().split('\n').filter(Boolean)) {
      try { this.db.exec(stmt); } catch { /* column already exists */ }
    }
  }

  /** Lookup user by email */
  getUserByEmail(email: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE email = ? AND active = 1`)
      .get(email) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /**
   * Create a new user with password hash for web registration.
   * Returns User with plaintext apiKey.
   */
  createUserWithPassword(email: string, passwordHash: string, tier: Tier = 'free'): User {
    const id = randomUUID();
    const apiKey = `ak_${randomBytes(32).toString('hex')}`;
    const apiSecret = randomUUID();
    const apiSecretHash = hashSecret(apiSecret);
    const createdAt = Date.now();

    // Auto-admin: first registered user OR email matches ADMIN_EMAIL env
    const role: Role = this.resolveRole(email);

    this.db.prepare(
      `INSERT INTO users (id, email, api_key, api_secret_hash, password_hash, tier, role, created_at, active)
       VALUES (@id, @email, @api_key, @api_secret_hash, @password_hash, @tier, @role, @created_at, 1)`
    ).run({ id, email, api_key: apiKey, api_secret_hash: apiSecretHash, password_hash: passwordHash, tier, role, created_at: createdAt });

    return { id, email, apiKey, apiSecretHash, passwordHash, tier, role, createdAt, active: true, polarCustomerId: null, polarSubscriptionId: null };
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
    const role: Role = this.resolveRole(email);

    this.db.prepare(
      `INSERT INTO users (id, email, api_key, api_secret_hash, tier, role, created_at, active)
       VALUES (@id, @email, @api_key, @api_secret_hash, @tier, @role, @created_at, 1)`
    ).run({ id, email, api_key: apiKey, api_secret_hash: apiSecretHash, tier, role, created_at: createdAt });

    return { id, email, apiKey, apiSecretHash, passwordHash: null, tier, role, createdAt, active: true, polarCustomerId: null, polarSubscriptionId: null };
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

  /** Set or update Polar customer + subscription IDs alongside tier */
  updatePolarSubscription(
    userId: string,
    tier: Tier,
    polarCustomerId: string,
    polarSubscriptionId: string,
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE users
            SET tier = ?, polar_customer_id = ?, polar_subscription_id = ?
          WHERE id = ?`,
      )
      .run(tier, polarCustomerId, polarSubscriptionId, userId);
    return result.changes > 0;
  }

  /** Find a user by their Polar customer ID (used in webhook handlers) */
  getUserByPolarCustomerId(polarCustomerId: string): User | null {
    const row = this.db
      .prepare(`SELECT * FROM users WHERE polar_customer_id = ? AND active = 1`)
      .get(polarCustomerId) as UserRow | undefined;
    return row ? rowToUser(row) : null;
  }

  /**
   * Generate a new API key for an existing user and persist it.
   * Returns the plaintext key (shown once — caller must store it safely).
   * The old api_key is replaced immediately.
   */
  generateApiKey(userId: string): string | null {
    const user = this.getUserById(userId);
    if (!user) return null;

    // 32 random bytes → 64-char hex string, prefixed for easy identification
    const newKey = `ak_${randomBytes(32).toString('hex')}`;
    const result = this.db
      .prepare(`UPDATE users SET api_key = ? WHERE id = ? AND active = 1`)
      .run(newKey, userId);

    return result.changes > 0 ? newKey : null;
  }

  /**
   * Validate an API key and return the matching active user, or null.
   * Wrapper around getUserByApiKey for consistent naming in auth middleware.
   */
  validateApiKey(key: string): User | null {
    return this.getUserByApiKey(key);
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

  /** Store a TradingView webhook secret for a user */
  updateTvWebhookSecret(userId: string, secret: string): boolean {
    const result = this.db
      .prepare(`UPDATE users SET tv_webhook_secret = ? WHERE id = ? AND active = 1`)
      .run(secret, userId);
    return result.changes > 0;
  }

  /** Retrieve the TradingView webhook secret for a user, or null if not set */
  getTvWebhookSecret(userId: string): string | null {
    const row = this.db
      .prepare(`SELECT tv_webhook_secret FROM users WHERE id = ? AND active = 1`)
      .get(userId) as { tv_webhook_secret: string | null } | undefined;
    return row?.tv_webhook_secret ?? null;
  }

  /** Determine role for new user: admin if first user or ADMIN_EMAIL match */
  private resolveRole(email: string): Role {
    const adminEmail = process.env['ADMIN_EMAIL']?.toLowerCase().trim();
    if (adminEmail && email.toLowerCase().trim() === adminEmail) return 'admin';
    // First user ever registered becomes admin
    const count = this.db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (count.cnt === 0) return 'admin';
    return 'user';
  }

  /** Update user role (admin use only) */
  updateRole(userId: string, role: Role): boolean {
    const result = this.db
      .prepare('UPDATE users SET role = ? WHERE id = ?')
      .run(role, userId);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
