---
phase: 1
title: "Core Infrastructure"
status: pending
priority: P1
effort: 4h
parallel_group: sequential
blocks: [2, 3, 4, 5, 6, 7, 8]
blocked_by: []
---

# Phase 1: Core Infrastructure

## Context
- [Research: Polymarket](../../plans/reports/researcher-260321-1532-polymarket-trading-strategies.md)
- [Research: CEX/DEX](../../plans/reports/researcher-260321-1531-cex-dex-trading-strategies.md)
- [Plan Overview](./plan.md)

## Overview
Foundation layer: shared types, config management, logging, risk manager, utilities.
MUST complete before any other phase starts. All other phases import from `src/core/`.

## File Ownership (Exclusive)
```
src/core/types.ts           # All shared TypeScript types/interfaces
src/core/config.ts           # Environment config loader
src/core/logger.ts           # Structured logger (JSON output)
src/core/risk-manager.ts     # Position sizing, drawdown limits, Kelly Criterion
src/core/utils.ts            # Shared utilities (retry, sleep, formatting)
package.json                 # Project dependencies
tsconfig.json                # TypeScript config
bunfig.toml                  # Bun runtime config
```

## Key Insights
- Risk manager is CRITICAL: Kelly Criterion for position sizing, max 20% portfolio drawdown, 5% per-position max
- Config must support multiple environments (dev/staging/prod) + per-exchange API keys
- Logger must output structured JSON for future log aggregation
- All monetary values use string/BigInt (avoid float precision issues)

## Requirements

### Functional
1. **types.ts** (~150 lines): Core interfaces for Order, Position, Market, Strategy, Trade, PnL
2. **config.ts** (~80 lines): Load from .env, validate required keys, export typed config object
3. **logger.ts** (~60 lines): Structured JSON logger with levels (debug/info/warn/error), file + stdout output
4. **risk-manager.ts** (~150 lines): Kelly Criterion sizing, max drawdown check, position limits, stop-loss calculator
5. **utils.ts** (~80 lines): Retry with exponential backoff, sleep, price formatting, percentage calc

### Non-Functional
- Zero external dependencies for core (use Bun built-ins where possible)
- All functions must be pure where possible (testable)
- Export everything via barrel `src/core/index.ts`

## Implementation Steps

1. Initialize project:
   ```bash
   bun init
   ```
2. Configure `package.json` with dependencies:
   - `ccxt` (CEX), `ethers` (DEX), `better-sqlite3` (DB), `commander` (CLI)
   - Dev: `vitest`, `@types/better-sqlite3`
3. Create `tsconfig.json` with strict mode, paths aliases (`@core/*`, `@polymarket/*`, etc.)
4. Create `bunfig.toml` for Bun-specific settings
5. Implement `src/core/types.ts` - all shared interfaces
6. Implement `src/core/config.ts` - env loader with validation
7. Implement `src/core/logger.ts` - structured JSON logger
8. Implement `src/core/risk-manager.ts` - Kelly + drawdown + position limits
9. Implement `src/core/utils.ts` - retry, sleep, formatting helpers
10. Create `src/core/index.ts` barrel export

## Types Reference (types.ts)

```typescript
// Key interfaces to define:
interface MarketInfo { id: string; symbol: string; type: 'polymarket' | 'cex' | 'dex'; }
interface Order { id: string; market: string; side: 'buy' | 'sell'; price: string; size: string; status: OrderStatus; }
interface Position { market: string; side: 'long' | 'short'; entryPrice: string; size: string; unrealizedPnl: string; }
interface TradeResult { orderId: string; fillPrice: string; fillSize: string; fees: string; timestamp: number; }
interface RiskLimits { maxPositionSize: string; maxDrawdown: number; maxOpenPositions: number; stopLossPercent: number; }
interface StrategyConfig { name: string; enabled: boolean; capitalAllocation: string; params: Record<string, unknown>; }
```

## Risk Manager Core Logic

```typescript
// Kelly Criterion: f* = (bp - q) / b
// b = odds received (profit/loss ratio)
// p = probability of winning
// q = 1 - p (probability of losing)
kellyFraction(winRate: number, avgWin: number, avgLoss: number): number

// Max drawdown check
isDrawdownExceeded(currentEquity: string, peakEquity: string, maxDrawdown: number): boolean

// Position size calculator
calculatePositionSize(capital: string, riskPercent: number, stopLossPercent: number): string
```

## Todo
- [ ] `bun init` + configure package.json
- [ ] tsconfig.json with path aliases
- [ ] bunfig.toml
- [ ] src/core/types.ts
- [ ] src/core/config.ts
- [ ] src/core/logger.ts
- [ ] src/core/risk-manager.ts
- [ ] src/core/utils.ts
- [ ] src/core/index.ts (barrel)
- [ ] Verify: `bun run build` passes with 0 errors

## Success Criteria
- All core modules compile with 0 errors
- Risk manager correctly calculates Kelly fraction
- Config loads and validates .env
- Logger outputs structured JSON
- All exports available via `@core` path alias

## Risk Assessment
- **Low risk**: Standard infrastructure, well-understood patterns
- **Mitigation**: Keep each file under 150 lines, pure functions for testability
