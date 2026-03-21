---
phase: 2
title: "Polymarket Client"
status: completed
priority: P1
effort: 4h
parallel_group: A
blocks: [5]
blocked_by: [1]
---

# Phase 2: Polymarket Client

## Context
- [Research: Polymarket](../../plans/reports/researcher-260321-1532-polymarket-trading-strategies.md)
- [Phase 1: Core](./phase-01-core-infrastructure.md)

## Overview
TypeScript CLOB client for Polymarket. Handles ECDSA signing, order submission, orderbook streaming via WebSocket. Replaces py-clob-client with native TS implementation.

## File Ownership (Exclusive)
```
src/polymarket/clob-client.ts      # REST API client (markets, orders, trades)
src/polymarket/orderbook-stream.ts # WebSocket orderbook streaming
src/polymarket/order-manager.ts    # Order lifecycle (create, cancel, track fills)
src/polymarket/market-scanner.ts   # Scan markets for opportunities
src/polymarket/index.ts            # Barrel export
```

## Key Insights
- CLOB API: `https://clob.polymarket.com`
- Auth: ECDSA signatures with Polygon private key (ethers.js Wallet.signMessage)
- Binary markets: YES + NO prices should sum to ~1.0
- WebSocket for real-time orderbook; REST for order submission
- Order types: GTC (Good-Till-Cancel), FOK (Fill-Or-Kill), IOC (Immediate-Or-Cancel)
- Collateral: USDC (6 decimals) on Polygon

## Requirements

### Functional
1. **clob-client.ts** (~150 lines): REST client with ECDSA auth
   - `getMarkets()` - list active markets
   - `getOrderBook(tokenId)` - current orderbook snapshot
   - `getPrice(tokenId)` - mid/bid/ask prices
   - `postOrder(orderArgs)` - submit signed limit order
   - `cancelOrder(orderId)` - cancel open order
2. **orderbook-stream.ts** (~120 lines): WebSocket connection
   - Subscribe to orderbook updates by token ID
   - Maintain local orderbook state (sorted bids/asks)
   - Emit events on significant changes (spread shift >1%)
3. **order-manager.ts** (~120 lines): Order lifecycle
   - Track open orders, pending fills
   - Handle partial fills
   - Timeout/cancel stale orders
4. **market-scanner.ts** (~100 lines): Opportunity detection
   - Scan all markets for arbitrage spreads (YES+NO != 1.0)
   - Filter by volume, liquidity depth
   - Return ranked opportunities

### Non-Functional
- Latency: Order submission <100ms
- Reconnect WebSocket on disconnect (exponential backoff via core/utils)
- Rate limit compliance (track request counts)

## Implementation Steps

1. Create `src/polymarket/clob-client.ts`:
   - Use `fetch` (Bun native) for REST calls
   - ECDSA signing via ethers.js `Wallet.signMessage`
   - Type all API responses
2. Create `src/polymarket/orderbook-stream.ts`:
   - WebSocket connection to CLOB stream endpoint
   - Local orderbook state management (sorted arrays)
   - EventEmitter pattern for updates
3. Create `src/polymarket/order-manager.ts`:
   - Order state machine: pending → open → filled/cancelled
   - Poll order status if WebSocket misses updates
4. Create `src/polymarket/market-scanner.ts`:
   - Fetch all markets, compute YES+NO spreads
   - Filter: spread > 2%, volume > $1K/day
5. Create barrel `src/polymarket/index.ts`

## API Reference

```
Base URL: https://clob.polymarket.com
GET  /markets                    → MarketInfo[]
GET  /order_book/{token_id}      → { bids: Level[], asks: Level[] }
GET  /prices/{token_id}          → { mid: string, bid: string, ask: string }
POST /order                      → { id: string, status: string }
  Body: { token_id, price, size, side, type, signature }
DELETE /order/{order_id}         → { success: boolean }
WebSocket: wss://ws-subscriptions-clob.polymarket.com/ws/market
```

## Todo
- [x] src/polymarket/clob-client.ts (REST + ECDSA signing)
- [x] src/polymarket/orderbook-stream.ts (WebSocket)
- [x] src/polymarket/order-manager.ts (order lifecycle)
- [x] src/polymarket/market-scanner.ts (arb detection)
- [x] src/polymarket/index.ts (barrel)
- [x] Verify: compile passes, types correct

## Success Criteria
- Can fetch live markets from Polymarket API
- WebSocket streams orderbook updates
- Orders signed with ECDSA and submitted
- Market scanner detects spread opportunities

## Risk Assessment
- **Medium risk**: ECDSA signing must match py-clob-client format exactly
- **Mitigation**: Test signing against known valid signatures from Python client
- **Risk**: WebSocket rate limits unknown → start conservative (1 connection, 5 subscriptions)
