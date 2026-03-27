/**
 * Migration 001: Create core trading tables
 * Establishes trades, pnl_daily, and performance_metrics tables
 */

import { PoolClient } from 'pg';

export const id = '001-create-trades-table';
export const description = 'Create trades, pnl_daily, and performance_metrics tables';

export async function up(client: PoolClient): Promise<void> {
  // Trades table
  await client.query(`
    CREATE TABLE IF NOT EXISTS trades (
      id VARCHAR(64) PRIMARY KEY,
      opportunity_id VARCHAR(64) NOT NULL,
      execution_id VARCHAR(64) NOT NULL,
      symbol VARCHAR(32) NOT NULL,
      buy_exchange VARCHAR(32) NOT NULL,
      sell_exchange VARCHAR(32) NOT NULL,
      buy_price DECIMAL(18, 8) NOT NULL,
      sell_price DECIMAL(18, 8) NOT NULL,
      amount DECIMAL(18, 8) NOT NULL,
      spread_percent DECIMAL(8, 4) NOT NULL,
      profit DECIMAL(18, 8) NOT NULL,
      fee DECIMAL(18, 8) DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);

  // PnL daily summary
  await client.query(`
    CREATE TABLE IF NOT EXISTS pnl_daily (
      date DATE PRIMARY KEY,
      total_profit DECIMAL(18, 8) NOT NULL DEFAULT 0,
      total_loss DECIMAL(18, 8) NOT NULL DEFAULT 0,
      net_pnl DECIMAL(18, 8) NOT NULL DEFAULT 0,
      trade_count INTEGER NOT NULL DEFAULT 0,
      win_count INTEGER NOT NULL DEFAULT 0,
      loss_count INTEGER NOT NULL DEFAULT 0,
      avg_win DECIMAL(18, 8) DEFAULT 0,
      avg_loss DECIMAL(18, 8) DEFAULT 0,
      max_drawdown DECIMAL(8, 4) DEFAULT 0,
      updated_at BIGINT NOT NULL
    )
  `);

  // Performance metrics
  await client.query(`
    CREATE TABLE IF NOT EXISTS performance_metrics (
      id SERIAL PRIMARY KEY,
      metric_name VARCHAR(64) NOT NULL,
      metric_value DECIMAL(18, 8) NOT NULL,
      period VARCHAR(16) NOT NULL,
      calculated_at BIGINT NOT NULL
    )
  `);

  // Indexes
  await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol)`);
}

export async function down(client: PoolClient): Promise<void> {
  await client.query('DROP TABLE IF EXISTS performance_metrics');
  await client.query('DROP TABLE IF EXISTS pnl_daily');
  await client.query('DROP TABLE IF EXISTS trades');
}
