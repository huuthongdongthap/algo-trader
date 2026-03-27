/**
 * Migration Runner
 * Tracks and runs pending DB migrations on startup
 * Uses _migrations table to record applied migrations
 */

import { logger } from '../utils/logger';
import { getDbClient } from './postgres-client';
import * as migration001 from './migrations/001-create-trades-table';

// Migration interface
interface Migration {
  id: string;
  description: string;
  up: (client: import('pg').PoolClient) => Promise<void>;
  down: (client: import('pg').PoolClient) => Promise<void>;
}

// Ordered list of all migrations
const MIGRATIONS: Migration[] = [
  migration001,
];

/**
 * Ensure the _migrations tracking table exists
 */
async function ensureMigrationsTable(): Promise<void> {
  const pool = getDbClient();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id VARCHAR(128) PRIMARY KEY,
      description TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Get list of already-applied migration IDs
 */
async function getAppliedMigrations(): Promise<Set<string>> {
  const pool = getDbClient();
  const result = await pool.query<{ id: string }>('SELECT id FROM _migrations ORDER BY applied_at');
  return new Set(result.rows.map(r => r.id));
}

/**
 * Run all pending migrations in order
 */
export async function runMigrations(): Promise<void> {
  try {
    await ensureMigrationsTable();
    const applied = await getAppliedMigrations();

    const pending = MIGRATIONS.filter(m => !applied.has(m.id));
    if (pending.length === 0) {
      logger.info('[Migrations] All migrations up to date');
      return;
    }

    logger.info(`[Migrations] Running ${pending.length} pending migration(s)...`);

    const pool = getDbClient();
    for (const migration of pending) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await migration.up(client);
        await client.query(
          'INSERT INTO _migrations (id, description) VALUES ($1, $2)',
          [migration.id, migration.description]
        );
        await client.query('COMMIT');
        logger.info(`[Migrations] Applied: ${migration.id}`);
      } catch (err) {
        await client.query('ROLLBACK');
        logger.error(`[Migrations] Failed: ${migration.id}`, { error: err });
        throw err;
      } finally {
        client.release();
      }
    }

    logger.info('[Migrations] All pending migrations applied');
  } catch (err) {
    logger.error('[Migrations] Migration runner error:', { error: err });
    throw err;
  }
}
