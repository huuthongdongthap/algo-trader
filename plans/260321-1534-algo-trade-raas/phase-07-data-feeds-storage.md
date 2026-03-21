---
phase: 7
title: "Data Feeds & Storage"
status: completed
priority: P2
effort: 4h
parallel_group: A
blocks: [9]
blocked_by: [1]
---

# Phase 7: Data Feeds & Storage

## Context
- [Research: Polymarket](../../plans/reports/researcher-260321-1532-polymarket-trading-strategies.md)
- [Research: CEX/DEX](../../plans/reports/researcher-260321-1531-cex-dex-trading-strategies.md)

## Overview
Data layer: price feeds aggregation, sentiment data sources, SQLite database for trade history/P&L tracking.

## File Ownership (Exclusive)
```
src/data/price-feed.ts       # Aggregated price feeds across venues
src/data/sentiment-feed.ts   # News/social sentiment data
src/data/database.ts         # SQLite database for trades, P&L, state
src/data/index.ts            # Barrel export
```

## Requirements

### Functional
1. **price-feed.ts** (~120 lines):
   - Aggregate prices from Polymarket, CEX (via CCXT), DEX
   - Price comparison across venues (identify arb opportunities)
   - Historical price caching (in-memory, last N ticks)
   - Event emitter for price threshold alerts
2. **sentiment-feed.ts** (~100 lines):
   - Fetch from public APIs: NewsAPI, CoinGecko trending
   - Keyword filtering for market-relevant events
   - Sentiment score: simple positive/negative/neutral classification
   - Rate-limited polling (respect API quotas)
3. **database.ts** (~150 lines):
   - SQLite via better-sqlite3 (sync API, fast)
   - Tables: trades, positions, pnl_snapshots, strategy_state
   - CRUD operations: insertTrade, getOpenPositions, getPnLHistory
   - Migration runner (simple versioned SQL files)
   - Export to CSV for analysis

### Non-Functional
- Database file: `data/algo-trade.db` (gitignored)
- WAL mode for concurrent reads
- Prepared statements for performance

## Database Schema

```sql
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL, -- 'buy' | 'sell'
  price TEXT NOT NULL,
  size TEXT NOT NULL,
  fees TEXT DEFAULT '0',
  pnl TEXT,
  timestamp INTEGER NOT NULL,
  metadata TEXT -- JSON blob
);

CREATE TABLE positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  market TEXT NOT NULL,
  side TEXT NOT NULL, -- 'long' | 'short'
  entry_price TEXT NOT NULL,
  size TEXT NOT NULL,
  unrealized_pnl TEXT DEFAULT '0',
  opened_at INTEGER NOT NULL,
  closed_at INTEGER
);

CREATE TABLE pnl_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  strategy TEXT NOT NULL,
  equity TEXT NOT NULL,
  daily_pnl TEXT NOT NULL,
  cumulative_pnl TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);

CREATE TABLE strategy_state (
  strategy TEXT PRIMARY KEY,
  state TEXT NOT NULL, -- JSON blob
  updated_at INTEGER NOT NULL
);
```

## Implementation Steps

1. Create `src/data/database.ts`:
   - Initialize SQLite with WAL mode
   - Run migrations on startup
   - CRUD functions for each table
   - Prepared statements for hot paths
2. Create `src/data/price-feed.ts`:
   - PriceFeed class with EventEmitter
   - `addSource(name, fetchFn, interval)`
   - In-memory ring buffer for last 1000 ticks per market
   - `getLatestPrice(market)`, `getPriceHistory(market, count)`
3. Create `src/data/sentiment-feed.ts`:
   - NewsAPI polling (free tier: 100 req/day)
   - Keyword extraction + simple sentiment (positive word count vs negative)
   - Cache results to avoid duplicate API calls
4. Create barrel `src/data/index.ts`

## Todo
- [x] src/data/database.ts (SQLite + migrations)
- [x] src/data/price-feed.ts (aggregated feeds)
- [x] src/data/sentiment-feed.ts (news/social)
- [x] src/data/index.ts (barrel)
- [x] Verify: database creates correctly, migrations run

## Success Criteria
- SQLite database initializes with correct schema
- Trade CRUD operations work
- Price feed aggregates from multiple sources
- Sentiment feed returns scored results
- WAL mode enabled for performance

## Risk Assessment
- **Low risk**: SQLite is battle-tested, no network dependency
- **Risk**: Sentiment feed API keys may expire / rate limit
- **Mitigation**: Sentiment is nice-to-have, core trading works without it
