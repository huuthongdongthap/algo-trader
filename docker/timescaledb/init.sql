-- TimescaleDB Initialization
-- Hypertable schema for algo-trader time-series data.
--
-- Tables:
--   market_prices           — OHLCV price data per market token
--   order_book_snapshots    — Periodic orderbook depth snapshots
--   trade_history           — Executed trades (our orders)
--   signal_events           — Strategy signal events (buy/sell signals)
--
-- Policies:
--   Compression after 7 days (significant space reduction for time-series)
--   Retention: 90 days for trade_history, 30 days for prices & snapshots

-- Ensure TimescaleDB extension is loaded
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 1. MARKET PRICES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS market_prices (
    time            TIMESTAMPTZ         NOT NULL,
    token_id        TEXT                NOT NULL,
    market_id       TEXT                NOT NULL,
    open_price      NUMERIC(18, 6)      NOT NULL,
    high_price      NUMERIC(18, 6)      NOT NULL,
    low_price       NUMERIC(18, 6)      NOT NULL,
    close_price     NUMERIC(18, 6)      NOT NULL,
    volume          NUMERIC(24, 6)      NOT NULL DEFAULT 0,
    source          TEXT                NOT NULL DEFAULT 'polymarket'
);

SELECT create_hypertable(
    'market_prices',
    'time',
    if_not_exists => TRUE
);

-- Index for fast token-time queries (most common access pattern)
CREATE INDEX IF NOT EXISTS idx_market_prices_token_time
    ON market_prices (token_id, time DESC);

-- Compression: convert old chunks to columnar storage (saves ~90% space)
ALTER TABLE market_prices SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'token_id'
);

SELECT add_compression_policy(
    'market_prices',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Retention: drop data older than 30 days
SELECT add_retention_policy(
    'market_prices',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- 2. ORDER BOOK SNAPSHOTS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_book_snapshots (
    time            TIMESTAMPTZ         NOT NULL,
    token_id        TEXT                NOT NULL,
    market_id       TEXT                NOT NULL,
    -- Aggregated bid/ask levels stored as JSONB for flexibility
    bids            JSONB               NOT NULL DEFAULT '[]',
    asks            JSONB               NOT NULL DEFAULT '[]',
    best_bid        NUMERIC(18, 6),
    best_ask        NUMERIC(18, 6),
    spread          NUMERIC(18, 6)
);

SELECT create_hypertable(
    'order_book_snapshots',
    'time',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_order_book_token_time
    ON order_book_snapshots (token_id, time DESC);

ALTER TABLE order_book_snapshots SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'token_id'
);

SELECT add_compression_policy(
    'order_book_snapshots',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

SELECT add_retention_policy(
    'order_book_snapshots',
    INTERVAL '30 days',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- 3. TRADE HISTORY (our executed orders)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trade_history (
    time            TIMESTAMPTZ         NOT NULL,
    trade_id        TEXT                NOT NULL,
    order_id        TEXT,
    token_id        TEXT                NOT NULL,
    market_id       TEXT                NOT NULL,
    side            TEXT                NOT NULL CHECK (side IN ('BUY', 'SELL')),
    price           NUMERIC(18, 6)      NOT NULL,
    size            NUMERIC(24, 6)      NOT NULL,
    fee_usdc        NUMERIC(18, 6)      NOT NULL DEFAULT 0,
    pnl_usdc        NUMERIC(18, 6),
    strategy        TEXT,
    status          TEXT                NOT NULL DEFAULT 'FILLED'
                                        CHECK (status IN ('FILLED', 'PARTIAL', 'FAILED', 'CANCELLED')),
    tx_hash         TEXT,
    nonce           BIGINT
);

SELECT create_hypertable(
    'trade_history',
    'time',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_trade_history_token_time
    ON trade_history (token_id, time DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_history_trade_id
    ON trade_history (trade_id, time);

ALTER TABLE trade_history SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'token_id, strategy'
);

SELECT add_compression_policy(
    'trade_history',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- Longer retention for trade history (audit / PnL analysis)
SELECT add_retention_policy(
    'trade_history',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

-- ─────────────────────────────────────────────────────────────
-- 4. SIGNAL EVENTS (strategy buy/sell signals)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS signal_events (
    time            TIMESTAMPTZ         NOT NULL,
    signal_id       TEXT                NOT NULL,
    token_id        TEXT                NOT NULL,
    market_id       TEXT                NOT NULL,
    signal_type     TEXT                NOT NULL,  -- e.g. 'ARBITRAGE', 'MOMENTUM', 'MEAN_REVERT'
    direction       TEXT                NOT NULL CHECK (direction IN ('LONG', 'SHORT', 'EXIT')),
    confidence      NUMERIC(5, 4)       NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    edge_bps        INTEGER,                       -- expected edge in basis points
    acted_on        BOOLEAN             NOT NULL DEFAULT FALSE,
    strategy        TEXT,
    metadata        JSONB               DEFAULT '{}'
);

SELECT create_hypertable(
    'signal_events',
    'time',
    if_not_exists => TRUE
);

CREATE INDEX IF NOT EXISTS idx_signal_events_token_time
    ON signal_events (token_id, time DESC);

ALTER TABLE signal_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'token_id, strategy'
);

SELECT add_compression_policy(
    'signal_events',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

SELECT add_retention_policy(
    'signal_events',
    INTERVAL '30 days',
    if_not_exists => TRUE
);
