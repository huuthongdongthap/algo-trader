# DeepSeek Polymarket Arbitrage Upgrade Plan

## Source
PDF: "DeepSeek - Vào Nơi Bí Ẩn" — Event-Driven Microservices Architecture for Polymarket AI Arbitrage

## Status
| Phase | Description | Status | Parallel Group |
|-------|-------------|--------|----------------|
| 01 | NATS Message Bus | completed | A (foundation) |
| 02 | Semantic Dependency Discovery | completed | B (parallel) |
| 03 | Cross-Market ILP Solver | completed | B (parallel) |
| 04 | Delta-Neutral + Frank-Wolfe | completed | C (after 03) |
| 05 | Infrastructure Hardening | completed | B (parallel) |
| 06 | Grafana Dashboards + Monitoring | completed | D (after 01,05) |

## Dependency Graph
```
Phase 01 (NATS) ──────────────────────────────┐
   │                                           │
   ├── Phase 02 (Semantic Discovery) ──────────┤
   │                                           │
   ├── Phase 03 (ILP Solver) ──► Phase 04 ─────┤
   │                           (Delta-Neutral)  │
   ├── Phase 05 (Infra Hardening) ─────────────┤
   │                                           │
   └───────────────────────────────────────────►Phase 06 (Monitoring)
```

## Execution Strategy
1. **Sequential**: Phase 01 first (NATS is foundation for event-driven arch)
2. **Parallel Group B**: Phases 02, 03, 05 run concurrently after Phase 01
3. **Sequential**: Phase 04 after Phase 03 (depends on solver)
4. **Final**: Phase 06 after all others

## File Ownership Matrix
| Phase | Owns (exclusive) |
|-------|-----------------|
| 01 | src/messaging/*, src/wiring/nats-* |
| 02 | src/intelligence/semantic-*, intelligence/semantic-* |
| 03 | src/strategies/polymarket/cross-market-ilp-*, src/arbitrage/integer-programming-* |
| 04 | src/strategies/polymarket/delta-neutral-*, src/execution/multi-leg-frank-wolfe-* |
| 05 | src/execution/distributed-nonce-manager.ts, src/execution/gas-batch-optimizer.ts, docker/timescaledb/* |
| 06 | docker/grafana/*, docs/monitoring-* |

## Key Dependencies
- NATS npm package: `nats` v2.29.3
- LP Solver: `javascript-lp-solver` v1.0.3
- TimescaleDB: PostgreSQL + timescaledb extension via Docker
- DeepSeek API: OpenAI-compatible SDK (already in project)

## Work Context
- Project: /Users/macbookprom1/algo-trader
- Plans: /Users/macbookprom1/algo-trader/plans/260409-1523-deepseek-polymarket-arbitrage-upgrade/
- Reports: /Users/macbookprom1/algo-trader/plans/260409-1523-deepseek-polymarket-arbitrage-upgrade/reports/
