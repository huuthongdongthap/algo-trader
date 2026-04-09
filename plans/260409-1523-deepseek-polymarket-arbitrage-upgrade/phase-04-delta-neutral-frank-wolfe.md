# Phase 04: Delta-Neutral Volatility Arbitrage + Frank-Wolfe Multi-Leg Optimizer

## Context Links
- [PDF Section 3.4 Tier 3-4](../../Desktop/DeepSeek%20-%20Vào%20Nơi%20Bí%20Ẩn.pdf)
- [Gabagool Pattern](https://github.com/coleschaffer/Gabagool)
- [Existing Vol Strategy](../../src/strategies/polymarket/)

## Overview
- **Priority**: P2
- **Status**: completed
- **Parallel Group**: C (after Phase 03)

Two components:
1. **Delta-Neutral**: Maintain market-neutral positions across correlated markets, profit from volatility
2. **Frank-Wolfe**: Gradient-based optimizer for multi-leg execution path (minimize slippage + fees)

## Key Insights
- Delta-neutral: buy YES on Market A + NO on correlated Market B → hedged position
- Frank-Wolfe algorithm: iterative projection-free optimization for constrained problems
- Gabagool pattern: position merger reduces gas, dynamic rebalancing on price moves
- This is the most advanced tier — only for validated correlated markets from Phase 02/03

## Requirements
### Functional
- Delta-neutral position constructor given correlation matrix
- Rebalancing trigger when delta exceeds threshold (e.g., |delta| > 0.1)
- Frank-Wolfe optimizer: given multi-leg basket → optimal execution sequence
- Minimize: total slippage + gas costs + timing risk

### Non-functional
- Rebalance check every 30s
- Frank-Wolfe converge in < 100ms for 10-leg baskets
- Paper trading mode mandatory before live

## Related Code Files
### Create
- `src/strategies/polymarket/delta-neutral-volatility-arbitrage.ts` — strategy class
- `src/strategies/polymarket/delta-calculator.ts` — compute portfolio delta
- `src/strategies/polymarket/rebalance-engine.ts` — trigger + execute rebalance
- `src/execution/multi-leg-frank-wolfe-optimizer.ts` — Frank-Wolfe implementation
- `src/execution/execution-path-planner.ts` — order sequence planner
- `src/types/delta-neutral-types.ts` — portfolio, delta, hedge types

## Implementation Steps
1. Create delta-neutral types
2. Implement delta calculator (portfolio sensitivity to market moves)
3. Implement delta-neutral strategy (position construction + monitoring)
4. Implement rebalance engine (threshold-based triggers)
5. Implement Frank-Wolfe optimizer (iterative gradient descent with projection)
6. Implement execution path planner (order legs by liquidity + impact)
7. Wire into strategy engine + NATS events
8. Write tests with synthetic market data
9. Paper trading validation

## Todo List
- [x] Define delta-neutral types
- [x] Implement delta calculator
- [x] Implement delta-neutral strategy
- [x] Implement rebalance engine
- [x] Implement Frank-Wolfe optimizer
- [x] Implement execution path planner
- [ ] Wire into strategy + NATS
- [ ] Write unit tests
- [ ] Paper trading test

## Success Criteria
- Portfolio delta stays within [-0.1, 0.1] after rebalance
- Frank-Wolfe reduces execution cost by > 10% vs naive sequential
- Paper trading shows positive edge over 100 simulated trades

## Risk Assessment
- **Complexity**: Most advanced phase — requires Phase 02+03 outputs
- **Correlation breakdown**: Markets may decorrelate suddenly → circuit breaker
- **Execution risk**: Multi-leg partial fills → rollback logic needed
