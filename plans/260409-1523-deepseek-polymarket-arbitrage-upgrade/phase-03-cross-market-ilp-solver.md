# Phase 03: Cross-Market Integer Linear Programming Solver

## Context Links
- [PDF Section 3.4: Signal Engine](../../Desktop/DeepSeek%20-%20Vào%20Nơi%20Bí%20Ẩn.pdf)
- [Existing Mean-Variance Optimizer](../../src/strategies/polymarket/mean-variance-optimizer.ts)
- [Existing Arbitrage Module](../../src/arbitrage/)

## Overview
- **Priority**: P1
- **Status**: completed
- **Parallel Group**: B (after Phase 01, parallel with 02 and 05)

Replace simplified Markowitz optimization with full Integer Linear Programming solver for multi-market cross-leg arbitrage. Explore 2^63 outcome combinations across correlated markets.

## Key Insights
- Current `mean-variance-optimizer.ts` handles single-market Sharpe ratio only
- Need ILP solver for: maximize profit across N markets subject to budget + risk constraints
- `javascript-lp-solver` (pure JS) or `glpk.js` (WASM) are viable
- Dependency graph from Phase 02 feeds market correlations into solver

## Requirements
### Functional
- Given N markets with YES/NO prices + dependency graph → optimal position allocation
- Constraints: total budget, per-market max position, max correlated exposure
- Objective: maximize expected profit minus fees (2% Polymarket fee)
- Support: Simple Add (YES+NO<1), Cross-Market (correlated mispricing), Multi-Leg (3+ markets)

### Non-functional
- Solve 50-market optimization in < 500ms
- Handle infeasible solutions gracefully
- Publish candidates to NATS `signal.crossmarket.candidate`

## Architecture
```
[Dependency Graph] + [Market Prices] → ILP Formulation
      ↓
[LP Solver] → optimal basket {market_id, side, size, expected_edge}
      ↓
[Validation] → filter by min_edge (2.5%), max_correlated_exposure
      ↓
[NATS publish] → signal.crossmarket.candidate
```

## Related Code Files
### Modify
- `src/strategies/polymarket/mean-variance-optimizer.ts` — keep but add ILP alternative

### Create
- `src/arbitrage/integer-programming-solver.ts` — core ILP formulation + solver
- `src/arbitrage/cross-market-arbitrage-detector.ts` — consume dependency graph, build ILP
- `src/arbitrage/ilp-constraint-builder.ts` — budget, risk, position constraints
- `src/arbitrage/multi-leg-basket.ts` — types for optimal basket output
- `src/types/ilp-types.ts` — solver types, constraints, variables

## Implementation Steps
1. Install LP solver: `pnpm add javascript-lp-solver`
2. Create `src/types/ilp-types.ts` — ILPVariable, ILPConstraint, ILPResult
3. Create `src/arbitrage/ilp-constraint-builder.ts` — build constraints from config
4. Create `src/arbitrage/integer-programming-solver.ts` — formulate + solve
5. Create `src/arbitrage/cross-market-arbitrage-detector.ts` — orchestrate: prices + graph → solver → basket
6. Create `src/arbitrage/multi-leg-basket.ts` — basket types + validation
7. Subscribe to `intelligence.dependencies.updated` for graph updates
8. Publish candidates to NATS
9. Wire into strategy engine
10. Write tests with known-solution scenarios

## Todo List
- [x] Install javascript-lp-solver
- [x] Define ILP types
- [x] Implement constraint builder
- [x] Implement ILP solver wrapper
- [x] Implement cross-market detector
- [x] Implement basket validation
- [ ] Wire NATS pub/sub (deferred — requires NATS wiring phase)
- [ ] Write unit tests with known optima (tester agent)
- [ ] Benchmark: 50 markets < 500ms (tester agent)

## Success Criteria
- Correctly solves 2-market arbitrage (YES+NO<1) as baseline
- Finds multi-market opportunities invisible to single-market scan
- Respects budget and risk constraints
- Solver time < 500ms for 50 markets

## Risk Assessment
- **Solver performance**: JS solver may be slow for large N → fallback to greedy heuristic
- **False positives**: Validate with price refresh before execution
- **Dependency graph staleness**: Subscribe to real-time graph updates

## Security Considerations
- No external API calls (pure computation)
- Log solver inputs/outputs for audit trail
