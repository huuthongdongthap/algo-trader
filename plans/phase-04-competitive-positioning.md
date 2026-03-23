---
title: "Competitive Positioning — AlgoTrade"
status: complete
created: 2026-03-24
---

# Phase 4 — Competitive Positioning

## Our Wedge

AI prediction quality on **long-tail markets** (volume < $100K, 7-30 day resolution).
NOT speed. NOT market making. NOT arb.

---

## Direct Competitors

| Competitor | What They Do | Why We Win |
|---|---|---|
| Polymarket HFT bots | Sub-100ms arb on high-volume markets | Different terrain — we target markets they ignore |
| Claude/GPT-based bots | Generic LLM analysis, no sizing, no execution loop | Local inference (no API cost), Kelly sizing, full loop |
| Proprietary quant firms | Capital-heavy, ignore <$100K markets (too small) | Our sweet spot is their noise floor |

## Indirect Competitors

| Competitor | What They Do | Our Edge |
|---|---|---|
| 3Commas | CEX algo trading (crypto pairs) | Prediction markets = different asset class, no 3C playbook |
| Hummingbot | Open-source market making | MM unwinnable on Polymarket; we do directional prediction |
| Manual traders | Gut + news reading | We automate + Kelly-size + run 50+ markets simultaneously |

---

## Differentiation Matrix

| Dimension | AlgoTrade | HFT Bots | 3Commas | Hummingbot |
|---|---|---|---|---|
| Market type | Prediction markets | Prediction markets | CEX pairs | CEX/DEX |
| Strategy | AI directional | Speed arb | Copy trading | Market making |
| LLM analysis | Yes (local) | No | No | No |
| Kelly sizing | Yes | No | No | No |
| Long-tail focus | Yes | No | N/A | N/A |
| Self-hosted | Yes | No | No | Yes |
| Price | $49-499/mo | N/A | $29-99/mo | Free |

---

## Positioning Statement

> AlgoTrade is the only prediction market engine that combines local LLM edge analysis
> with Kelly-optimal sizing, targeting long-tail markets where speed is irrelevant
> and information quality is the only moat.
