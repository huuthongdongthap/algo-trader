---
phase: 3
title: "CEX Client"
status: completed
priority: P2
effort: 4h
parallel_group: A
blocks: [6]
blocked_by: [1]
---

# Phase 3: CEX Client

## Context
- [Research: CEX/DEX](../../plans/reports/researcher-260321-1531-cex-dex-trading-strategies.md)
- [Phase 1: Core](./phase-01-core-infrastructure.md)

## Overview
Unified CEX trading client via CCXT. Supports Binance, Bybit, OKX. Handles auth, order execution, market data streaming.

## File Ownership (Exclusive)
```
src/cex/exchange-client.ts    # CCXT wrapper, multi-exchange support
src/cex/order-executor.ts     # Order execution with retry/error handling
src/cex/market-data.ts        # Price feeds, orderbook, funding rates
src/cex/index.ts              # Barrel export
```

## Key Insights
- CCXT provides unified API across 100+ exchanges
- Focus on: Binance (highest liquidity), Bybit (funding rates), OKX (grid tools)
- Rate limits vary: Binance 1200 req/min, OKX 10 req/2sec
- Auth: HMAC SHA256 for all three (OKX adds passphrase)
- Funding rates: 0.01%-0.1% every 8h (key for funding arb strategy)

## Requirements

### Functional
1. **exchange-client.ts** (~150 lines): CCXT wrapper
   - Initialize exchange connections from config
   - Support multiple exchanges simultaneously
   - Handle API key rotation
   - `getBalance()`, `getMarkets()`, `getTicker(symbol)`
2. **order-executor.ts** (~120 lines): Order execution
   - `placeLimitOrder(exchange, symbol, side, price, amount)`
   - `placeMarketOrder(exchange, symbol, side, amount)`
   - Retry on transient failures (network, rate limit)
   - Log all orders for audit trail
3. **market-data.ts** (~100 lines): Market data
   - `getOrderbook(exchange, symbol, depth)`
   - `getFundingRate(exchange, symbol)` - for perpetual futures
   - `getOHLCV(exchange, symbol, timeframe)` - candle data
   - Price comparison across exchanges (cross-exchange spread)

### Non-Functional
- Respect per-exchange rate limits (CCXT handles most)
- Graceful degradation: if one exchange fails, others continue
- All monetary values as strings (CCXT convention)

## Implementation Steps

1. Create `src/cex/exchange-client.ts`:
   - Factory pattern: `createExchange(name, config) → ccxt.Exchange`
   - Multi-exchange manager class
   - Load API keys from config
2. Create `src/cex/order-executor.ts`:
   - Wrap CCXT order methods with retry logic (from core/utils)
   - Pre-flight checks: balance sufficient, market open
   - Post-order logging
3. Create `src/cex/market-data.ts`:
   - Polling-based price feeds (configurable interval)
   - Cross-exchange price comparison
   - Funding rate fetcher for Bybit/Binance perpetuals
4. Create barrel `src/cex/index.ts`

## Todo
- [x] src/cex/exchange-client.ts (CCXT wrapper)
- [x] src/cex/order-executor.ts (order execution + retry)
- [x] src/cex/market-data.ts (prices, orderbook, funding rates)
- [x] src/cex/index.ts (barrel)
- [x] Verify: compile passes, CCXT types resolve

## Success Criteria
- Can connect to Binance/Bybit/OKX via CCXT
- Order execution with retry logic works
- Funding rates fetchable from perpetual markets
- Cross-exchange price comparison functional

## Risk Assessment
- **Low risk**: CCXT is mature, well-typed
- **Risk**: CCXT bundle size large → import only needed exchanges
- **Mitigation**: `import ccxt from 'ccxt'` then `new ccxt.binance(...)` (tree-shakeable)
