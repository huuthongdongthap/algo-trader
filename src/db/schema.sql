-- P&L Tracking Schema
-- PostgreSQL tables for trade tracking and PnL calculation

-- Trades table
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
);

-- PnL daily summary
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
);

-- Performance metrics
CREATE TABLE IF NOT EXISTS performance_metrics (
  id SERIAL PRIMARY KEY,
  metric_name VARCHAR(64) NOT NULL,
  metric_value DECIMAL(18, 8) NOT NULL,
  period VARCHAR(16) NOT NULL,
  calculated_at BIGINT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON trades(created_at);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON trades(symbol);
