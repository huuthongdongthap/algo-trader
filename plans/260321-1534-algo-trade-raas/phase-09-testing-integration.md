---
phase: 9
title: "Testing & Integration"
status: pending
priority: P1
effort: 8h
parallel_group: sequential_final
blocks: []
blocked_by: [1, 2, 3, 4, 5, 6, 7, 8]
---

# Phase 9: Testing & Integration

## Context
- [Plan Overview](./plan.md)
- All phase files in this plan

## Overview
Comprehensive testing: unit tests for all modules, integration tests for strategy flows, end-to-end test for full bot lifecycle. Final integration wiring.

## File Ownership (Exclusive)
```
tests/core/types.test.ts
tests/core/config.test.ts
tests/core/risk-manager.test.ts
tests/core/utils.test.ts
tests/polymarket/clob-client.test.ts
tests/polymarket/market-scanner.test.ts
tests/cex/exchange-client.test.ts
tests/cex/order-executor.test.ts
tests/dex/evm-client.test.ts
tests/dex/swap-router.test.ts
tests/strategies/cross-market-arb.test.ts
tests/strategies/grid-trading.test.ts
tests/strategies/dca-bot.test.ts
tests/strategies/funding-rate-arb.test.ts
tests/data/database.test.ts
tests/integration/bot-lifecycle.test.ts
vitest.config.ts
```

## Requirements

### Unit Tests (per module)
1. **Core**:
   - risk-manager: Kelly Criterion calculation, drawdown check, position sizing
   - config: env loading, validation, missing key errors
   - utils: retry logic, formatting functions
2. **Polymarket**:
   - clob-client: API response parsing, ECDSA signing format
   - market-scanner: spread calculation, filtering logic
3. **CEX**:
   - exchange-client: initialization, multi-exchange management
   - order-executor: retry on failure, order validation
4. **DEX**:
   - evm-client: gas estimation, transaction building
   - swap-router: chain routing, price comparison
5. **Strategies**:
   - cross-market-arb: spread detection, profit calculation
   - grid-trading: grid level calculation, fill handling
   - dca-bot: schedule execution, average price tracking
   - funding-rate-arb: rate threshold, delta-neutral entry/exit
6. **Data**:
   - database: CRUD operations, migration runner

### Integration Tests
- Bot lifecycle: init → start strategy → execute trade → stop → verify DB state
- Multi-strategy: run 2+ strategies simultaneously without conflict

### Non-Functional
- Test runner: Vitest
- No real API calls in unit tests (mock HTTP/WebSocket)
- Integration tests can use testnet if available
- Coverage target: >80% for core, >60% for strategies

## Implementation Steps

1. Create `vitest.config.ts` with path aliases matching tsconfig
2. Write unit tests for core modules (highest priority)
3. Write unit tests for client modules (mock external APIs)
4. Write unit tests for strategies (mock client calls)
5. Write unit tests for data layer (use in-memory SQLite)
6. Write integration test: full bot lifecycle
7. Run full test suite, fix failures
8. Verify coverage meets targets

## Todo
- [ ] vitest.config.ts
- [ ] tests/core/*.test.ts (4 files)
- [ ] tests/polymarket/*.test.ts (2 files)
- [ ] tests/cex/*.test.ts (2 files)
- [ ] tests/dex/*.test.ts (2 files)
- [ ] tests/strategies/*.test.ts (4 files)
- [ ] tests/data/*.test.ts (1 file)
- [ ] tests/integration/*.test.ts (1 file)
- [ ] Full test suite passes: `bun run test`
- [ ] Coverage >80% core, >60% strategies

## Success Criteria
- All unit tests pass
- Integration test covers full bot lifecycle
- No real API calls in test suite
- Coverage targets met
- `bun run test` exits with code 0

## Risk Assessment
- **Medium risk**: Mocking WebSocket/ECDSA signing is complex
- **Mitigation**: Use vitest's built-in mocking, create test fixtures
- **Note**: Strategy tests focus on logic (spread calc, grid levels), not API calls
