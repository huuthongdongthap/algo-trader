---
phase: 5
title: "Polymarket Strategies"
status: completed
priority: P1
effort: 4h
parallel_group: B
blocks: [9]
blocked_by: [1, 2]
---

# Phase 5: Polymarket Strategies

## Context
- [Research: Polymarket](../../plans/reports/researcher-260321-1532-polymarket-trading-strategies.md)
- [Phase 2: Polymarket Client](./phase-02-polymarket-client.md)

## Overview
Core revenue generators (80% of platform). Two strategies:
1. **Cross-Market Arbitrage** - exploit YES+NO pricing inefficiencies (60-100% win rate)
2. **Market Making** - passive spread harvesting (40-60% win rate)

## File Ownership (Exclusive)
```
src/strategies/polymarket/cross-market-arb.ts   # Arbitrage strategy
src/strategies/polymarket/market-maker.ts        # Market making strategy
src/strategies/polymarket/index.ts               # Barrel export
```

## Key Insights
- Binary markets: YES_price + NO_price = 1.0 in equilibrium
- When spread > 2% (YES=0.65, NO=0.40 → gap=0.05), execute atomic arb
- Market making: place bid/ask at mid +/- 0.5-1% spread, harvest fills
- Capital: Arb needs $10-50K, MM needs $50-200K (tied in orderbook)
- Latency critical: <100ms for arb execution

## Requirements

### Functional
1. **cross-market-arb.ts** (~180 lines): Arbitrage engine
   - Monitor all binary markets via orderbook stream
   - Detect spread opportunities: `1 - YES_best_ask - NO_best_ask > threshold`
   - Execute atomic: BUY YES + BUY NO when profitable (locked profit)
   - Factor in: gas costs (~0.1-0.5 USDC), slippage, orderbook depth
   - Position tracking: track arb positions, flatten before settlement
   - Configurable: min spread threshold, max position size, markets whitelist/blacklist
2. **market-maker.ts** (~150 lines): MM engine
   - Place passive bid/ask orders around midpoint
   - Dynamic spread: wider in volatile markets, tighter in stable
   - Inventory management: skew quotes when position builds up
   - Auto-cancel and refresh stale orders (configurable interval)
   - P&L tracking per market

### Non-Functional
- Both strategies implement common `Strategy` interface from core/types
- Each strategy runs as independent async loop
- Graceful shutdown: cancel all open orders on stop signal

## Strategy Interface (from core)

```typescript
interface Strategy {
  name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): StrategyStatus;
  getPnL(): PnLSummary;
}
```

## Implementation Steps

1. Create `src/strategies/polymarket/cross-market-arb.ts`:
   - Subscribe to all binary market orderbooks (via Phase 2 orderbook-stream)
   - Spread detector loop (runs every tick)
   - Execution: simultaneous order placement for YES + NO
   - P&L calculation: entry spread - gas - slippage = net profit
   - Logging: every opportunity detected + executed/skipped
2. Create `src/strategies/polymarket/market-maker.ts`:
   - Calculate midpoint from orderbook
   - Place GTC orders: bid at mid - spread/2, ask at mid + spread/2
   - Monitor fills, update inventory
   - Rebalance: if inventory > threshold, skew quotes to reduce exposure
   - Periodic refresh: cancel + replace orders every N seconds
3. Create barrel `src/strategies/polymarket/index.ts`

## Arb Detection Logic

```
for each binary market:
  yes_ask = best ask price for YES token
  no_ask = best ask price for NO token
  spread = 1.0 - yes_ask - no_ask
  cost = gas_estimate + (yes_ask * slippage) + (no_ask * slippage)
  net_profit = spread - cost
  if net_profit > min_threshold:
    execute_arb(market, yes_ask, no_ask, size)
```

## Todo
- [x] src/strategies/polymarket/cross-market-arb.ts
- [x] src/strategies/polymarket/market-maker.ts
- [x] src/strategies/polymarket/index.ts
- [x] Verify: compile passes, strategy interface implemented

## Success Criteria
- Arb strategy detects spread opportunities from live orderbook
- Arb executes atomic YES+NO trades when profitable
- MM places and manages bid/ask orders
- Both strategies implement Strategy interface
- Graceful shutdown cancels all open orders

## Risk Assessment
- **High risk (arb)**: Timing-sensitive, stale orderbook data = loss
- **Mitigation**: Use WebSocket (not REST polling), validate orderbook freshness
- **Medium risk (MM)**: Adverse selection (informed traders pick off stale quotes)
- **Mitigation**: Dynamic spread widening on volume spikes
