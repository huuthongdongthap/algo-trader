---
title: "Phase 3 — RaaS Packaging & Launch"
description: "Package prediction signals as subscription API, acquire first 10 paying subscribers"
status: pending
priority: P2
effort: 6w
branch: master
tags: [raas, polar, landing-page, gtm, subscriptions]
created: 2026-03-23
---

# Phase 3 — RaaS Packaging & Launch (Month 2-3)

**Prerequisite:** Phase 2 profitable (or breakeven with calibrated edge).
**Goal:** First paying subscriber. MRR > $0.

---

## 3A — Scale Own Trading (Month 2, Week 1-2)

**If Phase 2 P&L positive:** increase bankroll to $5–10K.

**Automate full loop** (remove `--manual-confirm` gate):
- `src/polymarket/prediction-loop.ts` → runs on cron (every 15 min)
- Auto-executes trades that pass all risk checks
- Telegram alerts still fire on every fill

**Target metrics:**
- 20–50 trades/week
- Sharpe ratio > 1.5 over rolling 30 days
- Max drawdown < 15%

**File to modify:** `src/scheduler/` — add cron job for prediction loop.

---

## 3B — RaaS Packaging (Month 2, Week 3-4)

### Subscription Tiers (already in `company.json`)

| Tier | Price | Deliverable |
|------|-------|-------------|
| Starter ($49/mo) | Daily signal digest via Telegram/API | Market scanner output + LLM edge scores, no execution |
| Pro ($149/mo) | Real-time signals + Kelly sizing on user's wallet | Auto-execution via user-provided private key |
| Elite ($499/mo) | Everything in Pro + custom market focus + priority support + performance dashboard |

### Files to Create/Modify

**Signal delivery for Starter:**
- `src/raas/signal-feed-publisher.ts` — publishes daily digest to Telegram channel or webhook
- `src/raas/signal-feed-api.ts` — REST endpoint: `GET /api/v1/signals?tier=starter` (JWT-gated)

**Pro tier execution:**
- `src/raas/subscriber-executor.ts` — reads subscriber wallet config, runs prediction loop on their behalf
- Each subscriber gets isolated risk manager instance (their bankroll, their limits)
- Store subscriber wallet keys encrypted at rest (NOT in SQLite plaintext)

**Elite tier dashboard:**
- `src/dashboard/` — already exists, extend with subscriber P&L view
- Add `GET /dashboard/performance` page showing: win rate, avg edge, Sharpe, cumulative return

**Onboarding polish:**
- `docs/onboarding-guide.md` — `.env` setup, OpenClaw install, one-command start: `bun run start`
- Video walkthrough (Loom, 5 min) — link in README

**Polar.sh integration check:**
- `POLAR_API_TOKEN` already set
- Verify webhook fires on subscription activation → triggers subscriber onboarding
- Product descriptions: use "prediction market analytics SaaS" — NO financial/gambling/trading terms per payment-provider rules

---

## 3C — Launch & First 10 Subscribers (Month 3)

### Distribution Channels (priority order)

1. **Polymarket Discord** — post in #trading-bots or #alpha channels
   - Lead: "We built an open-source AI prediction engine. We trade it ourselves. Here's our P&L."
   - Link to `docs/trading-performance.md` as proof

2. **Reddit r/algotrading + r/PredictionMarkets**
   - Post: "6 months building a Polymarket AI trader. Here's what we learned."
   - Include backtested edge graph, open-source repo link

3. **Crypto Twitter (CT)**
   - Thread: problem → solution → proof → CTA
   - Pin `docs/trading-performance.md` link
   - Target: prediction market traders, quant retail, AI/ML crowd

4. **Lead magnet: open-source engine**
   - MIT license the core engine (scanner + Kelly sizer)
   - Keep RaaS hosted service as paid moat
   - GitHub stars = trust signal + inbound distribution

### Acquisition Target

| Month | Subscribers | MRR |
|-------|-------------|-----|
| End M3 | 5–10 | $245–$2,495 |
| End M4 | 20–30 | ~$2,400–$4,500 |
| PMF gate | 50 | ~$5K |

### Content Calendar (Month 3)

- Week 1: Launch post on all channels simultaneously
- Week 2: First subscriber feedback → iterate onboarding
- Week 3: "Week 2 live trading results" transparency post
- Week 4: Cold outreach to 20 active Polymarket traders (DM on Discord/CT)

---

## Success Criteria

- [ ] Automated trading loop running 24/7 without manual intervention
- [ ] Polar.sh subscription webhook → auto-onboarding pipeline working
- [ ] Starter tier: signal API endpoint live and returning daily digests
- [ ] Pro tier: at least 1 test subscriber with real wallet execution working
- [ ] `docs/trading-performance.md` updated weekly (trust anchor)
- [ ] 1 paying subscriber by end of Month 3
- [ ] Own-account P&L > 0 over 30 days

---

## Files Created/Modified

| Action | File |
|--------|------|
| Create | `src/raas/signal-feed-publisher.ts` |
| Create | `src/raas/signal-feed-api.ts` |
| Create | `src/raas/subscriber-executor.ts` |
| Modify | `src/dashboard/` (add performance view) |
| Create | `docs/onboarding-guide.md` |
| Modify | `src/scheduler/` (add cron for prediction loop) |

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Polar.sh rejects product | Use "prediction market analytics SaaS" — no trading/gambling terms |
| RaaS users blow up accounts | Hard-coded half-Kelly + daily stop enforced per subscriber; add disclaimer |
| Solo ops bottleneck at 50+ subscribers | Automate onboarding fully; Telegram bot for self-serve support |
| Edge degrades at scale | Monitor own-account Sharpe weekly; pause RaaS if edge < 2% over 30 days |

---

## Unresolved Questions

1. Pro tier stores subscriber private keys — what encryption standard? (AES-256-GCM at rest minimum)
2. Should P&L reporting be real-time or daily snapshot? Real-time = higher trust, higher infra complexity.
3. Open-source license: MIT (max distribution) vs BSL-1.1 (restricts commercial forks) — decide before GitHub launch.
