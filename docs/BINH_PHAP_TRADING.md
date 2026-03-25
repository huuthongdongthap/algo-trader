# BINH PHAP TRADING — The Art of Prediction Market War

> **"Know yourself, know your enemy — a hundred battles, a hundred victories."** — Sun Tzu
> Applied to prediction market trading with DeepSeek R1 on Polymarket.

---

## DNA — 7 Immutable Laws

> These laws NEVER change. Models change, markets change, platforms change — DNA remains.
> DeepSeek R1 must internalize these before making any prediction.

### DNA-1: EDGE = INFORMATION ASYMMETRY (Shannon-Kelly)

```
G* = W * log2(1 + edge)     — max growth rate = edge * log
Kelly: f = edge / odds
Quarter-Kelly: f = edge / (4 * odds)
```

**Essence:** Profit comes from KNOWING MORE than the market. Not from trading more, trading faster, or trading bigger — but from having INFORMATION OTHERS DON'T HAVE.

**Application:** DeepSeek R1 has advantage when it UNDERSTANDS event context better than the crowd. It reads law, understands politics, knows base rates. This is our information edge.

### DNA-2: CALIBRATION > ACCURACY (Tetlock)

```
Brier Score = (1/N) * sum((forecast_i - outcome_i)^2)

Calibration: When you say 70%, it happens 70% of the time
Resolution:  Ability to distinguish 30% from 70%
Best:        Calibrated + Sharp (high resolution)
```

**Essence:** You don't need to be RIGHT every time. You need to KNOW HOW RIGHT YOU ARE. Saying "60% sure" when it's truly 60% — MORE VALUABLE than saying "certain" and being wrong.

**Application:** DeepSeek R1 must output CALIBRATED probabilities, not confident ones. High confidence + wrong = lose money. Moderate confidence + right = make money.

### DNA-3: BASE RATE FIRST, ADJUSTMENT SECOND (Kahneman)

```
P(event) = P(base_rate) * Likelihood_ratio

Step 1: "How often do similar events occur?" (Outside View)
Step 2: "What makes THIS case different?" (Inside View)
Step 3: "Am I anchored to unusual expectations?" (De-bias)
```

**Essence:** Humans (and LLMs) commit BASE RATE NEGLECT — ignoring base frequencies, focusing only on specific details. This is the #1 error to avoid.

**Application:** Prompt DeepSeek R1 to ALWAYS start with "What is the base rate for similar events?" BEFORE analyzing specific details.

### DNA-4: SMALL EDGE x MANY TRADES = BIG PROFIT (Renaissance)

```
E[profit] = N * avg_edge * avg_size
  where N = trade count, avg_edge = average edge

Medallion: 10,000 signals * 0.1% edge = Sharpe 6
CashClaw:  20 signals/day * 15% edge = strong edge per trade
```

**Essence:** No need for one massive trade. Need MANY trades with SMALL BUT CONSISTENT edge. Consistency > brilliance.

**Application:** Trade 5-20 markets/day with 5-20% edge. Don't wait for "perfect" trades. Spread risk across many markets.

### DNA-5: WHERE CROWDS FAIL → TRADE THERE (Behavioral Economics)

```
Crowd failure modes:
  1. Anchoring:        Current price → future expectation (mispricing near round numbers)
  2. Recency bias:     Recent events → overweighted (overreact to news)
  3. Availability bias: Memorable events → overpriced (celebrity markets overpriced)
  4. Herding:          Others buy → I buy (momentum without information)
  5. Base rate neglect: Specific details → ignore base frequencies
```

**Essence:** Prediction markets are NOT perfect. Crowds commit these 5 errors CONTINUOUSLY. This is where our edge lives.

**Application:** DeepSeek R1 is designed to AVOID all 5 errors:
- Blind estimation (avoids anchoring)
- Base rate first (avoids neglect)
- No market price shown (avoids herding)
- Fermi decomposition (avoids availability bias)
- Outside view (avoids recency bias)

### DNA-6: FREQUENCY FORMAT > PROBABILITY FORMAT (Gigerenzer)

```
WRONG: "There is a 30% chance"
RIGHT: "Out of 100 similar events, 30 happened"

Frequency format improves Bayesian reasoning by 50%
```

**Essence:** Brains (and LLMs) process frequencies ("3 out of 10") better than probabilities ("30%"). This is the most powerful proven de-biasing technique.

**Application:** In prompts, ask DeepSeek R1: "Out of 100 similar events like this, how many would occur?" instead of "What is the probability?"

### DNA-7: KNOW YOUR LIMITS (Sun Tzu)

```
DeepSeek R1 STRONG AT:         DeepSeek R1 WEAK AT:
- Base rate estimation          - Real-time data (knowledge cutoff)
- Logical reasoning             - Niche/obscure events
- Political analysis            - Exact prices/numbers
- Legal interpretation          - Sports statistics
- Scientific assessment         - Breaking news reaction
```

**Essence:** True strength is NOT knowing everything. It's KNOWING WHAT YOU DON'T KNOW. Trade only in your strong zone. Skip your weak zone.

**Application:** Hard filter: only trade events where DeepSeek R1 has knowledge advantage. Skip crypto prices, sports stats, breaking news.

---

> **DNA SUMMARY:** Edge = Information. Calibration > Accuracy. Base rate first.
> Small edge x many trades. Exploit crowd biases. Use frequency format. Know your limits.
>
> These 7 laws are the BACKBONE of BINH_PHAP_TRADING.
> Every trade decision MUST pass through all 7 checkpoints.

---

## Core Philosophy (Sun Tzu Chapters)

| Chapter | Principle | Trading Application |
|---------|-----------|-------------------|
| Initial Calculations | Calculate before striking | Paper trade first, validate accuracy before real money |
| Waging War | War is costly, be swift | Reduce LLM latency, optimize prompts, don't hold orders too long |
| Attack by Stratagem | Win without fighting | Only trade with CLEAR edge (>5%), skip when uncertain |
| Military Disposition | Defend first, attack second | Risk management before profit, stop-loss before take-profit |
| Energy | Concentrate force at weakness | Only trade event markets (LLM has edge), avoid price markets |
| Weaknesses & Strengths | Attack enemy weakness | Find markets where crowd is wrong (mispriced), LLM has better information |

---

## 1. RECONNAISSANCE — Battlefield Survey

### 1.1 Market Selection (Terrain)

**GO markets (LLM has edge):**
- Political events (elections, legislation)
- Geopolitical events (conflicts, treaties)
- Science/tech milestones (AI benchmarks, space launches)
- Sports outcomes (non-spread, event-based)
- Entertainment (awards, releases)

**NO-GO markets (LLM has NO edge):**
- Price predictions (crypto, stocks, commodities)
- Weather exact temperatures
- O/U spreads, point spreads
- Any market requiring real-time data LLM doesn't have

### 1.2 Filter Rules

```
PRICE_PATTERN = /\b(above|below|close above|close below|dip to|price of|
  finish.*above|finish.*below|hit.*\$|O\/U\s+[\d.]+|Points O\/U|
  Kills O\/U|Total.*O\/U|spread|handicap)\b/i

EXCLUDE_CATEGORIES = ['crypto', 'cryptocurrency', 'esports']

MIN_VOLUME = $1,000 (liquidity filter)
MAX_VOLUME = $200,000 (avoid efficient markets)
MIN_RESOLUTION_DAYS = 3 (avoid last-minute noise)
MAX_RESOLUTION_DAYS = 90 (LLM knowledge decay)
```

---

## 2. INTELLIGENCE — Information Gathering

### 2.1 Blind Estimation Strategy

**Core principle:** Do NOT show market price to LLM to avoid anchoring bias.

```
Input:  Question + Resolution criteria
Output: {probability, confidence, reasoning}
Edge:   our_prob - market_prob
```

**Why blind?** Market prices anchor LLM estimates. When shown price, LLM adjusts toward market consensus instead of independent reasoning. Blind estimation forces genuine probabilistic thinking.

### 2.2 DeepSeek R1 Behavior Profile

**Strengths:**
- Strong chain-of-thought reasoning (think blocks)
- Good at base rate estimation
- Calibrated on well-known events

**Weaknesses (monitor closely):**
- Knowledge cutoff: may not know very recent events
- Overconfidence on unfamiliar topics (confidence > actual accuracy)
- Think blocks can be verbose, eating tokens
- May produce anchored estimates near 50% when uncertain

### 2.3 Prompt Engineering (DNA-Aligned)

```
System: "You are a superforecaster trained in calibrated probability estimation.
  Use reference class forecasting: start with base rates, then adjust.
  Avoid anchoring, overconfidence, and narrative bias.
  Do NOT ask for or assume any market price.
  Respond ONLY with valid JSON."

User: "Prediction market question: [QUESTION]
  Resolution criteria: [CRITERIA]
  Estimate using this framework:
  1. BASE RATE: Out of 100 similar events, how many happened?
  2. INSIDE VIEW: What makes THIS case different?
  3. DE-BIAS: Are you anchored? Overconfident? Adjust toward base rate.
  4. FINAL: State probability.
  Respond with ONLY this JSON:
  {probability:0.0-1.0, confidence:0.0-1.0, reasoning:'base rate X/100, adjusted because...'}"
```

---

## 3. BATTLE PLAN — Trade Execution

### 3.1 Position Sizing (Quarter-Kelly)

```
size = capital * kellyFraction * min(|edge| * confidence, maxPositionFraction)

Default:
  kellyFraction = 0.25 (quarter-Kelly, conservative)
  maxPositionFraction = 0.05 (max 5% per trade)
  minTradeUsdc = 5 (minimum viable trade)
```

**Why Quarter-Kelly?**
- Full Kelly maximizes growth but has extreme drawdowns
- Quarter-Kelly: probability of halving bankroll before doubling = 1/81
- With uncertain edge estimates, fractional Kelly is mandatory

### 3.2 Edge Thresholds

| Edge Range | Action | Confidence Required |
|-----------|--------|-------------------|
| |edge| < 5% | SKIP | - |
| 5% <= |edge| < 10% | Small position | confidence >= 0.6 |
| 10% <= |edge| < 20% | Standard position | confidence >= 0.5 |
| |edge| >= 20% | Large position (review first) | confidence >= 0.7 |

### 3.3 Trade Execution Flow

```
1. PredictionLoop scans markets every 15 min
2. Filter: event-only, volume range, resolution window
3. Estimate: blind probability via DeepSeek R1 (DNA-aligned prompt)
4. Rank: by |edge| descending
5. Size: Quarter-Kelly on top signals
6. Execute: limit order slightly above market (0.01 premium)
7. Log: every decision to ai_decisions + paper_trades_v3
```

---

## 4. RISK MANAGEMENT — Defense

### 4.1 Stop Rules (Never Violate)

| Rule | Threshold | Action |
|------|----------|--------|
| Max drawdown | -20% of capital | HALT all trading |
| Max daily loss | -5% of capital | Pause until next day |
| Max position size | 5% of capital | Reject oversized orders |
| Max open positions | 10 | Queue new signals |
| Max leverage | 2x | Never exceed |
| Daily trade limit | Per license tier | Auto-enforced |

### 4.2 Portfolio Rules

- **Diversification:** Max 2 trades per category (politics, sports, etc.)
- **Correlation:** Avoid correlated bets (e.g., multiple Trump markets)
- **Time decay:** Close positions 24h before resolution if edge has narrowed
- **Gas reserves:** Always keep 1 MATIC for gas fees

### 4.3 Circuit Breakers

```
IF accuracy_last_50 < 50%:      PAUSE + review strategy
IF brier_score > 0.30:          REDUCE position sizes by 50%
IF 5_consecutive_losses:        PAUSE for 24h
IF LLM_parse_error_rate > 20%:  HALT + fix parser
```

---

## 5. MONITORING — Battlefield Surveillance

### 5.1 Key Performance Indicators (KPIs)

| KPI | Target | Alert If |
|-----|--------|----------|
| Accuracy (directional) | >= 55% | < 50% over last 30 trades |
| Brier Score | <= 0.25 | > 0.30 |
| Avg |edge| | >= 8% | < 5% (no edge) |
| Calibration gap | <= 5% per bucket | > 10% any bucket |
| Win rate (PnL) | > 0 cumulative | 3 consecutive negative days |
| LLM latency | < 60s | > 120s |
| Parse error rate | < 5% | > 20% |
| Actionable rate | 30-70% of scanned | < 20% or > 80% |

### 5.2 Calibration Buckets

```
Bucket    | Predicted | Actual (should match)
0-20%     |   ~10%    | ~10%
20-40%    |   ~30%    | ~30%
40-60%    |   ~50%    | ~50%
60-80%    |   ~70%    | ~70%
80-100%   |   ~90%    | ~90%
```

**If LLM consistently predicts 60% but actual is 40% -> overconfident bias -> adjust.**

### 5.3 Monitoring Schedule

| Frequency | Action |
|-----------|--------|
| Every 15 min | Log predictions + decisions |
| Every 6 hours | Check resolution status |
| Daily | Generate KPI report |
| Weekly | Full calibration + strategy review |
| After 30 resolved | GO/NO-GO assessment |

---

## 6. GO/NO-GO CRITERIA — Deployment Gates

### Phase 1: Paper Trading (CURRENT)

```
Requirements to proceed to Phase 2:
  [_] >= 30 resolved trades
  [_] Accuracy >= 55%
  [_] Brier score <= 0.25
  [_] Positive simulated PnL
  [_] Calibration gap < 10% all buckets
  [_] Parse error rate < 10%
```

### Phase 2: Live Trading (Small)

```
Capital: $100-200
Duration: 2 weeks minimum
Requirements to proceed to Phase 3:
  [_] >= 20 live trades executed
  [_] Actual PnL > 0
  [_] No circuit breakers triggered
  [_] Max drawdown < 10%
  [_] System stable (no crashes, no missed signals)
```

### Phase 3: Scale Up

```
Capital: $500+
Duration: 4+ weeks before selling to customers
Requirements:
  [_] Proven edge over 50+ live trades
  [_] Sharpe ratio > 1.0
  [_] Consistent daily PnL
  [_] All monitoring automated
```

---

## 7. OPTIMIZATION — Tactical Refinement

### 7.1 Prompt Tuning (Based on Monitoring Data)

**If overconfident (predicted > actual):**
- Add "Be conservative in your estimate"
- Reduce kellyFraction from 0.25 to 0.125
- Increase minConfidence threshold

**If underconfident (predicted < actual):**
- Remove conservative language
- Increase kellyFraction toward 0.5
- Lower minEdge threshold

**If calibration skewed at extremes:**
- Add "Avoid extreme probabilities (< 0.1 or > 0.9) unless very certain"
- Implement probability shrinkage toward 50%

### 7.2 Model Comparison (AB Testing)

```
Run parallel batches:
  Batch A: DeepSeek R1 32B (current)
  Batch B: Alternative model
  Compare: accuracy, Brier, calibration, latency

Decision: switch if Batch B significantly better on all metrics
```

### 7.3 Strategy Evolution

| Version | Change | Trigger |
|---------|--------|---------|
| v1.0 | Blind event-only | Initial strategy |
| v1.1 | Adjust edge thresholds | After 50 resolutions |
| v1.2 | Add category-specific prompts | If some categories consistently better |
| v2.0 | Ensemble N=5 voting | After calibration data available |
| v2.1 | Add news context to prompt | If LLM knowledge cutoff hurts accuracy |

---

## 8. RETREAT PROTOCOL — Strategic Withdrawal

### When to STOP trading entirely:

1. **Accuracy < 45% over 50+ trades** -> Strategy fundamentally broken
2. **Drawdown > 30%** -> Capital preservation mode
3. **LLM model degraded** -> New version worse than previous
4. **Market structure change** -> Polymarket changes fees/rules
5. **Regulatory risk** -> New regulations affecting prediction markets

### Recovery Steps:

```
1. HALT all live trades immediately
2. Analyze failure mode from monitoring data
3. Paper trade new strategy for 30+ trades
4. Validate GO criteria before resuming
5. Resume with HALF the previous capital
```

---

## Appendix: Command Reference

```bash
# Run paper trade batch (50 markets, event-only)
node scripts/paper-trade-event-only.mjs 50

# Check resolution status
node scripts/check-batch-resolutions.mjs

# Monitor DeepSeek R1 behavior
node scripts/monitor-deepseek-behavior.mjs

# AB test models
node scripts/ab-test-models.mjs

# Start live trading (dry-run first!)
node scripts/start-trading-bot.mjs --dry-run --capital=200

# Stats server for dashboard
node scripts/stats-server.mjs 3000 data/algo-trade.db
```

---

_Version: 2.0.0_
_Strategy: blind_event_only with DeepSeek R1 32B_
_DNA: 7 Immutable Laws (Shannon, Tetlock, Kahneman, Renaissance, Gigerenzer, Sun Tzu)_
_Author: CashClaw CashClaw Team_
_Last Updated: 2026-03-24_
