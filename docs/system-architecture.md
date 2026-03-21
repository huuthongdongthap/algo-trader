# System Architecture - Algo-Trade RaaS Platform

## Overview
Algorithmic trading platform targeting $1M ARR. Polymarket (80% revenue) + CEX/DEX (20%).
TypeScript monorepo, Bun runtime, modular strategy engine.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CLI Interface                          │
│  algo start | algo stop | algo status | algo backtest       │
└──────────────────────────┬──────────────────────────────────┘
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

## Directory Structure

```
algo-trade/
├── src/
│   ├── core/                    # Shared foundation
│   │   ├── types.ts             # All TypeScript interfaces
│   │   ├── config.ts            # Env config loader
│   │   ├── logger.ts            # Structured JSON logger
│   │   ├── risk-manager.ts      # Kelly Criterion, drawdown, position sizing
│   │   ├── utils.ts             # Retry, sleep, formatting
│   │   └── index.ts             # Barrel export
│   ├── polymarket/              # Polymarket CLOB integration
│   │   ├── clob-client.ts       # REST API + ECDSA signing
│   │   ├── orderbook-stream.ts  # WebSocket orderbook
│   │   ├── order-manager.ts     # Order lifecycle
│   │   ├── market-scanner.ts    # Opportunity detection
│   │   └── index.ts
│   ├── cex/                     # CEX via CCXT
│   │   ├── exchange-client.ts   # Multi-exchange wrapper
│   │   ├── order-executor.ts    # Order execution + retry
│   │   ├── market-data.ts       # Prices, funding rates
│   │   └── index.ts
│   ├── dex/                     # DEX via ethers.js + Solana
│   │   ├── evm-client.ts        # Ethereum/Polygon/Arbitrum
│   │   ├── solana-client.ts     # Solana + Jupiter
│   │   ├── swap-router.ts       # Unified swap interface
│   │   └── index.ts
│   ├── strategies/              # Trading strategies
│   │   ├── polymarket/
│   │   │   ├── cross-market-arb.ts
│   │   │   └── market-maker.ts
│   │   └── cex-dex/
│   │       ├── grid-trading.ts
│   │       ├── dca-bot.ts
│   │       └── funding-rate-arb.ts
│   ├── data/                    # Data & storage
│   │   ├── price-feed.ts
│   │   ├── sentiment-feed.ts
│   │   ├── database.ts
│   │   └── index.ts
│   └── cli/                     # CLI interface
│       ├── index.ts
│       ├── commands/
│       │   ├── start.ts
│       │   ├── stop.ts
│       │   ├── status.ts
│       │   ├── backtest.ts
│       │   └── config.ts
│       └── dashboard.ts
├── tests/                       # Vitest test suite
├── data/                        # SQLite DB files (gitignored)
├── docs/
└── plans/
```

## Data Flow

### Order Execution Flow
```
Strategy detects opportunity
  → Risk Manager validates (position size, drawdown check)
  → Client submits order (Polymarket/CEX/DEX)
  → Order fills (confirmed via WebSocket or polling)
  → Database records trade
  → P&L updated
  → Logger writes structured log
```

### Polymarket Arb Flow
```
WebSocket receives orderbook update
  → Market Scanner calculates spread: 1 - YES_ask - NO_ask
  → If spread > threshold (2%):
    → Risk Manager approves position size
    → Order Manager: BUY YES + BUY NO atomically
    → Track position until settlement
    → Profit = spread - gas - fees
```

## Technology Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Fast startup, native TS, built-in test runner fallback |
| CEX API | CCXT | Unified API for 100+ exchanges, well-typed |
| DEX EVM | ethers.js v6 | Industry standard, excellent TS support |
| DEX Solana | @solana/web3.js | Official SDK, Jupiter integration |
| Polymarket | Custom TS client | Avoid Python subprocess overhead |
| Database | SQLite (better-sqlite3) | Zero-config, fast for single-node bot |
| CLI | Commander.js | Standard, lightweight, good help generation |
| Testing | Vitest | Fast, Bun-compatible, good mocking |

## Risk Management Architecture

```
Risk Manager (src/core/risk-manager.ts)
├── Kelly Criterion: f* = (bp - q) / b
│   - Optimal position sizing based on win probability
├── Max Drawdown: 20% portfolio, 5% per position
│   - Auto-pause strategies on breach
├── Stop-Loss: Configurable per strategy
│   - Hard stop at 10% loss per trade
└── Position Limits
    - Max concurrent positions per strategy
    - Max total exposure across all strategies
```

## Scaling Path

1. **Phase 1 (Current)**: Single-node bot, SQLite, CLI
2. **Phase 2**: PostgreSQL, multi-bot instances, VPS deployment
3. **Phase 3**: Web dashboard, user accounts, API gateway
4. **Phase 4**: Multi-tenant RaaS platform, managed strategies
