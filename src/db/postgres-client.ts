/**
 * PostgreSQL Client
 * Database connection pool for P&L tracking
 */

import pg from 'pg';
import { logger } from '../utils/logger';

const { Pool } = pg;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  maxConnections: number;
}

export interface DbRow {
  [key: string]: string | number | boolean | null | undefined;
}

let pool: pg.Pool | null = null;

/**
 * Get database connection pool
 */
export function getDbClient(config?: Partial<DbConfig>): pg.Pool {
  if (pool) return pool;

  const dbConfig: DbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'algo_trader',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    maxConnections: 10,
    ...config,
  };

  pool = new Pool(dbConfig);

  pool.on('error', (err) => {
    logger.error('[PostgreSQL] Unexpected error:', { err });
  });

  return pool;
}

/**
 * Execute query
 */
export async function query<T extends DbRow = DbRow>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  const client = getDbClient();
  return client.query(text, params) as Promise<pg.QueryResult<T>>;
}

/**
 * Execute transaction
 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getDbClient().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close database connections
 */
export async function closeDbConnection(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
