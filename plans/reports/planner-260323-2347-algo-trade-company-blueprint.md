# Planner Report: AlgoTrade Company Blueprint

**Date:** 2026-03-23 23:47 | **Command:** /idea | **Stage:** Zero → PSF

---

## Summary

Classified AlgoTrade as **Zero stage** (code exists, 0 revenue, 0 trades). Generated two artifacts:

1. `.mekong/company.json` — machine-readable company config
2. `plans/company-blueprint/plan.md` — 3-phase execution plan (6 weeks to first subscriber)

---

## Key Decisions

**Positioning confirmed:** AI prediction edge (NOT market maker). Research validated this pivot — MM is institutionally captured, LLM latency rules out HFT. Long-tail Polymarket markets (< $100K volume, 7-30 day resolution) are the viable terrain.

**Phase gate logic:**
- Phase 1 exit: 50 paper trades, edge > 5% on >20% of scanned markets
- Phase 2 exit: 10 real trades, positive EV confirmed
- Phase 3 exit: 1 paying subscriber, own trading P&L > 0 over 30 days

**ARR path to $1M:** ~700 subscribers at mixed pricing (60/30/10 Starter/Pro/Elite = ~$120/avg). Achievable if prediction edge is demonstrable and onboarding is frictionless.

---

## Files Created

- `/Users/macbookprom1/projects/algo-trade/.mekong/company.json`
- `/Users/macbookprom1/projects/algo-trade/plans/company-blueprint/plan.md`

---

## Unresolved Questions

1. Qwen 32B vs DeepSeek 70B — which model calibrates better on binary prediction markets?
2. Own-trading P&L: public (trust signal) vs private (competitive moat)?
3. Gas costs on Polygon — does $1K bankroll sustain 50 trades/week net-positive after fees?
4. Polymarket ToS — does automated trading require explicit platform approval?
