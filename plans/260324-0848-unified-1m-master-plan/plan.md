# Unified $1M Master Plan — OpenClaw Platform
**Created:** 2026-03-24 | **Target:** $1M ARR by 2027-Q1 | **Status:** pending

---

## The Thesis

One M1 Max. One LLM. Three revenue streams. Zero marginal inference cost.

```
┌──────────────────────────────────────────────────────┐
│                   OpenClaw Platform                   │
│         (Local MLX Inference — $0/call)               │
├──────────────┬──────────────┬────────────────────────┤
│  AlgoTrade   │   CashClaw   │    Mekong CLI          │
│  (Earn $$$)  │  (Earn $$$)  │   (Orchestrate All)    │
│              │              │                        │
│ Prediction   │ Autonomous   │ Agent coordination     │
│ market RaaS  │ freelancing  │ Skills marketplace     │
│ Own-account  │ Task fees    │ Internal backbone      │
│ trading P&L  │              │                        │
└──────┬───────┴──────┬───────┴───────────┬────────────┘
       │              │                   │
       ▼              ▼                   ▼
  Polymarket     Moltlaunch/          Claude Code
  Gamma API      Fiverr/Upwork       Hooks + Skills
```

## Revenue Model to $1M ARR

| Stream | Monthly | Annual | Timeline |
|--------|---------|--------|----------|
| AlgoTrade RaaS subscriptions | $84K | $1.0M | Month 6-12 |
| Own-account trading P&L | $1-5K | $12-60K | Month 2-6 |
| CashClaw task fees (10-30%) | $2-10K | $24-120K | Month 9-18 |
| Mekong skills marketplace | $1-3K | $12-36K | Month 3-6 |
| **Total potential** | **$88-102K** | **$1.05-1.22M** | |

**Primary driver:** AlgoTrade RaaS = 95% of revenue. Everything else is bonus.

## Phase Overview

| Phase | Timeline | Goal | Key Metric |
|-------|----------|------|------------|
| 1 — Validate Edge | Weeks 1-4 | Prove prediction accuracy >55% | Brier score, win rate |
| 2 — Live Trading | Weeks 5-8 | $500 bankroll, real trades | P&L, Sharpe ratio |
| 3 — Show HN + RaaS | Weeks 9-12 | Launch subscription, get 50 users | Subscribers, MRR |
| 4 — Scale | Weeks 13-24 | 700 subscribers, $84K MRR | ARR, churn rate |

---

## Phase 1: Validate Edge (Now → Week 4)

**Files:** `phase-01-validate-edge.md`

**Progress Update (2026-03-24):**
- Switched prediction pipeline from Qwen to DeepSeek R1 (standard/complex tiers)
- Fixed 6 production parsers for DeepSeek R1 think-block stripping
- Ran batch 3: 50 event-only paper trades with DeepSeek R1 (20% avg edge, 40% actionable)
- Built automated resolution checker (`check-batch-resolutions.mjs`) with daily launchd monitoring
- All 2,403 tests passing
- Latest commits: 5cc8961 (DeepSeek R1 migration), b0113d9 (resolution checker)

### Tasks
- [x] 50 paper trades batch 1 (mixed) — 14.6% avg edge
- [x] 50 paper trades batch 2 (event-only) — 25.3% avg edge
- [x] Filter out stock/crypto price markets (0% accuracy)
- [x] Resolution tracker built with conditionId storage
- [x] Switched pipeline from Qwen to DeepSeek R1 (naturally better calibrated)
- [x] Run batch 3: 50 calibrated event-only trades (DeepSeek R1)
- [x] Built automated resolution checker with daily launchd job
- [ ] Wait for batch 2+3 event resolutions (~1 week) — daily check in place
- [ ] Achieve >55% accuracy on resolved event markets
- [ ] Compare LLM Brier score vs market baseline

### Exit Criteria
- ≥30 resolved trades from event-only batches
- Win rate >55% on resolved trades
- Brier score < 0.25 (market baseline typically ~0.20)
- No catastrophic losses on simulated PnL

---

## Phase 2: Live Trading (Weeks 5-8)

**Files:** `phase-02-live-trading.md`

### Tasks
- [ ] Setup Polymarket US account (CFTC-regulated)
- [ ] Fund wallet: $500 USDC on Polygon
- [ ] Implement half-Kelly position sizing (already built)
- [ ] Wire end-to-end: scan → estimate → size → execute → log
- [ ] Run 50 real trades over 4 weeks
- [ ] Track P&L daily, publish to trading-performance.md
- [ ] Setup Telegram alerts for every trade (already built)
- [ ] Target: positive P&L after gas costs

### Risk Management
- Max 5% bankroll per trade (half-Kelly)
- Max drawdown limit: 30% of bankroll
- Circuit breaker: stop trading if 10 consecutive losses
- Only event-based markets (no price predictions)

---

## Phase 3: Show HN + RaaS Launch (Weeks 9-12)

**Files:** `phase-03-raas-launch.md`

### Tasks
- [ ] Publish real P&L track record (4+ weeks of live data)
- [ ] Launch landing page with "We eat our own cooking" P&L
- [ ] Setup Polar.sh subscription tiers:
  - Starter $49/mo: daily signal alerts, basic markets
  - Pro $149/mo: all signals + Kelly sizing + Telegram bot
  - Fund $499/mo: auto-execute via API, custom filters
- [ ] Show HN post (draft exists: `plans/show-hn-draft.md`)
- [ ] CashClaw: launch on Product Hunt as demo agent
- [ ] Mekong CLI: publish skills pack on npm (free tier)
- [ ] Target: 50 paying subscribers by week 12

### Distribution Channels
1. Show HN → direct traffic
2. Polymarket Discord/Reddit → niche community
3. "Open source engine, closed signal service" → trust signal
4. Twitter/X: daily P&L screenshots → social proof

---

## Phase 4: Scale to $1M ARR (Weeks 13-24)

**Files:** `phase-04-scale-to-1m.md`

### Tasks
- [ ] Scale to 700 subscribers (blended $120 ARPU)
- [ ] Add Kalshi as second prediction market venue
- [ ] Deploy inference to cloud (backup for M1 Max downtime)
- [ ] Build referral program (give 1 month free per referral)
- [ ] CashClaw: activate Fiverr connector if Moltlaunch still empty
- [ ] Mekong CLI: premium skill packs ($49-499)
- [ ] Hire part-time ops/support if >200 subscribers

### Growth Loops
1. P&L transparency → trust → subscribers
2. Subscribers → more capital → better P&L → more subscribers
3. Open source engine → GitHub stars → awareness → subscribers
4. Signal accuracy improves with more data → compound advantage

---

## Parallel Workstreams (x10 Leverage)

### Stream A: AlgoTrade Core (CRITICAL PATH)
```
Validate → Live Trade → P&L Track Record → RaaS
```

### Stream B: Mekong CLI (Low effort, launch fast)
```
Package skills → npm publish → Free tier → Upsell
```

### Stream C: CashClaw (Background, opportunistic)
```
Monitor Moltlaunch → If demand: activate
                   → If not: build Fiverr connector (Month 6+)
```

### Stream D: Content + Distribution
```
Daily P&L tweets → Show HN → Blog posts → Polymarket community
```

---

## Infrastructure (Already Built)

| Component | Status | Location |
|-----------|--------|----------|
| OpenClaw LLM (DeepSeek R1 MLX) | RUNNING | M1 Max port 11435 |
| Prediction estimator (blind) | DONE | algo-trade/src/openclaw/ |
| Market scanner (event filter) | DONE | algo-trade/src/polymarket/ |
| Paper trade pipeline (DeepSeek R1) | DONE | scripts/paper-trade-event-only.mjs |
| Resolution tracker | DONE | src/polymarket/resolution-tracker.ts |
| Automated resolution checker | DONE | scripts/check-batch-resolutions.mjs |
| Daily launchd monitoring job | DONE | M1 Max cron setup |
| Kelly half-sizer | DONE | src/risk/ |
| Telegram alerts | DONE | src/notifications/ |
| CashClaw simulator | DONE | cashclaw/src/simulator/ |
| CashClaw CLI provider | DONE | cashclaw/src/moltlaunch/cli-provider.ts |
| Mekong CLI skills | DONE | ~/.claude/skills/ |
| Polar.sh billing | CONFIGURED | .env |
| CI/CD (2,403 tests) | DONE | .github/workflows/ |
| Landing page | DONE | src/landing/ |

## What Needs Building

| Task | Effort | Blocks | Status |
|------|--------|--------|--------|
| Batch 2+3 resolution monitoring | 1 week | Phase 1 exit | RUNNING (automated daily check) |
| Polymarket US account setup | 1 hour | Phase 2 start | PENDING |
| End-to-end live trade wiring | 3-5 days | Phase 2 | PENDING |
| Polar.sh product creation | 2 hours | Phase 3 | PENDING |
| Show HN polish | 1 day | Phase 3 | PENDING |
| npm publish mekong skills | 1 day | Stream B | PENDING |

---

## Key Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Edge doesn't materialize | 30% | FATAL | Batch 2 resolutions = go/no-go gate |
| LLM overconfident on rare events | 70% | HIGH | Calibration layer, ensemble |
| Polymarket ToS change | 10% | HIGH | Kalshi as backup venue |
| M1 Max downtime | 5% | MEDIUM | Cloud inference backup |
| Solo dev burnout | 40% | HIGH | Automate everything, AI agents |
| Moltlaunch stays empty | 80% | LOW | CashClaw is bonus, not core |

## Success Metrics

| Milestone | Target | Date |
|-----------|--------|------|
| 30+ resolved event trades | >55% accuracy | Week 4 |
| First real Polymarket trade | Positive | Week 5 |
| 4-week live P&L | >0 after gas | Week 8 |
| Show HN launch | >100 upvotes | Week 10 |
| First paying subscriber | $49+ | Week 10 |
| 50 subscribers | $6K MRR | Week 12 |
| 200 subscribers | $24K MRR | Week 18 |
| 700 subscribers | $84K MRR | Week 24 |
