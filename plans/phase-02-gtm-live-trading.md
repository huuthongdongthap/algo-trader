---
title: "Phase 2 — GTM Live Trading"
description: "Fund wallet, execute 10 real trades on validated signals, document eat-your-own-cooking P&L"
status: pending
priority: P1
effort: 2w
branch: master
tags: [polymarket, live-trading, gtm, pnl]
created: 2026-03-23
---

# Phase 2 — GTM Live Trading (Week 3-4)

**Prerequisite:** Phase 1 exit criteria met (50 paper trades, edge > 5% confirmed).
**Goal:** First real capital at risk. Validate execution quality. Build "eat our own cooking" P&L record for marketing.

---

## Task 1: Fund Polymarket Wallet

**Steps:**
1. Verify Polymarket ToS allows automated trading — read https://polymarket.com/tos
2. Buy $500–1K USDC on any CEX (Binance/Coinbase)
3. Bridge to Polygon: use official Polygon bridge or direct Binance Polygon withdrawal
4. Deposit USDC to Polymarket wallet address
5. Confirm balance visible in CLOB API: `GET /balance`

**Risk controls (hard-coded before first real trade):**
```
MAX_POSITION_PCT = 0.02      // 2% of bankroll per trade (half-Kelly)
DAILY_STOP_LOSS_PCT = 0.10   // halt trading if daily drawdown > 10%
MAX_OPEN_POSITIONS = 5       // never hold > 5 positions simultaneously
MIN_EDGE_THRESHOLD = 0.05    // only trade if edge > 5%
```

**Files to modify:** `src/core/risk-manager.ts` (verify these limits are enforced), `.env` (swap paper wallet → real wallet private key)

---

## Task 2: Execute First 10 Real Trades

**Manual review gate:** Before submitting each of the first 10 orders, print the signal to console and require `y` confirmation in CLI.

**File to modify:** `src/polymarket/prediction-loop.ts`
- Add `--manual-confirm` flag for Phase 2 cautious mode
- Log: market, predicted_prob, market_price, edge, kelly_size, order_usdc

**Execution checklist per trade:**
- [ ] Edge > 5% confirmed
- [ ] Kelly size ≤ 2% of current bankroll
- [ ] Market resolution date within 7-30 days
- [ ] No duplicate position in same market
- [ ] Daily loss limit not hit

---

## Task 3: Track Actual vs Predicted Outcomes

**After each market resolves, record:**
```sql
UPDATE trades SET
  outcome = 'YES|NO',
  actual_pnl_usdc = ?,
  slippage_usdc = ?,
  gas_cost_usdc = ?
WHERE condition_id = ? AND paper = 0;
```

**P&L dashboard query:**
```sql
SELECT
  COUNT(*) as total_trades,
  SUM(actual_pnl_usdc) as net_pnl,
  AVG(actual_pnl_usdc) as avg_pnl_per_trade,
  SUM(gas_cost_usdc + slippage_usdc) as total_friction_cost,
  AVG(ABS(predicted_prob - market_implied_prob)) as avg_predicted_edge
FROM trades WHERE paper = 0;
```

---

## Task 4: Set Up Monitoring + Alerts

**File to create:** `src/monitoring/telegram-alert.ts`
- Send Telegram message on: order filled, position resolved, daily P&L summary, error/halt
- Use Telegram Bot API (free, no infra needed)
- Add `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` to `.env`

**OpenClaw calibration check (after 10 trades):**
- Plot `predicted_prob` vs `win_rate` by confidence bucket (0.5-0.6, 0.6-0.7, 0.7+)
- If calibration curve is flat → prompt tuning needed before Phase 3
- Target: higher confidence → higher win rate (monotonic relationship)

---

## Task 5: Document "Eat Our Own Cooking" P&L

**This is a marketing asset, not just a log.**

**File to create:** `docs/trading-performance.md`
- Updated after every resolved trade
- Format: date, market question, predicted prob, actual outcome, P&L, cumulative return
- Will be shared publicly as proof of signal quality
- Keep neutral tone — no cherry-picking, include losses

**If Phase 2 profitable:** scale bankroll to $5–20K in Phase 3A.
**If Phase 2 breakeven/loss:** audit prompt quality, re-run paper trading with adjusted prompts before scaling.

---

## Success Criteria

- [ ] Real wallet funded ($500–1K USDC on Polygon)
- [ ] 10 real trades executed, all within risk limits
- [ ] Zero position exceeds 2% of bankroll
- [ ] All trade outcomes logged in SQLite with actual P&L
- [ ] Telegram alerts firing on fills and resolutions
- [ ] Calibration check: confidence scores correlate with win rates
- [ ] `docs/trading-performance.md` exists with first 10 trade records

---

## Files Modified/Created

| Action | File |
|--------|------|
| Modify | `src/polymarket/prediction-loop.ts` (add `--manual-confirm` flag) |
| Modify | `src/core/risk-manager.ts` (verify hard limits) |
| Create | `src/monitoring/telegram-alert.ts` |
| Create | `docs/trading-performance.md` |
| Modify | `.env` (real wallet key, Telegram credentials) |

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Edge doesn't hold in live trading | Stop at 10 trades, review paper vs live slippage delta |
| Gas costs eat returns | Budget: $0.05/tx × 10 trades = $0.50. Negligible on $500+ bankroll |
| Polymarket API rate limit | Cache market list, batch orderbook requests |
| ToS violation / account suspension | Read ToS first; use separate wallet from personal holdings |

---

## Unresolved Questions

1. Does Polymarket ToS explicitly permit automated/bot trading? — MUST verify before first real trade.
2. Does `src/core/risk-manager.ts` already enforce the 2% / 10% limits, or are they advisory?
3. Gas cost on Polygon at current gwei — sustainable for 50 trades/week on $1K bankroll?
