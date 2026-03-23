---
title: "Phase 1 — Paper Trading Validation"
description: "Fix engine, configure API, build long-tail scanner, wire prediction loop, run 50 paper trades"
status: pending
priority: P1
effort: 2w
branch: master
tags: [polymarket, openclaw, paper-trading, validation]
created: 2026-03-23
---

# Phase 1 — Paper Trading Validation (Week 1-2)

**Goal:** Prove prediction edge exists before risking capital.
**Exit criteria:** 50 paper trades logged, edge > 5% vs market implied probability on ≥20% of scanned markets.

---

## Task 1: Fix 2 Failing OpenClaw Config Tests

**File:** `tests/openclaw/openclaw-config.test.ts`
**Root cause:** Test expects Ollama defaults (`llama3.1:8b`, `deepseek-r1:32b/70b`); actual config uses MLX defaults (`mlx-community/Qwen2.5-Coder-32B-Instruct-4bit`).
**Also fix:** `gatewayUrl` assertion — actual default is `http://localhost:11435/v1`, not `11434`.

**Changes (2-line patch):**
```
Line 29: expect(cfg.routing.simple).toBe('mlx-community/Qwen2.5-Coder-32B-Instruct-4bit')
Line 30: expect(cfg.routing.standard).toBe('mlx-community/Qwen2.5-Coder-32B-Instruct-4bit')
Line 31: expect(cfg.routing.complex).toBe('mlx-community/Qwen2.5-Coder-32B-Instruct-4bit')
Line 28: expect(cfg.gatewayUrl).toBe('http://localhost:11435/v1')
Line 70-71: update fallback assertions to match new defaults
```

**Verify:** `bun test tests/openclaw/openclaw-config.test.ts` → 2398/2398 green.

---

## Task 2: Configure Polymarket Read-Only API

**Files to modify:** `.env`

**Steps:**
1. Go to https://docs.polymarket.com → CLOB API → generate API key
2. Create paper wallet: `openssl rand -hex 32` → prefix with `0x` → paste as `POLYMARKET_PRIVATE_KEY`
3. Set `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_API_PASSPHRASE`
4. Keep `POLYGON_RPC_URL` (already set)
5. Verify: `bun run src/polymarket/clob-client.ts` connects and fetches markets

**Note:** Paper wallet only — no real USDC needed for read-only market scanning.

---

## Task 3: Build Long-Tail Market Scanner

**Existing:** `src/polymarket/market-scanner.ts` — scans for arb/spread opportunities, filters by `minVolume`.
**Gap:** No upper volume cap, no resolution date filter. Currently optimized for arb, not LLM signal edge.

**File to modify:** `src/polymarket/market-scanner.ts`

**Add to `ScanOptions` interface:**
```ts
maxVolume?: number;           // default: 100_000 (long-tail filter)
minResolutionDays?: number;   // default: 7
maxResolutionDays?: number;   // default: 30
```

**Add filter logic in `scan()` after existing `minVolume` filter:**
```ts
// Long-tail: exclude high-volume markets (dominated by sophisticated players)
if (maxVolume !== undefined) {
  active = active.filter(m => safeParseFloat(m.volume) <= maxVolume);
}
// Resolution window: prefer markets resolving in 7-30 days (enough info, not too stale)
if (minResolutionDays || maxResolutionDays) {
  const now = Date.now();
  active = active.filter(m => {
    if (!m.end_date_iso) return true;
    const daysToClose = (new Date(m.end_date_iso).getTime() - now) / 86_400_000;
    return daysToClose >= (minResolutionDays ?? 0) && daysToClose <= (maxResolutionDays ?? Infinity);
  });
}
```

**New test file:** `tests/polymarket/long-tail-scanner.test.ts` — verify filter logic with mock markets.

---

## Task 4: Wire OpenClaw Prediction Loop

**Goal:** `market question + context → LLM probability estimate → compare vs market price → edge signal`

**Existing pieces:**
- `src/openclaw/ai-signal-generator.ts` — `generateSignal()` returns `{action, confidence, reasoning}`
- `src/strategies/polymarket/llm-sentiment-strategy.ts` — partially wired strategy
- `src/polymarket/market-scanner.ts` — returns `MarketOpportunity[]`

**Gap:** `generateSignal()` generates buy/sell/hold signals, not calibrated probability estimates. Need a prediction-specific prompt.

**File to create:** `src/openclaw/prediction-probability-estimator.ts`

```ts
// Input: market question, resolution criteria, current YES price (implied probability)
// Output: { estimatedProbability: number, confidence: number, reasoning: string, edge: number }
// edge = estimatedProbability - yesPrice (positive = buy YES, negative = buy NO)
```

**File to create:** `src/polymarket/prediction-loop.ts`

```ts
// Orchestrates: MarketScanner.scan(longTailOptions) → PredictionProbabilityEstimator → PaperExchange order
// Logs each decision to SQLite via existing decision-logger.ts
// Runs on a configurable interval (default: 15 min)
```

**Wire into CLI:** `src/cli/commands/` — add `paper-trade` command that starts the loop.

---

## Task 5: Run 50 Paper Trades + Log to SQLite

**Existing infrastructure:**
- `src/polymarket/clob-paper-simulator.ts` — paper exchange
- `data/algo-trade.db` — SQLite with `trades`, `ai_decisions` tables (0 rows)

**Steps:**
1. Start `prediction-loop.ts` in paper mode
2. Let it scan + generate 50 LLM predictions over 1-2 days
3. Verify rows appearing in `trades` and `ai_decisions` tables
4. Query: `SELECT COUNT(*) FROM trades WHERE paper = 1`

**Simulated P&L calculation:**
```sql
SELECT
  AVG(ABS(predicted_prob - market_implied_prob)) as avg_edge,
  SUM(CASE WHEN (predicted_prob > market_implied_prob AND outcome = 'YES')
           OR  (predicted_prob < market_implied_prob AND outcome = 'NO')
           THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as win_rate
FROM trades WHERE paper = 1 AND outcome IS NOT NULL;
```

---

## Success Criteria

- [ ] `bun test` → 2398/2398 passing
- [ ] Polymarket CLOB API connected, market list fetching live
- [ ] Long-tail scanner filters: `volume < $100K`, `resolution 7-30 days`
- [ ] Prediction loop runs end-to-end (scan → LLM → paper order → SQLite log)
- [ ] 50 rows in `trades` table with `paper = 1`
- [ ] Edge metric: `AVG(ABS(predicted_prob - market_price)) > 0.05` on ≥20% of predictions

---

## Files Modified/Created

| Action   | File                                                      |
|----------|-----------------------------------------------------------|
| Modify   | `tests/openclaw/openclaw-config.test.ts` (update defaults) |
| Modify   | `src/polymarket/market-scanner.ts` (add long-tail filters) |
| Create   | `src/openclaw/prediction-probability-estimator.ts`        |
| Create   | `src/polymarket/prediction-loop.ts`                       |
| Create   | `tests/polymarket/long-tail-scanner.test.ts`              |
| Modify   | `.env` (add Polymarket credentials)                       |

---

## Unresolved Questions

1. Does `RawMarket` type from `clob-client.ts` include `end_date_iso`? — check interface before adding resolution filter.
2. Which OpenClaw model (Qwen 32B MLX) gives better calibrated probability estimates? — empirically test on first 20 predictions.
3. Polymarket ToS: read https://polymarket.com/tos before Phase 2 live trading.
