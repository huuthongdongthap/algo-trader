# Gap Wiring: NATS Integration + Augmented Signal Engine

## Source
Deep audit of PDF "DeepSeek - Vào Nơi Bí Ẩn" vs actual codebase. Blueprint realization ~35%.

## Problem
Infrastructure built (NATS, ILP, semantic discovery) but ZERO wiring into strategy engine. Strategies don't subscribe to NATS. DeepSeek doesn't validate signals pre-execution.

## Status
| Phase | Description | Status | Group |
|-------|-------------|--------|-------|
| 07 | NATS → Strategy Event Wiring | pending | A (foundation) |
| 08 | Augmented Signal Engine (AI validation) | pending | A (parallel with 07) |
| 09 | News Impact Analysis Feed | pending | B (after 07) |
| 10 | Vector Embeddings for Semantic Search | pending | B (parallel with 09) |
| 11 | On-Chain Position Reconciliation | pending | B (parallel with 09) |

## Dependency Graph
```
Phase 07 (NATS Wiring) ──┬──► Phase 09 (News)
                          ├──► Phase 10 (Vectors)
Phase 08 (AI Validation) ─┤──► Phase 11 (Position Sync)
                          └──► All connect into 9-step pipeline
```

## Execution Strategy
1. **Parallel**: Phases 07 + 08 (independent wiring tasks)
2. **Parallel Group B**: Phases 09, 10, 11 after group A
3. All phases wire into existing code — modify, not create

## File Ownership Matrix
| Phase | Owns (exclusive) |
|-------|-----------------|
| 07 | src/wiring/nats-strategy-bridge.ts, src/wiring/nats-event-loop.ts |
| 08 | src/intelligence/signal-validator.ts, src/wiring/augmented-signal-pipeline.ts |
| 09 | src/feeds/news-impact-analyzer.ts, src/feeds/news-market-correlator.ts |
| 10 | src/intelligence/vector-embedding-store.ts, src/intelligence/semantic-similarity-search.ts |
| 11 | src/execution/on-chain-position-reconciler.ts |

## Key Principle
Wire existing modules together — DON'T rebuild. The pieces exist, they just need plumbing.
