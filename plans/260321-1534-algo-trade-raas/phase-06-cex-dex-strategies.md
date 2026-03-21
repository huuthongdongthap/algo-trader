---
phase: 6
title: "CEX/DEX Strategies"
status: completed
priority: P2
effort: 4h
parallel_group: B
blocks: [9]
blocked_by: [1, 3, 4]
---

# Phase 6: CEX/DEX Strategies

## Context
- [Research: CEX/DEX](../../plans/reports/researcher-260321-1531-cex-dex-trading-strategies.md)
- [Phase 3: CEX Client](./phase-03-cex-client.md)
- [Phase 4: DEX Client](./phase-04-dex-client.md)

## Overview
Three CEX/DEX strategies (20% of platform revenue):
1. **Grid Trading** - automated buy/sell within price range (40-50% APY)
2. **DCA Bot** - dollar-cost averaging on schedule (15-25% APY, lowest risk)
3. **Funding Rate Arbitrage** - long spot + short perp, pocket funding (12-36% APY)

## File Ownership (Exclusive)
```
src/strategies/cex-dex/grid-trading.ts      # Grid trading strategy
src/strategies/cex-dex/dca-bot.ts            # DCA bot strategy
src/strategies/cex-dex/funding-rate-arb.ts   # Funding rate arbitrage
src/strategies/cex-dex/index.ts              # Barrel export
```

## Requirements

### Functional
1. **grid-trading.ts** (~150 lines):
   - Config: symbol, price range (upper/lower), grid count (10-50), amount per grid
   - Place buy orders below current price, sell orders above
   - On fill: place opposite order at next grid level
   - Track filled grids, total profit
   - Works on any CEX via exchange-client
2. **dca-bot.ts** (~100 lines):
   - Config: symbol, amount per buy, interval (hourly/daily/weekly)
   - Execute market buy at scheduled intervals
   - Track average entry price, total invested, current P&L
   - Support multiple assets simultaneously
3. **funding-rate-arb.ts** (~150 lines):
   - Monitor funding rates across Binance/Bybit/OKX
   - When rate > threshold: open spot long + perpetual short (delta neutral)
   - Collect funding payments every 8h
   - Close when rate normalizes or reverses
   - Track: total funding collected, unrealized P&L from basis drift

### Non-Functional
- All strategies implement `Strategy` interface from core
- Grid trading: handle exchange reconnection gracefully (restore grid state)
- DCA: persist schedule state to survive restarts

## Implementation Steps

1. Create `src/strategies/cex-dex/grid-trading.ts`:
   - Calculate grid levels: `levels = linspace(lowerPrice, upperPrice, gridCount)`
   - Place initial orders via cex/order-executor
   - On fill callback: place opposite order
   - State management: track which grids are filled/open
2. Create `src/strategies/cex-dex/dca-bot.ts`:
   - Scheduling via setTimeout/setInterval (Bun native)
   - Execute market buy via cex/order-executor
   - Track running average: `avgPrice = totalCost / totalAmount`
3. Create `src/strategies/cex-dex/funding-rate-arb.ts`:
   - Poll funding rates via cex/market-data
   - Entry logic: spot buy + perp short when rate > 0.05%/8h
   - Exit logic: close both legs when rate < 0.01%/8h
   - P&L: sum of funding payments - trading fees - basis drift
4. Create barrel `src/strategies/cex-dex/index.ts`

## Todo
- [x] src/strategies/cex-dex/grid-trading.ts
- [x] src/strategies/cex-dex/dca-bot.ts
- [x] src/strategies/cex-dex/funding-rate-arb.ts
- [x] src/strategies/cex-dex/index.ts
- [x] Verify: compile passes, strategy interface implemented

## Success Criteria
- Grid trading places orders at calculated levels
- DCA executes scheduled buys
- Funding rate arb detects profitable rates and opens delta-neutral positions
- All strategies implement Strategy interface
- State persists across restarts (at minimum: open orders, positions)

## Risk Assessment
- **Medium risk (grid)**: Strong trends break grid profitability
- **Mitigation**: Auto-pause grid if price breaks range by >10%
- **Low risk (DCA)**: Simple, well-understood strategy
- **Medium risk (funding arb)**: Basis drift can exceed funding income
- **Mitigation**: Stop-loss on combined position P&L
