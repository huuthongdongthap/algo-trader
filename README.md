# Algo-Trade RaaS Platform

[![CI](https://github.com/longtho638-jpg/algo-trader/actions/workflows/ci.yml/badge.svg)](https://github.com/longtho638-jpg/algo-trader/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](package.json)

Algorithmic trading platform targeting $1M ARR — Polymarket (80%) + CEX/DEX (20%).

---

## Features

- Polymarket CLOB integration with ECDSA signing and WebSocket orderbook streaming
- Cross-market arbitrage and market-making strategies
- CEX support via CCXT (Binance, Bybit, and more)
- DEX support via ethers.js (Ethereum, Polygon, Arbitrum) and Jupiter (Solana)
- Kelly Criterion risk manager with drawdown protection and position sizing
- Backtesting engine with historical data replay
- Paper trading mode for strategy validation
- SQLite-backed trade history and analytics
- Billing, metering, referral, and webhook modules for RaaS monetization
- CLI interface with 25 commands via Mekong-style AgentDispatcher
- 19 specialist agents including 9 dark edge agents + HFT loop for 24/7 solo operation
- AI-powered probability estimation with DeepSeek R1 ensemble voting

---

## CLI Commands

### Core Commands
```bash
algo start              # Start trading bot
algo status             # Bot status
algo backtest           # Run backtests
algo config             # View/edit configuration
algo hedge-scan         # Scan hedge opportunities
```

### Agent Commands (AgentDispatcher)
```bash
algo scan               # Scan markets for opportunities
algo monitor            # Monitor active strategies
algo estimate <question># AI probability estimation
algo risk               # Risk exposure report
algo calibrate          # Calibrate model parameters
algo report             # P&L and performance report
algo doctor             # System health check
algo agents             # List all registered agents
```

### Dark Edge Commands (Polymarket Alpha)
```bash
# P1 — Highest Edge
algo neg-risk-scan      # Scan multi-outcome events for YES sum arb
algo endgame            # Find resolving-soon markets (near-certain outcomes)
algo resolution-arb     # Detect UMA oracle challenge window opportunities
algo whale-watch        # Monitor Polygon CTF for whale movements

# P2 — Good Edge
algo event-cluster      # Cross-market correlation within events
algo volume-alert       # Volume/liquidity anomaly detection
algo split-merge-arb    # YES+NO vs $1.00 split/merge arb

# P3 — Momentum/Sentiment
algo news-snipe         # News-driven momentum detection
algo contrarian         # Herding behavior contrarian opportunities
```

### OpenClaw HFT Commands (24/7 Solo Operation)
```bash
algo seed-admin         # Register/promote admin user (--email --password)
algo warm-model         # Pre-heat DeepSeek R1 (eliminate cold-start latency)
algo hft-loop           # Continuous HFT chain: warm→scan→estimate→risk→calibrate→report (24/7)
```

---

## Quick Start

```bash
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trade
pnpm install
cp .env.example .env   # fill in your keys
pnpm start
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CLI (25 commands)                          │
│  Commander.js → AgentDispatcher → 19 Specialist Agents      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│              AgentDispatcher (Mekong-style)                  │
│  ┌─────────────┐ ┌─────────────┐ ┌──────────────────────┐  │
│  │ Core Agents │ │ Dark Edge   │ │ Dark Edge P2+P3      │  │
│  │ scan,monitor│ │ P1: neg-risk│ │ event-cluster,volume  │  │
│  │ estimate,   │ │ endgame,    │ │ split-merge,news-snipe│  │
│  │ risk,report │ │ whale-watch │ │ contrarian            │  │
│  └──────┬──────┘ └──────┬──────┘ └──────────┬───────────┘  │
└─────────┼───────────────┼───────────────────┼──────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   Strategy Engine                            │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ PM Arb       │  │ PM MM        │  │ Grid/DCA/Funding  │  │
│  │ (cross-mkt)  │  │ (bid/ask)    │  │ (CEX strategies)  │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
└─────────┼─────────────────┼───────────────────┼─────────────┘
          │                 │                   │
┌─────────▼─────────────────▼───────────────────▼─────────────┐
│                   Client Layer                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Polymarket   │  │ CEX (CCXT)   │  │ DEX (ethers.js)   │  │
│  │ CLOB Client  │  │ Binance/Bybit│  │ Uniswap/Jupiter   │  │
│  └──────────────┘  └──────────────┘  └───────────────────┘  │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   Core Layer                                 │
│  Types │ Config │ Logger │ Risk Manager │ Utils              │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                   Data Layer                                 │
│  SQLite DB │ Price Feeds │ Sentiment │ Trade History         │
└─────────────────────────────────────────────────────────────┘
```

---

## Configuration

Copy `.env.example` and fill in your credentials:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description |
|---|---|
| `POLYMARKET_API_KEY` | Polymarket CLOB API key |
| `POLYMARKET_PRIVATE_KEY` | Wallet private key for signing |
| `BINANCE_API_KEY` | Binance API key |
| `BINANCE_SECRET` | Binance secret |
| `ETH_RPC_URL` | Ethereum RPC endpoint |
| `SOLANA_RPC_URL` | Solana RPC endpoint |
| `NODE_ENV` | `development` or `production` |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| GET | `/api/status` | Engine status and active strategies |
| POST | `/api/strategies/start` | Start a strategy |
| POST | `/api/strategies/stop` | Stop a strategy |
| GET | `/api/portfolio` | Portfolio summary |
| GET | `/api/trades` | Trade history |
| POST | `/api/backtest` | Run backtest |
| GET | `/api/analytics` | P&L and performance metrics |

---

## Pricing Tiers

| Tier | Price | Strategies | Markets |
|---|---|---|---|
| Starter | $49/mo | 1 | Polymarket only |
| Pro | $149/mo | 5 | Polymarket + 1 CEX |
| Growth | $399/mo | 20 | All markets |
| Enterprise | Custom | Unlimited | All + dedicated support |

---

## Docker Deployment

```bash
# Single container
docker run -d \
  --env-file .env \
  -p 3000:3000 -p 3001:3001 -p 3002:3002 \
  longtho638-jpg/algo-trader:latest

# Docker Compose (recommended)
docker compose up -d

# With PostgreSQL
docker compose --profile postgres up -d
```

Ports:
- `3000` — REST API
- `3001` — Dashboard
- `3002` — Webhooks

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit using conventional commits: `feat: add grid trading strategy`
4. Push and open a pull request against `main`
5. Ensure CI passes before requesting review

---

## License

MIT — see [LICENSE](LICENSE) for details.
