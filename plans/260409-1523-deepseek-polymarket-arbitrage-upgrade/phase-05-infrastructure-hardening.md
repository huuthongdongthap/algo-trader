# Phase 05: Infrastructure Hardening

## Context Links
- [PDF Sections 3.6-3.7](../../Desktop/DeepSeek%20-%20Vào%20Nơi%20Bí%20Ẩn.pdf)
- [Existing Execution](../../src/execution/)
- [Docker Setup](../../docker/)

## Overview
- **Priority**: P1
- **Status**: completed
- **Parallel Group**: B (after Phase 01, parallel with 02 and 03)

Three hardening components:
1. **Distributed Nonce Manager**: Redis-based atomic nonce for concurrent tx
2. **Gas Batch Optimizer**: Batch multiple positions to reduce gas
3. **TimescaleDB**: Migrate time-series data from SQLite to TimescaleDB

## Key Insights
- Current nonce: manual tracking in signer, no concurrency safety
- Gas: single tx per trade, no batching
- Storage: SQLite fine for dev, but TimescaleDB needed for production time-series queries
- All three are infrastructure — no strategy logic changes

## Requirements
### Functional
#### Nonce Manager
- Redis INCR-based atomic nonce counter per wallet
- Nonce reservation + release pattern for failed tx
- Multi-worker safe (multiple bot instances)

#### Gas Optimizer
- Batch queue: collect pending trades for 5s window
- Batch execute: single multicall tx for compatible trades
- Fallback to individual tx if batch fails

#### TimescaleDB
- Docker service with TimescaleDB extension
- Hypertables for: prices, order_book_snapshots, trades, signals
- Automatic compression after 7 days
- Migration script from SQLite → TimescaleDB

## Related Code Files
### Modify
- `src/execution/polymarket-signer.ts` — use distributed nonce
- `docker-compose.yml` — add TimescaleDB service

### Create
- `src/execution/distributed-nonce-manager.ts` — Redis INCR nonce pool
- `src/execution/gas-batch-optimizer.ts` — trade batching + multicall
- `docker/timescaledb/init.sql` — hypertable schema
- `scripts/migrate-sqlite-to-timescaledb.ts` — data migration

## Implementation Steps
1. Create `src/execution/distributed-nonce-manager.ts` with Redis INCR
2. Update `polymarket-signer.ts` to use nonce manager
3. Create `src/execution/gas-batch-optimizer.ts` with batch window
4. Add TimescaleDB to docker-compose.yml
5. Create `docker/timescaledb/init.sql` with hypertable DDL
6. Create migration script
7. Add TimescaleDB connection to config
8. Write tests for nonce manager (concurrency test)
9. Write tests for gas optimizer (batch window test)

## Todo List
- [x] Implement distributed nonce manager
- [ ] Update signer to use nonce manager (out of scope — file not in ownership list)
- [x] Implement gas batch optimizer
- [x] Add TimescaleDB Docker service (override compose file)
- [x] Create hypertable schema
- [x] Create migration script
- [ ] Update config for TimescaleDB (delegated to config phase)
- [ ] Write nonce concurrency tests (tester agent)
- [ ] Write gas batch tests (tester agent)

## Success Criteria
- Nonce: zero double-nonce errors under 10 concurrent workers
- Gas: 30%+ reduction in total gas for batched trades
- TimescaleDB: queries on 1M rows < 100ms with compression

## Risk Assessment
- **Nonce race condition**: Redis INCR is atomic — safe
- **Batch timeout**: 5s window may miss fast opportunities → configurable
- **Migration data loss**: Backup SQLite before migration, verify row counts
