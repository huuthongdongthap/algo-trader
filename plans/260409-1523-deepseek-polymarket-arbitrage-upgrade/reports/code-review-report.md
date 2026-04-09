# Code Review Report — DeepSeek Polymarket Arbitrage Upgrade

**Date:** 2026-04-09
**Reviewer:** code-reviewer agent
**Scope:** 39 source files + test files across 6 phases (3,103 LOC new code)
**Score: 8/10**
**Critical: 2 | Warnings: 6 | Suggestions: 5**

---

## Critical Issues (must fix)

### C1. SQL Injection in Migration Script
**File:** `scripts/migrate-sqlite-to-timescaledb.ts:90`
**Severity:** CRITICAL (security)

The `target` parameter (table name) and column names are interpolated directly into SQL:
```ts
const sql = `INSERT INTO ${target} (${cols.join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
```
While `target` is currently hardcoded ("trade_history", "signal_events"), column names come from SQLite rows which could contain crafted column names. Additionally, future callers could pass arbitrary table names.

**Fix:** Use `pg-format` or `pg` identifier quoting:
```ts
import format from 'pg-format';
const sql = format('INSERT INTO %I (%s) VALUES %s ON CONFLICT DO NOTHING', target, cols.map(c => format('%I', c)).join(', '), placeholders.join(', '));
```
Or at minimum, validate `target` against a whitelist of allowed table names.

### C2. Grafana Default admin:admin Credentials
**File:** `docker/monitoring/docker-compose.monitoring.yml:29-30`
**Severity:** CRITICAL (security)

```yaml
GF_SECURITY_ADMIN_PASSWORD: admin
```
Hardcoded default credentials. If this compose file is used in any non-local environment, Grafana is wide open.

**Fix:** Use environment variable:
```yaml
GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:?GRAFANA_ADMIN_PASSWORD is required}
```

---

## Warnings (should fix)

### W1. Nonce Manager Race Condition on Initialization
**File:** `src/execution/distributed-nonce-manager.ts:53-68`

`ensureInitialised()` has a TOCTOU gap: between `redis.get(key)` returning null and `redis.set(key, ..., 'NX')`, multiple workers could each call `getOnChainNonce()` independently. While `SET NX` prevents overwriting, the redundant RPC calls waste resources and add latency.

**Fix:** Use a Redis Lua script or `SET NX` directly without the preliminary GET:
```ts
const wasSet = await redis.set(key, onChainNonce, 'EX', 86400, 'NX');
// If wasSet is null, another worker already seeded it — that's fine.
```

### W2. Module-Level Singleton in NATS Connection Manager
**File:** `src/messaging/nats-connection-manager.ts:25-26`

Module-level `let connection` creates a global singleton that is difficult to test and cannot support multiple NATS connections in the same process. The `connectNats()` function also silently returns stale connections if the first one died but wasn't cleaned up.

**Recommendation:** Consider wrapping in a class or using a connection pool pattern. At minimum, verify `connection.isClosed()` before returning cached connection.

### W3. Untyped JetStream Manager Parameter
**File:** `src/messaging/jetstream-manager.ts:86`

```ts
async function ensureStream(jsm: any, config: StreamConfig): Promise<void> {
```
Single `any` usage in the codebase. The NATS JetStream manager type is available from the `nats` package.

**Fix:** `import { JetStreamManager } from 'nats'; ... jsm: JetStreamManager`

### W4. Redis Message Bus Missing Wildcard Support
**File:** `src/messaging/redis-message-bus.ts`

NATS topics use wildcards (`market.*.update`, `signal.>`), but Redis `subscribe()` does not support pattern matching — it uses exact channel names. The Redis fallback silently fails to match wildcard topics.

**Fix:** Use `psubscribe()` for pattern-based subscriptions when topic contains `*` or `>` characters, or document this limitation clearly.

### W5. Frank-Wolfe Step Size May Not Converge
**File:** `src/execution/multi-leg-frank-wolfe-optimizer.ts:141`

Step size `gamma = base / (t + denom)` with defaults `base=2, denom=2` gives gamma_0 = 1.0, which means the first iteration replaces the entire allocation. The standard FW convergence proof requires gamma_t = 2/(t+2).

**Recommendation:** Use the standard schedule `gamma = 2 / (iter + 2)` or validate the current schedule with empirical testing.

### W6. Delta-Neutral Monitor Timer Leak on Error
**File:** `src/strategies/polymarket/delta-neutral-portfolio-monitor.ts:45-48`

If `checkAll()` throws, the `setInterval` continues running. Additionally, if `stop()` is never called, the timer prevents the Node process from exiting.

**Fix:** Wrap `checkAll()` in try/catch within the interval callback, and consider using `unref()` on the timer.

---

## Suggestions (nice to have)

### S1. Deduplication Key Direction-Agnostic
**File:** `src/intelligence/relationship-graph-builder.ts:111`

Dedup key is `${marketA}:${marketB}:${type}` but A-to-B and B-to-A are treated as distinct. For symmetric relationships (CORRELATED, MUTUAL_EXCLUSION), this could result in duplicates.

**Fix:** Normalize key by sorting market IDs: `[marketA, marketB].sort().join(':')`

### S2. Semantic Cache TTL Could Be Configurable
**File:** `src/intelligence/semantic-cache.ts:14`

`CACHE_TTL_SECONDS = 3600` is hardcoded. For fast-moving markets, 1h may be too long; for stable markets, too short.

**Recommendation:** Accept via env var: `Number(process.env.SEMANTIC_CACHE_TTL ?? 3600)`

### S3. Gas Batch Optimizer Missing Queue Size Limit
**File:** `src/execution/gas-batch-optimizer.ts`

If flush keeps failing, `pendingBatch` grows unbounded. Consider adding a max queue size with rejection/backpressure.

### S4. TimescaleDB Docker Image Tag
**File:** `docker/timescaledb/docker-compose.timescaledb.yml:10`

`image: timescale/timescaledb:latest-pg16` — using `latest` tag in production is risky.

**Fix:** Pin to specific version: `timescale/timescaledb:2.14.2-pg16`

### S5. Missing Network Bridge for Monitoring-to-App Communication
**File:** `docker/monitoring/docker-compose.monitoring.yml`

Prometheus scrapes `algo-trade:3000` but monitoring stack uses its own `monitoring` network while the app is on `algo-trader-network`. They cannot communicate.

**Fix:** Add the app network to Prometheus service, or use `host.docker.internal`.

---

## Per-Phase Summary

### Phase 01 — Messaging: 8/10
Clean interface abstraction (IMessageBus). Good factory pattern with NATS/Redis fallback. JetStream config well-structured. Issues: one `any` type (W3), Redis wildcard gap (W4), module-level singleton (W2).

### Phase 02 — Intelligence: 9/10
Excellent separation of concerns: discovery orchestrator, context builder, graph builder, cache. DeepSeek JSON extraction handles markdown fences and edge cases well. Retry with backoff is proper. Minor: dedup direction (S1), cache TTL hardcoded (S2).

### Phase 03 — Arbitrage: 9/10
ILP formulation is correct. Clean constraint builder with env-based defaults. Multi-leg basket validation is thorough. Correlation penalty for mutual exclusion is a smart risk-aware touch. No issues found.

### Phase 04 — Execution + Strategies: 8/10
Frank-Wolfe implementation is mathematically sound with proper convergence check. Delta-neutral strategy correctly modularized (strategy, monitor, calculator, rebalance-engine). Delta formula for binary markets is correct. Issues: FW step size (W5), timer leak (W6).

### Phase 05 — Infrastructure: 7/10
Nonce manager uses correct Redis INCR pattern for atomicity. Gas batch optimizer handles fallback well. SQL migration has injection risk (C1), nonce init race (W1). TimescaleDB schema is well-designed with proper hypertables, compression, and retention.

### Phase 06 — Monitoring: 7/10
Grafana dashboards are functional. Prometheus config is clean. Issues: hardcoded admin password (C2), network isolation (S5), unpinned Docker tag (S4).

---

## Positive Observations

1. **Excellent modularization** — all files under 200 LOC limit, clean separation of concerns
2. **Strong type safety** — only 1 `any` across 3,103 LOC (in jetstream-manager with eslint annotation)
3. **No hardcoded secrets** in application code — all sensitive values from env vars
4. **Paper trading default** — `DEFAULT_DELTA_NEUTRAL_CONFIG.paperTrading = true` is safe-by-default
5. **Proper error handling** — try/catch with structured logging throughout, non-fatal failures handled gracefully
6. **Good DRY compliance** — shared types in `src/types/`, reusable components (delta-calculator used by both strategy and monitor)
7. **Clean architecture** — clear data flow: Discovery -> Graph -> ILP Solver -> Basket -> Frank-Wolfe -> Execution Plan
8. **TimescaleDB schema** — proper use of hypertables, compression policies, and retention policies for time-series data

---

## Metrics
- Type Coverage: ~99% (1 `any` with eslint annotation)
- Test Files: 8 relevant test files present
- Linting Issues: 1 (eslint-disabled `any`)
- Files Over 200 LOC: 0
- Total New LOC: 3,103

---

## Unresolved Questions

1. Is the Prometheus scrape target `algo-trade:3000` correct, or should it be the service name from docker-compose.yml?
2. Are the Grafana dashboard metric names (`daily_pnl_usd`, `signals_total`, etc.) already exposed by a `/metrics` endpoint, or do they need to be implemented?
3. The NATS service in docker-compose.yml has no authentication configured — is this intentional for local dev only?
