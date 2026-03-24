# HFT & Prediction Market Intelligence Gathering

**Date:** 2026-03-24 15:04 ICT
**Purpose:** Real-time intelligence while DeepSeek R1 batch runs on M1 Max

---

## 1. Polymarket Bot Landscape (March 2026)

### Dominant Strategies

| Strategy | Win Rate | Edge | Capital Needed | Our Overlap |
|----------|----------|------|---------------|-------------|
| Latency arbitrage (BTC 5min) | 98% | 1.5-3%/trade | $4K-5K/trade | NONE — different game |
| Rebalancing arb (YES+NO < $1) | 85%+ | $40M total profit 2024-2025 | Low | NONE — mechanical |
| Combinatorial arb | 70-80% | Cross-market mispricing | Medium | NONE — needs multi-market |
| LLM directional (our category) | 65-75% backtest, 60-65% live | 8-15% | $100-2K/trade | THIS IS US |
| News speed trading | 80%+ | First to react | Sub-100ms infra | NONE — need HFT infra |

### Key Numbers
- **14/20** most profitable Polymarket wallets = bots
- **92.4%** of ALL Polymarket wallets lose money
- Arbitrage window: compressed from 12.3s (2024) → **2.7s (2026)**
- One bot: $313 → $414,000 in 1 month (latency arb on crypto)
- ClawHub: 13,700+ skills, 311+ finance-focused
- **1,184 malicious skills** purged early 2026 (wallet stealers)

### Edge Decay Timeline
- Sentiment arbitrage (2024): 30-50% → now 5-10%
- Event-driven LLM (us): 15-25% → will compress to 8-12% by Q4 2026
- Simple arb plays: "sniped in milliseconds by HFT bots"

---

## 2. DeepSeek R1 Calibration Reality

### Benchmarks
- AIME 2025: **87.5%** accuracy (up from 70%)
- MATH-500: **97.3%** pass@1
- Comparable to OpenAI o1 on reasoning

### Calibration for Forecasting (CRITICAL)
- **NO specific calibration benchmarks exist** for probability estimation
- LLMs show "persistent overconfidence at high-probability levels"
- LLM-superforecaster parity projected: **late 2026** (95% CI: Dec 2025 – Jan 2028)
- Current LLMs: better than generic crowd, **worse than elite superforecasters**
- Best Brier: RLVR fine-tuned models achieve ECE ~0.042

### Implication for Us
Our edge comes from **blind prompting technique**, NOT from DeepSeek R1's inherent calibration. The model is a tool; the strategy is the moat.

---

## 3. Superforecasting + LLM Research Findings

### What Works
- **RLVR fine-tuning** on Brier rewards → best calibration (but requires training, not applicable to us)
- **Human-LLM hybrid**: LLM + superforecaster "commandments" → +23-43% accuracy improvement
- **Outside view + Inside view** combination → ~40% better calibration (we just implemented this)
- **Agentic search + supervisor reconciliation** → matches superforecaster median

### What DOESN'T Work
- "Prompt engineering has minimal to nonexistent effect on forecasting" — standard prompting tricks don't help
- Narrative/fictional framing hurts
- Higher temperature doesn't improve calibration

### What This Means for OpenClaw + DeepSeek R1
1. Our **structural prompt** (outside/inside view framework) is the RIGHT approach
2. Don't waste time on prompt tricks — focus on information quality
3. Consider **ensemble approach**: run same question 3x, take median probability
4. Future: RLVR fine-tuning on our own Brier scores (after 200+ resolved trades)

---

## 4. OpenClaw Ecosystem Intelligence

### Competitors
- `chainstacklabs/polyclaw` — most popular Polymarket skill
- `0xrsydn/polymarket-crypto-toolkit` — BTC 5min mean reversion
- `openclaw-ai-polymarket-trading-bot` — crypto 5min up/down
- `TopTrenDev/openclaw-polymarket-betting-bot` — TypeScript skeleton

### Our Differentiation vs Open-Source Bots
| Feature | OSS Bots | CashClaw (Us) |
|---------|----------|---------------|
| Strategy | Crypto 5min arb | Event-only LLM prediction |
| Model | Cloud API (OpenAI) | Local DeepSeek R1 (free) |
| Edge type | Speed (latency) | Knowledge (calibration) |
| Market type | Crypto/price | Politics/geopolitics/events |
| Sustainability | Decaying fast | 6-12 months runway |
| Cost | API fees eat profit | $0 inference on M1 Max |

### Security Warning
1,184 malicious ClawHub skills detected early 2026. NEVER run untrusted skills. Our local-only approach is inherently more secure.

---

## 5. Actionable Intelligence for BINH_PHAP_TRADING

### Immediate Actions (This Week)
1. **Ensemble voting**: Run each prediction 3x, take median → reduces variance
2. **Market filter upgrade**: Prioritize markets with < 500 participants (less efficient)
3. **Avoid crypto 5-min markets**: Dominated by latency arb bots, no LLM edge
4. **Track alpha decay**: Log avg |edge| per week, if dropping below 8% → pivot

### Medium-Term (1-2 Months)
1. **RLVR fine-tuning**: After 200+ resolved trades, fine-tune on own Brier scores
2. **News integration**: Add real-time news context to prompts (biggest alpha = knowing new info first)
3. **Multi-model ensemble**: DeepSeek R1 + Claude (API) vote → potential calibration boost
4. **Category specialization**: Train on category-specific accuracy (politics vs sports vs tech)

### What NOT to Do
- Don't chase 90% win rate (trap — leads to ruin on black swans)
- Don't compete on latency (need sub-100ms, we have ~30s inference)
- Don't deploy capital before 30+ resolved trades validate edge
- Don't trust ANY third-party OpenClaw skills without full code review

---

## Sources

- [Arbitrage Bots Dominate Polymarket](https://finance.yahoo.com/news/arbitrage-bots-dominate-polymarket-millions-100000888.html)
- [How AI Bots Make Millions on Polymarket](https://dev.to/andrew-ooo/how-ai-trading-bots-are-making-millions-on-polymarket-l5g)
- [Why 92% of Polymarket Traders Lose Money](https://medium.com/technology-hits/why-92-of-polymarket-traders-lose-money-and-how-bots-changed-the-game-2a60cd27df36)
- [AI Helping Retail Exploit Prediction Market Glitches](https://www.coindesk.com/markets/2026/02/21/how-ai-is-helping-retail-traders-exploit-prediction-market-glitches-to-make-easy-money)
- [Polymarket HFT Strategies](https://www.quantvps.com/blog/polymarket-hft-traders-use-ai-arbitrage-mispricing)
- [OpenClaw Polymarket Bot Guide](https://flypix.ai/openclaw-polymarket-trading/)
- [Prompt Engineering LLM Forecasting](https://arxiv.org/pdf/2506.01578)
- [Wisdom of Silicon Crowd](https://www.science.org/doi/10.1126/sciadv.adp1528)
- [LLM vs Superforecasters](https://forecastingresearch.substack.com/p/ai-llm-forecasting-model-forecastbench-benchmark)
- [Claude AI Bots on Polymarket](https://medium.com/@weare1010/claude-ai-trading-bots-are-making-hundreds-of-thousands-on-polymarket-2840efb9f2cd)
- [Prediction Markets Bot Playground](https://www.tradingview.com/news/financemagnates:7f126ddf1094b:0-prediction-markets-are-turning-into-a-bot-playground/)
- [OpenClaw Trading Guide 2026](https://openclawforge.com/blog/openclaw-for-trading-complete-2026-guide-automated-trading-ai-agents/)

---

## Unresolved Questions

1. Polymarket API rate limits — how many markets can we scan per minute without getting blocked?
2. Can we detect when a market is dominated by a single bot's pricing?
3. Is there a way to access Polymarket participant count per market via API?
4. How does edge correlate with market resolution timeframe? (7d vs 30d vs 90d)
5. What's the cost/benefit of RLVR fine-tuning DeepSeek R1 vs just better prompting?
