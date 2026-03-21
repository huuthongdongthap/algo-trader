# Project Overview & Product Development Requirements

## Executive Summary

**algo-trade RaaS** is an AI-powered, SaaS algorithmic trading platform targeting $1M ARR. Monetization leverages 3-tier subscription (Free/Pro/Enterprise) via Polar.sh payments, with market allocation: Polymarket (80%) + CEX/DEX (20%).

Core differentiator: **OpenClaw AI** for real-time strategy optimization, automated decision-making, and predictive market analysis.

---

## Product Vision

### Primary Goals
- Automate algo trading for retail + institutional users
- 80% Polymarket prediction market exposure (high-growth vertical)
- 20% CEX/DEX for diversification and yield opportunities
- Achieve $1M ARR by Q4 2026

### Success Metrics
- 500+ active users (Pro+ tier)
- 95%+ strategy win rate (market-dependent)
- <100ms order latency (Polymarket CLOB + CEX)
- $100k+ monthly trading volume

---

## Product Tiers

### Free Tier
- 1 active strategy
- Polymarket only
- 10 open positions max
- Community support
- $0/mo

### Pro Tier
- 5 concurrent strategies
- Polymarket + 1 CEX (Binance/Bybit/OKX)
- 50 open positions max
- Email support
- Priority webhook rate: 1000 req/s
- $49/mo (via Polar.sh)

### Enterprise Tier
- Unlimited strategies
- All markets (Polymarket + all CEX/DEX)
- Unlimited positions
- Dedicated Slack support
- VIP webhook rate: 10,000 req/s
- Custom billing (quarterly/annual)
- API SLA: 99.99%

---

## Core Features

### Market Integration
- **Polymarket CLOB**: ECDSA signing, orderbook streaming, real-time price feeds
- **CEX (CCXT)**: Binance, Bybit, OKX, Kucoin, Kraken
- **DEX (Ethers.js)**: Uniswap, 1Inch, Jupiter (Solana)

### Trading Strategies
- Cross-market arbitrage (Polymarket ↔ CEX/DEX price diff)
- Market-maker (bid/ask spread collection)
- Grid trading (DCA bot for CEX accumulation)
- Funding-rate arb (long CEX, short perp)
- Copy trading (follow leader positions)

### Risk Management
- Kelly Criterion position sizing
- Drawdown limits (default: 20% max)
- Stop-loss enforcement (10% per trade)
- Max leverage caps (2x default)
- Real-time P&L tracking + circuit breakers

### Analytics & Insights
- Win-rate tracker (% profitable trades)
- Sharpe/Sortino ratio calculation
- Max drawdown analysis
- Performance per strategy/market
- Tax reporting (CSV export)

### Monetization Modules
- **Metering**: API call usage tracking + quota enforcement per tier
- **Billing**: Polar.sh webhook integration for subscription lifecycle
- **Referral**: 20% commission structure for user acquisition
- **Trading Fees**: 0.1% execution fee (optional, future)

---

## Technical Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Language** | TypeScript 5.9 + ESM | Type safety, modern modules |
| **Database** | SQLite (better-sqlite3) | Trade history, users, subscriptions |
| **Market APIs** | CCXT 4.4, Ethers.js 6.13 | CEX/DEX order routing |
| **Polymarket** | Custom CLOB client | Prediction market execution |
| **Billing** | Polar.sh SDK 0.46.6 | Subscription + webhook mgmt |
| **AI Engine** | OpenClaw (custom) | Strategy optimization + signals |
| **Notifications** | Discord/Slack/Telegram | Real-time trade alerts |
| **Monitoring** | Prometheus + Grafana | Performance metrics |
| **Deployment** | PM2 + Cloudflare Tunnel | M1 Max production, DNS routing |

---

## Architecture Layers

```
┌─────────────────────────────────────────────────┐
│  API Server (port 3000)                         │
│  ├─ User auth + JWTs                            │
│  ├─ REST endpoints (/strategies, /trades, etc)  │
│  └─ Rate limiting + CORS                        │
├─────────────────────────────────────────────────┤
│  Dashboard (port 3001)                          │
│  ├─ Live portfolio view                         │
│  ├─ P&L charts + strategy metrics               │
│  └─ WebSocket real-time updates                 │
├─────────────────────────────────────────────────┤
│  Webhook Server (port 3002)                     │
│  ├─ Polar.sh billing webhooks                   │
│  ├─ Trade signal routing                        │
│  └─ Signal parser + execution                   │
├─────────────────────────────────────────────────┤
│  Trading Engine (in-process)                    │
│  ├─ Strategy runner (concurrent)                │
│  ├─ Risk manager (position + drawdown)          │
│  └─ Trade executor (order routing)              │
├─────────────────────────────────────────────────┤
│  Client Layer                                   │
│  ├─ Polymarket CLOB client (WebSocket)          │
│  ├─ CEX exchange clients (REST + WebSocket)     │
│  └─ DEX router (ethers.js providers)            │
├─────────────────────────────────────────────────┤
│  Data Layer                                     │
│  ├─ SQLite trade history + users                │
│  ├─ Price feeds (real-time)                     │
│  ├─ Sentiment feeds (Twitter/Telegram)          │
│  └─ ML signal generation                        │
└─────────────────────────────────────────────────┘
```

---

## Key Entry Points

| File | Purpose |
|------|---------|
| `src/app.ts` | Application bootstrap + shutdown orchestration |
| `src/cli/index.ts` | CLI entry point (start/stop/status/backtest) |
| `src/api/server.ts` | REST API server + CORS + auth middleware |
| `src/engine/engine.ts` | Trading engine — orchestrates all trading logic |
| `src/openclaw/controller.ts` | OpenClaw AI decision controller |
| `src/polymarket/trading-pipeline.ts` | Polymarket execution pipeline |
| `src/billing/polar-webhook.ts` | Polar.sh billing webhook receiver |

---

## Module Count & Stats

- **44 modules** across 14 domains
- **4,200+ lines** of TypeScript (excluding tests)
- **23 strategies** (Polymarket + CEX/DEX combinations)
- **3 servers** (API, Dashboard, Webhooks)

Domains: `api`, `admin`, `analytics`, `audit`, `backtest`, `billing`, `cex`, `cli`, `copy-trading`, `core`, `dashboard`, `data`, `dex`, `engine`, `events`, `export`, `kalshi`, `license`, `marketplace`, `metering`, `metrics`, `ml`, `notifications`, `onboarding`, `openclaw`, `optimizer`, `paper-trading`, `plugins`, `polymarket`, `portfolio`, `referral`, `resilience`, `scaling`, `scheduler`, `sdk`, `strategies`, `templates`, `trading-room`, `users`, `webhooks`, `wiring`, `ws`.

---

## Development Roadmap (Q1-Q4 2026)

### Q1: Launch & Traction
- Beta launch (50 closed users)
- Polymarket trading ops stable
- Billing automation live
- $5k MRR target

### Q2: Market Expansion
- CEX full integration (Binance/Bybit)
- Copy trading feature
- Kalshi markets (political betting)
- $20k MRR target

### Q3: AI Enhancement
- OpenClaw tuning automation
- ML-based signal generation
- Strategy marketplace launch
- $50k MRR target

### Q4: Scale & Enterprise
- Enterprise tier sales
- 99.99% SLA guarantee
- Team management features
- $1M ARR target

---

## Non-Functional Requirements

### Performance
- API response time: <100ms (p95)
- Order execution: <500ms (market-dependent)
- WebSocket latency: <50ms
- Dashboard refresh: <1s

### Reliability
- 99.9% uptime (production)
- Graceful degradation (fallback strategies)
- Auto-recovery from network failures
- Circuit breaker pattern for external APIs

### Security
- JWT-based auth (RS256)
- Private key encryption at rest
- Rate limiting (IP + API key)
- SQL injection protection (parameterized queries)
- CORS whitelist enforcement
- Audit logging for all trades + API access

### Compliance
- Trade history immutability (audit logs)
- Tax reporting (CSV export)
- User data retention (GDPR-ready)
- Terms of Service enforcement

---

## Constraints & Assumptions

### Constraints
- M1 Max MacBook Pro production deployment (limited scaling)
- Single-instance SQLite (no distributed DB)
- Polymarket CLOB rate limits (100 req/s)
- CEX API rate limits (varies per exchange)

### Assumptions
- Users have valid exchange API keys
- Network connectivity to all markets maintained
- User strategies are profitable (risk-adjusted)
- Compliance handled by user (no legal advice)

---

## Success Criteria (Phase 1)

1. ✅ 100 active users (Pro+ tier)
2. ✅ $10k MRR (Q2 2026)
3. ✅ Zero unplanned downtime (30 days)
4. ✅ 95%+ strategy win rate
5. ✅ <100ms API latency (p95)

---

## Next Steps

1. **Beta launch**: Invite 50 users (early access)
2. **Polymarket ops**: Validate all strategies in live market
3. **Billing ops**: Test Polar.sh webhook lifecycle
4. **Monitoring**: Deploy Prometheus + Grafana
5. **Analytics**: Build dashboard insights
