---
title: "AlgoTrade Company Blueprint — Zero to PSF"
description: "Execution plan from 0 trades to live AI prediction trading + RaaS revenue"
status: pending
priority: P1
effort: 6w
branch: master
tags: [algo-trade, polymarket, openclaw, kelly, raas, polar]
created: 2026-03-23
---

# AlgoTrade — Zero → PSF Execution Plan

## Context

- Stage: Zero (code exists, 0 revenue, 0 trades, 0 API keys)
- Edge: AI analysis quality on long-tail Polymarket markets (NOT speed/MM)
- Stack: Bun/TS, Polymarket CLOB client, Kelly sizer, OpenClaw (local MLX)
- Billing: Polar.sh (already configured)
- Tests: 2396/2398 passing

---

## Phase 1 — Fix & Validate (Week 1-2)

**Goal:** Engine is trustworthy. Paper trades confirm prediction edge exists.

### Tasks

1. **Fix 2 failing tests** — identify, patch, achieve 2398/2398 green
2. **Configure API keys** — Polymarket CLOB credentials + wallet private key (paper wallet)
3. **Build long-tail market scanner** — filter markets: volume < $100K, resolution 7-30 days, open
4. **Wire OpenClaw prediction loop**
   - Input: market question + context (news, social, resolution criteria)
   - Output: probability estimate + confidence score
   - Compare OpenClaw estimate vs Polymarket implied probability → find edge > 5%
5. **Paper trading loop** — log predicted vs actual outcomes for 50+ markets, no real capital
6. **Kelly sizer validation** — half-Kelly sizing on simulated $1K bankroll

**mekong-cli mapping:** `/cook` (engineering), `/review` (code quality)

**Exit criteria:** 50 paper trades logged, edge > 5% on >20% of scanned markets

---

## Phase 2 — Live Trading ($500-1K) (Week 3-4)

**Goal:** First real trade. Validate execution. Measure actual vs predicted edge.

### Tasks

1. **Fund real wallet** — $500-1K USDC on Polygon
2. **Set hard risk limits** — max 2% per trade (half-Kelly), daily stop-loss 10%, max 5 open positions
3. **Execute first 10 real trades** — manually review each before submit
4. **Track P&L vs paper baseline** — slippage, gas, spread vs simulated
5. **OpenClaw calibration** — compare confidence scores vs win rates, adjust prompts
6. **Monitoring setup** — Telegram alerts for fills, P&L, errors

**mekong-cli mapping:** `/cook` (engineering), `/monitor` (ops)

**Exit criteria:** 10 real trades, positive expected value confirmed, no critical bugs

---

## Phase 3 — Scale + Package RaaS (Month 2-3)

**Goal:** First paying subscriber. Own trading generating consistent returns.

### Sub-phases

#### 3A — Own Trading Scale (Month 2, Week 1-2)
- Increase bankroll to $5-10K if Phase 2 profitable
- Automate full loop: scan → analyze → size → execute → log
- Target: 20-50 trades/week, Sharpe > 1.5

#### 3B — RaaS Packaging (Month 2, Week 3-4)
- **Starter ($49/mo):** hosted OpenClaw analysis feed, market scanner alerts only
- **Pro ($149/mo):** automated execution on user's wallet, Kelly sizing, Telegram bot
- **Elite ($499/mo):** custom market focus, priority support, performance dashboard
- Polish onboarding: `.env` setup guide, video walkthrough, one-command start
- Polar.sh subscription activation (already integrated)

#### 3C — Launch + First Revenue (Month 3)
- Post on: r/algotrading, r/PredictionMarkets, Polymarket Discord, CT (Crypto Twitter)
- Lead magnet: open-source engine + "we trade it ourselves" proof (share P&L)
- Target: 5 paying subscribers by end of Month 3 = $245-$2,495 MRR
- Iterate based on subscriber feedback

**mekong-cli mapping:** `/plan` (product), `/cook` (engineering), `/review` (quality)

**Exit criteria:** 1 paying subscriber, own trading P&L > 0 over 30 days

---

## ARR Trajectory

| Milestone | Subscribers | MRR | ARR |
|-----------|-------------|-----|-----|
| PSF | 5 | ~$500 | ~$6K |
| PMF | 50 | ~$5K | ~$60K |
| Scale | 200 | ~$20K | ~$240K |
| Target | 700 | ~$84K | ~$1M |

Mix assumption: 60% Starter, 30% Pro, 10% Elite

---

## Risk Register

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| OpenClaw edge doesn't materialize | Medium | Paper trade 50+ markets before real capital; pivot to news-only signal |
| Polymarket API rate limits | Low | Cache market data, batch requests |
| RaaS users blow up accounts | High | Hard-coded half-Kelly, daily stop enforced, disclaimer |
| Polar.sh rejects product description | Medium | Use "prediction market analytics SaaS" — no financial/gambling terms |
| M1 Max inference too slow for edge | Low | LLM runs on minute-scale, not ms-scale — latency irrelevant |

---

## Unresolved Questions

1. Which OpenClaw model (Qwen 32B vs DeepSeek 70B) gives better calibration on binary prediction markets?
2. Should own-trading P&L be public (trust signal) or private (competitive moat)?
3. Gas costs on Polygon — does $1K bankroll sustain 50 trades/week net-positive after fees?
4. Polymarket terms of service: does automated trading require explicit approval?
