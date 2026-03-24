# System Architecture

## High-Level Module Organization

```
algo-trade RaaS Platform
├── CLI Layer (src/cli/)
│   ├─ Command interface (Commander.js)
│   ├─ Dashboard terminal UI
│   └─ Setup wizard
│
├── API Server (src/api/)
│   ├─ HTTP server (Node.js native)
│   ├─ Auth middleware (JWT)
│   ├─ Rate limiting
│   ├─ CORS policy
│   └─ Route handlers
│
├── Dashboard Server (src/dashboard/)
│   ├─ WebSocket broadcaster
│   ├─ Live metrics (P&L, portfolio)
│   └─ Real-time UI updates
│
├── Webhook Server (src/webhooks/)
│   ├─ Polar.sh billing webhooks
│   ├─ Signal parser (TradingView, etc)
│   ├─ Batch resolution checker (Polymarket outcomes)
│   └─ Execution router
│
├── Trading Engine (src/engine/)
│   ├─ Strategy runner (concurrent)
│   ├─ Trade executor
│   └─ Orchestrator
│
├── Market Clients
│   ├─ Polymarket CLOB (WebSocket)
│   ├─ CEX (CCXT wrapper)
│   ├─ DEX (ethers.js)
│   └─ Kalshi
│
├── Strategies (src/strategies/)
│   ├─ Polymarket (arb, MM)
│   └─ CEX/DEX (grid, DCA, funding-arb)
│
├── OpenClaw AI (src/openclaw/) — DeepSeek R1 + think block handling
│   ├─ Decision controller (120s timeout)
│   ├─ Algorithm tuner (parses DeepSeek <think> blocks)
│   ├─ AI signal generator (think block stripping)
│   ├─ Risk adjuster (reason field support)
│   └─ Performance analyzer
│
└── Supporting Modules
    ├─ Billing (Polar.sh)
    ├─ Metering (quotas)
    ├─ Analytics (reports)
    ├─ Shared Utilities (LLM response parser)
    ├─ Notifications (alerts)
    └─ Monitoring (metrics)
```

## Data Flow: Order → Execution → Settlement

```
MARKET DATA ──→ PRICE FEED ──→ STRATEGY EVAL ──→ RISK CHECK ──→ EXECUTE
   (Prices)     (Aggregator)   (Signals)        (Limits)     (Markets)
                                                                 │
                                          ┌─────────────────────┘
                                          ▼
                            SETTLEMENT ──→ DB ──→ NOTIFY (Slack/WebSocket)
```

## LLM Integration & Response Parsing

**Model Routing** (via OpenClaw):
- **Simple**: Qwen 2.5 Coder (quick pattern recognition)
- **Standard**: DeepSeek R1 (trade analysis, performance review)
- **Complex**: DeepSeek R1 (strategy optimization, risk assessment)

**Timeout Configuration**:
- Primary (DeepSeek R1): 90s (via `llm-config.ts`)
- OpenClaw gateway: 120s (`openclaw-config.ts`)
- Cloud (Claude): 60s with daily budget gating

**Response Handling**:
- `src/lib/llm-response-parser.ts` centralized utility
- Strips DeepSeek R1 `<think>...</think>` blocks automatically
- Extracts JSON objects, handles markdown fences
- All 6 LLM modules use shared parser (ai-signal-generator, ai-risk-adjuster, prediction-probability-estimator, algorithm-tuner, ai-strategy-selector)
- Supports `reasoning` field for chain-of-thought models

## Risk Management Flow

**Kelly Criterion Position Sizing**:
- Calculates optimal position size based on historical win rate
- Conservative multiplier (0.25x) to account for model uncertainty
- Updated monthly from trade history

**Drawdown Protection** (default: 20% max):
- Track daily peak portfolio value
- Pause new strategies if drawdown exceeded
- Allow position closing only (circuit breaker)

**Per-Trade Stop-Loss**: 10% maximum loss
**Leverage Enforcement**: 2x maximum

## Database Schema (SQLite)

Key tables:
- `users` — User accounts + subscription tier
- `subscriptions` — Polar.sh billing lifecycle
- `strategies` — Active/paused strategies + config
- `trades` — Executed trades (immutable)
- `positions` — Current open positions
- `usage_logs` — API call metering per user/tier
- `audit_logs` — Compliance logging (all trades + access)
- `portfolio_state` — Aggregated P&L + metrics

## Event Bus (Pub/Sub)

All state changes flow through central event bus:

**Strategy Events**: StrategyStarted, StrategyEnded
**Trade Events**: TradeInitiated, OrderPlaced, OrderFilled, TradeSettled
**Risk Events**: RiskViolation (drawdown/leverage/position)
**Billing Events**: SubscriptionChanged, APICallLimited
**System Events**: HealthAlert, ConnectionLost

**Subscribers**: EventLogger, DatabaseWriter, MetricsCollector, NotificationRouter, DashboardBroadcaster, AuditLogger

## Execution Lifecycle

1. **Load strategy** config + state from DB
2. **Market subscription** to price feeds (WebSocket/polling)
3. **Signal generation** (~1s ticks): rule-based + AI conditions
4. **Risk validation**: position size, drawdown, leverage
5. **Order placement**: route to Polymarket/CEX/DEX with slippage protection
6. **Settlement tracking**: poll for fills, calculate P&L
7. **State persistence**: update DB, emit events, notify users

## Authentication

**JWT Flow**:
- User login → generate JWT {sub: user_id, tier, exp}
- Client includes in Authorization header
- Middleware verifies signature + tier-based access control

**API Key** (legacy):
- User generates from dashboard
- Hash stored in DB
- Middleware validates X-API-Key header

**Tier-Based Limits**:
- Free: 1 strategy, Polymarket only, 10 req/s
- Pro: 5 strategies, 1 CEX, 100 req/s
- Enterprise: unlimited, all markets, 1000 req/s

## Deployment (M1 Max)

```
PM2 Process Manager
├─ algo-trade-api (4 cluster workers, port 3000)
├─ algo-trade-dashboard (1 worker, port 3001)
├─ algo-trade-webhook (1 worker, port 3002)
└─ algo-trade-engine (1 worker, in-process trading)

Network:
- Local: 127.0.0.1:3000,3001,3002
- Public: Cloudflare Tunnel (cashclaw.cc)
- DNS: Cloudflare (MX, TXT for email)

Data:
- SQLite: ./data/algo-trade.db
- Backups: Daily at 2 AM → S3 (weekly retention)
- Recovery: Point-in-time restore from backup
```

## Module Index

**44 modules** across 14 domains:

| Domain | Count | Key Modules |
|--------|-------|------------|
| api | 4 | server, routes, auth, rate-limiter |
| core | 5 | config, logger, risk-manager, types, utils |
| polymarket | 7 | clob-client, orderbook-stream, trading-pipeline, order-manager |
| strategies | 6 | cross-market-arb, market-maker, grid-trading, dca-bot, funding-arb |
| engine | 3 | engine, strategy-runner, trade-executor |
| openclaw | 11 | controller, ai-router, algorithm-tuner, performance-analyzer |
| data | 4 | database, price-feed, sentiment-feed, price-feed |
| billing | 6 | polar-client, polar-webhook, subscription-manager, invoice-tracker |
| notifications | 7 | notification-router, slack-webhook, discord-webhook, telegram-bot, email-sender |
| trading-room | 12 | command-registry, command-parser, room-commands, telegram-controller |
| cex | 3 | exchange-client, market-data, order-executor |
| dex | 3 | evm-client, solana-client, swap-router |
| analytics | 3 | performance-metrics, report-exporter, tax-reporter |
| scheduler | 3 | job-scheduler, job-registry, job-history |
| scripts | 2 | check-batch-resolutions (monitor Polymarket outcomes) |
| lib | 1 | llm-response-parser (DeepSeek R1 think block handling) |

## Scaling Constraints

**Current (Single Instance)**:
- Max ~100 concurrent strategies (CPU-bound)
- Max ~50 orders/sec (Polymarket CLOB limits)
- Max ~2GB SQLite file size

**Future (Post-$1M ARR)**:
- PostgreSQL (multi-instance)
- Kafka/RabbitMQ (decoupling strategy pipeline)
- Redis (price feed cache + sessions)
- HAProxy (load balancing)
- Prometheus + Grafana monitoring

## Known Limitations

1. Single-instance deployment (no horizontal scaling)
2. SQLite concurrency (single writer assumption)
3. Polymarket rate limits (needs request batching)
4. DEX MEV protection (future: 1Inch API)
5. Backtesting (historical data loading incomplete)
6. Multi-tenant RLS (basic user isolation, no row-level security)

## Recovery & Disaster

| Failure Mode | Recovery |
|--------------|----------|
| Network outage | Reconnect every 5s, pause new orders, alert operator |
| Strategy crash | Catch exception, save state, pause strategy, notify user |
| DB corruption | Detect on startup, restore from backup (max 24h data loss) |
| Hardware failure | Restore from S3 daily backup on new M1 Max (<1h downtime) |
