# Database Schema

## Storage Overview

| Store | Type | Purpose |
|-------|------|---------|
| PostgreSQL | Relational DB | Trades, P&L, audit logs |
| Redis | In-memory / KV | Paper trading state, signals cache, pubsub |
| JSON file (`data/licenses.json`) | File | License records (persistent) |

---

## PostgreSQL Tables

### `trades`
Arbitrage execution records.

| Column | Type | Description |
|--------|------|-------------|
| id | VARCHAR PK | Unique execution ID |
| opportunity_id | VARCHAR | Source arbitrage opportunity |
| execution_id | VARCHAR | Internal executor run ID |
| symbol | VARCHAR | Trading pair (e.g. BTC/USDT) |
| buy_exchange | VARCHAR | Exchange where BUY was placed |
| sell_exchange | VARCHAR | Exchange where SELL was placed |
| buy_price | NUMERIC | Executed buy price |
| sell_price | NUMERIC | Executed sell price |
| amount | NUMERIC | Trade size |
| spread_percent | NUMERIC | Spread at execution time (%) |
| profit | NUMERIC | Net profit after fees |
| fee | NUMERIC | Total fees paid |
| status | VARCHAR | FILLED / PARTIAL / FAILED / ROLLBACK |
| created_at | BIGINT | Unix ms timestamp |
| updated_at | BIGINT | Unix ms timestamp |

---

## Redis Keys

### Paper Trading (DryRunExecutor)

| Key | Type | Description |
|-----|------|-------------|
| `paper_trading:account` | String (JSON) | Virtual balance, equity, P&L totals |
| `paper_trading:positions` | String (JSON) | Open positions array |
| `paper_trading:trades` | List (JSON) | Trade history (capped at 1000) |

### Signals Cache (SpreadDetector)

| Key pattern | Type | Description |
|-------------|------|-------------|
| `arbitrage:*` | Hash | Arbitrage opportunity fields (symbol, spread, prices, latency) |

---

## JSON File Store

### `data/licenses.json`
Persistent license records (replaces in-memory Map on restart).

| Field | Type | Description |
|-------|------|-------------|
| id | string | `lic_` prefixed unique ID |
| name | string | Human-readable license name |
| key | string | `RAAS-<tier>-<seg1>-<seg2>` format |
| tier | enum | FREE / PRO / ENTERPRISE |
| status | enum | active / expired / revoked |
| createdAt | ISO string | Creation timestamp |
| updatedAt | ISO string | Last update timestamp |
| usageCount | number | API call counter |
| maxUsage | number | Usage cap per tier (100/10k/100k) |
| tenantId | string? | Multi-tenant identifier |
| domain | string? | Allowed domain restriction |
| expiresAt | ISO string? | Expiry date (null = never) |
| subscriptionId | string? | Polar.sh subscription ID link |
