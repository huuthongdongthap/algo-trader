# algo-trade Documentation Index

Welcome to the algo-trade RaaS platform documentation. This is your starting point for understanding the product, architecture, code, and deployment.

---

## Quick Navigation

### For Product Managers & Users
Start here to understand what algo-trade is and how it's monetized:
- **[Project Overview & PDR](./project-overview-pdr.md)** — Vision, goals, pricing tiers, success metrics

### For Architects & System Designers
Understand how the system is organized and how components interact:
- **[System Architecture](./system-architecture.md)** — Module organization, data flow, risk management, deployment

### For Developers
Learn the code standards and how to work with the codebase:
- **[Code Standards](./code-standards.md)** — TypeScript best practices, testing, commit conventions, security
- **[Codebase Summary](./codebase-summary.md)** — File structure, 44 modules, dependencies, test coverage

### For DevOps & Operations
Deploy and maintain algo-trade in production:
- **[Deployment Guide](./deployment-guide.md)** — Local setup, M1 Max production, PM2, Cloudflare Tunnel, troubleshooting

---

## Key Facts

| Aspect | Details |
|--------|---------|
| **Product** | AI-powered prediction market trading RaaS |
| **Target** | $1M ARR (Polymarket 80% + CEX/DEX 20%) |
| **Tiers** | Free ($0), Pro ($49/mo), Enterprise (custom) |
| **Tech Stack** | TypeScript, SQLite, CCXT, Ethers.js, Polar.sh |
| **Deployment** | M1 Max MacBook + PM2 + Cloudflare Tunnel |
| **Database** | SQLite (./data/algo-trade.db) |
| **Servers** | API (3000), Dashboard (3001), Webhooks (3002) |
| **Domain** | cashclaw.cc (Cloudflare) |

---

## Module Map (44 Modules)

**Core**:
- `core/` — Config, logger, risk-manager, types, utils
- `api/` — REST server, auth, rate-limiting
- `engine/` — Trading engine orchestrator

**Markets**:
- `polymarket/` — CLOB client, orderbook, trading pipeline
- `cex/` — CCXT wrapper (Binance, Bybit, OKX)
- `dex/` — Ethers.js routers (Uniswap, Jupiter)
- `kalshi/` — Event contracts

**Trading**:
- `strategies/` — Arb, MM, grid, DCA, funding-arb
- `openclaw/` — AI optimizer (11 modules)

**Monetization**:
- `billing/` — Polar.sh integration
- `metering/` — Usage tracking + quotas
- `referral/` — Referral rewards

**Operations**:
- `notifications/` — Slack, Discord, Telegram, email
- `analytics/` — Metrics, reports, tax export
- `scheduler/` — Background jobs
- `audit/` — Compliance logging
- `dashboard/` — WebSocket broadcaster
- `webhooks/` — Webhook handlers
- `trading-room/` — Conversational trading interface
- `cli/` — Command-line interface

**Utilities**:
- `admin/`, `backtest/`, `copy-trading/`, `events/`, `export/`, `license/`, `marketplace/`, `metrics/`, `ml/`, `onboarding/`, `optimizer/`, `paper-trading/`, `plugins/`, `portfolio/`, `resilience/`, `scaling/`, `sdk/`, `templates/`, `users/`, `ws/`, `wiring/`, `data/`

---

## Development Workflow

### 1. Local Setup
```bash
git clone https://github.com/your-org/algo-trade.git
cd algo-trade
pnpm install
cp .env.example .env
pnpm start
```

See [Deployment Guide](./deployment-guide.md) for detailed setup.

### 2. Code Standards
Before committing:
- Read [Code Standards](./code-standards.md)
- Keep files <200 lines
- Use kebab-case for filenames
- Write meaningful tests
- Use conventional commits

### 3. Type Safety
```bash
pnpm check       # Type check (no emit)
pnpm test        # Unit tests
pnpm build       # Compile TypeScript
```

All must pass before PR.

### 4. Deployment
See [Deployment Guide](./deployment-guide.md) for:
- Local development setup
- M1 Max production setup
- PM2 process management
- Cloudflare Tunnel networking
- Daily backups
- Monitoring & health checks

---

## Understanding the System

### Entry Points

**CLI** (`src/cli/index.ts`):
```bash
algo start           # Start trading engine
algo stop            # Graceful shutdown
algo status          # Show running strategies
algo backtest        # Run historical test
algo config          # View/edit configuration
```

**API Server** (`src/api/server.ts` on port 3000):
- `GET /api/health` — Health check
- `POST /api/strategies/start` — Start strategy
- `GET /api/trades` — Trade history
- `GET /api/portfolio` — Portfolio summary

**Dashboard** (`src/dashboard/dashboard-server.ts` on port 3001):
- Real-time P&L chart
- Active strategies view
- WebSocket live updates

**Webhooks** (`src/webhooks/webhook-server.ts` on port 3002):
- Polar.sh billing webhooks
- External signal routing
- Trade notifications

### Data Flow

```
MARKET DATA (WebSocket)
  ↓
PRICE FEED AGGREGATOR
  ↓
STRATEGY EVALUATION (signal generation)
  ↓
RISK MANAGER (position sizing, drawdown check)
  ↓
EXECUTION ROUTER (Polymarket/CEX/DEX)
  ↓
SETTLEMENT & DATABASE
  ↓
NOTIFICATIONS (Slack/Discord/WebSocket)
```

### Risk Management

Kelly Criterion position sizing + drawdown limits (20% default) + per-trade stop-loss (10%) + leverage caps (2x default).

See [System Architecture](./system-architecture.md) for details.

---

## Production Checklist

Before going live:
- [ ] All `.env` secrets configured
- [ ] Database initialized
- [ ] PM2 processes running
- [ ] Cloudflare Tunnel active + DNS resolving
- [ ] Daily backups scheduled (cron)
- [ ] Alerts configured (Slack/Discord)
- [ ] API health endpoint responding
- [ ] Rate limiting tuned per tier
- [ ] Logs rotating (pm2-logrotate)
- [ ] Disaster recovery plan tested

See [Deployment Guide](./deployment-guide.md) for full checklist.

---

## Key Files to Know

| Path | Purpose |
|------|---------|
| `src/app.ts` | Application bootstrap + shutdown |
| `src/api/server.ts` | HTTP API + middleware chain |
| `src/engine/engine.ts` | Trading engine orchestrator |
| `src/openclaw/controller.ts` | OpenClaw AI decision maker |
| `src/polymarket/trading-pipeline.ts` | PM execution pipeline |
| `src/billing/polar-webhook.ts` | Polar.sh webhook receiver |
| `src/core/risk-manager.ts` | Risk management engine |
| `src/core/logger.ts` | Structured logging |
| `package.json` | Dependencies + build config |
| `.env.example` | Required environment variables |
| `ecosystem.config.cjs` | PM2 process config |

---

## Important Patterns

### No `any` Types
```typescript
// ❌ Bad
function execute(order: any): void {}

// ✅ Good
function execute(order: Order): void {}
```

### Parameterized SQL
```typescript
// ✅ Safe from SQL injection
db.prepare('SELECT * FROM users WHERE email = ?').get(email);

// ❌ Vulnerable
db.exec(`SELECT * FROM users WHERE email = '${email}'`);
```

### Async/Await Only
```typescript
// ✅ Good
async function fetch() {
  try {
    return await api.call();
  } catch (error) {
    logger.error('Failed', 'Module', { error });
    throw error;
  }
}
```

### Structured Logging
```typescript
// ✅ Good
logger.info('Trade executed', 'TradeExecutor', {
  tradeId: '123',
  market: 'polymarket',
  pnl: 150.50,
});

// ❌ Bad
console.log('Trade executed: ' + tradeId + ' pnl: ' + pnl);
```

---

## Troubleshooting

### API server won't start
```bash
# Check if port 3000 is in use
lsof -i :3000
# Kill the process
kill -9 <PID>
```

### Database locked
```bash
# SQLite busy from backup? Restart process
pm2 restart algo-trade-api
```

### Polymarket connection fails
```bash
# Check private key format (0x + 64 hex chars)
echo $POLYMARKET_PRIVATE_KEY | wc -c  # Should be 67
```

See [Deployment Guide](./deployment-guide.md) for more troubleshooting.

---

## Testing

```bash
# Run all tests
pnpm test

# Watch mode
pnpm test:watch

# UI mode (browser)
npm run test -- --ui
```

Coverage targets: 65%+ overall (critical logic: 90%+).

---

## Continuous Integration

GitHub Actions (if configured):
- Type check: `pnpm check`
- Tests: `pnpm test`
- Build: `pnpm build`

All must pass before merge.

---

## Contact & Support

- **Technical Issues**: Create GitHub issue
- **Deployment Help**: Check [Deployment Guide](./deployment-guide.md)
- **Architecture Questions**: Review [System Architecture](./system-architecture.md)
- **Code Review**: Follow [Code Standards](./code-standards.md)

---

## Version

- **algo-trade**: 0.1.0 (beta)
- **Node.js**: 20.x
- **TypeScript**: 5.9
- **SQLite**: 3.x
- **Polar.sh SDK**: 0.46.6

---

## Last Updated

March 21, 2026

---

## Table of Contents for All Documents

1. [Project Overview & PDR](./project-overview-pdr.md) — 200 lines
2. [System Architecture](./system-architecture.md) — 300 lines
3. [Deployment Guide](./deployment-guide.md) — 200 lines
4. [Code Standards](./code-standards.md) — 150 lines
5. [Codebase Summary](./codebase-summary.md) — 200 lines
6. [This Index](./index.md) — Quick reference

**Total Documentation**: ~1,250 lines of comprehensive guides.
