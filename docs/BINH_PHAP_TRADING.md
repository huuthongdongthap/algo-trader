# BINH PHAP TRADING - Chien Luoc Giao Dich Theo Ton Tu

> **"Tri bi tri ki, bach chien bach thang"** - Biet minh biet nguoi, tram tran tram thang.
> Applied to prediction market trading with DeepSeek R1 on Polymarket.

---

## DNA — 7 Quy Luat Bat Bien

> Nhung quy luat nay KHONG BAO GIO thay doi. Du model thay doi, market thay doi,
> platform thay doi — DNA van dung. Day la thu DeepSeek R1 phai HOC THUOC.

### DNA-1: EDGE = INFORMATION ASYMMETRY (Shannon-Kelly)

```
G* = W * log2(1 + edge) — toc do tang truong toi da = edge * log

Kelly: f = edge / odds
Quarter-Kelly: f = edge / (4 * odds)
```

**Ban chat:** Loi nhuan den tu viec BIET NHIEU HON market. Khong phai tu viec trade nhieu, trade nhanh, hay trade lon. Ma tu viec co THONG TIN MA NGUOI KHAC KHONG CO.

**Ap dung:** DeepSeek R1 co loi the khi no HIEU context su kien tot hon crowd. No doc luat, hieu chinh tri, biet base rate. Day la information advantage cua ta.

### DNA-2: CALIBRATION > ACCURACY (Tetlock)

```
Brier Score = (1/N) * sum((forecast_i - outcome_i)^2)

Calibration: Khi noi 70%, xay ra dung 70%
Resolution: Phan biet duoc 30% vs 70%
Tot nhat: Calibrated + Sharp (phan biet cao)
```

**Ban chat:** Khong can DUNG moi luc. Can BIET MINH DUNG BAO NHIEU. Noi "60% chac" khi that su la 60% — QUAN TRONG HON noi "chac chan" roi sai.

**Ap dung:** DeepSeek R1 phai output xac suat CALIBRATED, khong phai confident. Confidence cao + sai = mat tien. Confidence vua + dung = kiem tien.

### DNA-3: BASE RATE TRUOC, ADJUSTMENT SAU (Kahneman)

```
P(event) = P(base_rate) * Likelihood_ratio

Buoc 1: "Bao nhieu % su kien tuong tu xay ra?" (Outside View)
Buoc 2: "Truong hop nay co gi dac biet?" (Inside View)
Buoc 3: "Toi co dang anchored vao ky vong bat thuong khong?" (De-bias)
```

**Ban chat:** Con nguoi (va LLM) mac loi BASE RATE NEGLECT — bo qua ty le co ban, chi tap trung vao chi tiet cu the. Day la loi PHAI TRANH nhat.

**Ap dung:** Prompt DeepSeek R1 LUON bat dau bang "Base rate cua su kien tuong tu la bao nhieu?" TRUOC KHI phan tich chi tiet.

### DNA-4: EDGE NHO x NHIEU LAN = LOI NHUAN LON (Renaissance)

```
E[profit] = N * avg_edge * avg_size
  where N = so trade, avg_edge = edge trung binh

Medallion: 10,000 signals * 0.1% edge = Sharpe 6
CashClaw:  20 signals/day * 15% edge = strong edge per trade
```

**Ban chat:** Khong can 1 trade sieu lon. Can NHIEU trade voi edge NHO MA NHAT QUAN. Consistency > brilliance.

**Ap dung:** Trade 5-20 markets/ngay voi edge 5-20%. Khong doi trade "hoan hao". Spread risk across nhieu markets.

### DNA-5: CROWD SAI O DAU → TRADE O DO (Behavioral Economics)

```
Crowd failure modes:
  1. Anchoring: Gia hien tai → ky vong tuong lai (mispricing near round numbers)
  2. Recency bias: Su kien gan day → qua trong (overreact to news)
  3. Availability bias: Su kien de nho → qua cao (celebrity markets overpriced)
  4. Herding: Nguoi khac mua → toi mua (momentum without info)
  5. Neglect of base rates: Chi tiet → bo qua xac suat co ban
```

**Ban chat:** Prediction markets KHONG perfect. Crowd mac 5 loi tren LIEN TUC. Day la noi edge cua ta ton tai.

**Ap dung:** DeepSeek R1 duoc thiet ke DE TRANH 5 loi nay:
- Blind estimation (tranh anchoring)
- Base rate first (tranh neglect)
- No market price shown (tranh herding)
- Fermi decomposition (tranh availability bias)
- Outside view (tranh recency bias)

### DNA-6: FREQUENCY FORMAT > PROBABILITY FORMAT (Gigerenzer)

```
SAI: "Co 30% kha nang"
DUNG: "Trong 10 truong hop tuong tu, 3 truong hop xay ra"

Frequency format giup Bayesian reasoning tang 50%
```

**Ban chat:** Bo nao (va LLM) xu ly frequency ("3 trong 10") tot hon probability ("30%"). Day la ky thuat de-biasing manh nhat da duoc chung minh.

**Ap dung:** Trong prompt, hoi DeepSeek R1: "Trong 100 su kien tuong tu nhu the nay, bao nhieu su kien se xay ra?" thay vi "Xac suat la bao nhieu?"

### DNA-7: TRI BI TRI KI — BIET GIOI HAN CUA MINH (Ton Tu)

```
DeepSeek R1 GIOI:          DeepSeek R1 YEU:
- Base rate estimation     - Real-time data (knowledge cutoff)
- Logical reasoning        - Niche/obscure events
- Political analysis       - Exact prices/numbers
- Legal interpretation     - Sports statistics
- Scientific assessment    - Breaking news reaction
```

**Ban chat:** Suc manh thuc su KHONG phai biet moi thu. Ma la BIET MINH KHONG BIET GI. Trade chi trong vung minh manh. Skip vung minh yeu.

**Ap dung:** Filter cung: chi trade events ma DeepSeek R1 co knowledge advantage. Skip crypto, sports stats, breaking news.

---

> **TOM TAT DNA:** Edge = Information. Calibration > Accuracy. Base rate first.
> Small edge x many trades. Exploit crowd biases. Use frequency format. Know your limits.
>
> 7 quy luat nay la XUONG SONG cua BINH_PHAP_TRADING.
> Moi quyet dinh trade PHAI qua 7 checkpoint nay.

---

## Triet Ly Core

| Chuong | Nguyen Tac | Ap Dung Trading |
|--------|-----------|-----------------|
| Si Ke (Initial Calculations) | Tinh toan truoc khi danh | Paper trade truoc, validate accuracy truoc khi dung tien that |
| Tac Chien (Waging War) | Chien tranh ton kem, phai nhanh | Giam latency LLM, toi uu prompt, khong giu lenh qua lau |
| Muu Cong (Attack by Stratagem) | Thang khong can danh | Chi trade khi co EDGE ro rang (>5%), skip khi khong chac |
| Quan Hinh (Military Disposition) | Phong thu truoc, tan cong sau | Risk management truoc profit, stop-loss truoc take-profit |
| Binh The (Energy) | Tap trung luc tai diem yeu | Chi trade event markets (LLM co edge), tranh price markets |
| Hu Thuc (Weaknesses) | Tan cong cho yeu cua doi thu | Tim markets ma crowd sai (mispriced), LLM co thong tin tot hon |

---

## 1. RECONNAISSANCE - Trinh Sat Chien Truong

### 1.1 Market Selection (Dia Hinh)

**GO markets (LLM co edge):**
- Political events (elections, legislation)
- Geopolitical events (conflicts, treaties)
- Science/tech milestones (AI benchmarks, space launches)
- Sports outcomes (non-spread, event-based)
- Entertainment (awards, releases)

**NO-GO markets (LLM KHONG co edge):**
- Price predictions (crypto, stocks, commodities)
- Weather exact temperatures
- O/U spreads, point spreads
- Any market requiring real-time data LLM khong co

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

## 2. INTELLIGENCE - Thu Thap Tinh Bao

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

### 2.3 Prompt Engineering

```
System: "You are a superforecaster with calibrated probability estimates.
  Estimate TRUE probability using base rates, evidence, reasoning.
  Do NOT ask for or assume any market price.
  Give your independent estimate.
  Respond ONLY with valid JSON."

User: "Prediction market question: [QUESTION]
  Resolution criteria: [CRITERIA]
  Estimate probability this event occurs.
  Think step by step: base rate, recent evidence, key factors.
  Do NOT guess what the market thinks. Give YOUR independent estimate.
  Respond with ONLY this JSON:
  {probability:0.0-1.0, confidence:0.0-1.0, reasoning:'3 sentences max'}"
```

---

## 3. BATTLE PLAN - Ke Hoach Tac Chien

### 3.1 Position Sizing (Half-Kelly)

```
size = capital * kellyFraction * min(|edge| * confidence, maxPositionFraction)

Default:
  kellyFraction = 0.5 (half-Kelly, conservative)
  maxPositionFraction = 0.05 (max 5% per trade)
  minTradeUsdc = 5 (minimum viable trade)
```

**Why Half-Kelly?**
- Full Kelly maximizes geometric growth but has extreme drawdowns
- Half-Kelly: ~75% of full Kelly growth, ~50% of drawdown
- With uncertain edge estimates, fractional Kelly is mandatory

### 3.2 Edge Thresholds

| Edge Range | Action | Confidence Required |
|-----------|--------|-------------------|
| |edge| < 5% | SKIP | - |
| 5% <= |edge| < 10% | Small position | confidence >= 0.6 |
| 10% <= |edge| < 20% | Standard position | confidence >= 0.5 |
| |edge| >= 20% | Large position (review first) | confidence >= 0.7 |

### 3.3 Trade Execution

```
1. PredictionLoop scans markets every 15 min
2. Filter: event-only, volume range, resolution window
3. Estimate: blind probability via DeepSeek R1
4. Rank: by |edge| descending
5. Size: Half-Kelly on top signals
6. Execute: limit order slightly above market (0.01 premium)
7. Log: every decision to ai_decisions + paper_trades_v3
```

---

## 4. RISK MANAGEMENT - Phong Thu

### 4.1 Stop Rules (Khong Vi Pham)

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
IF accuracy_last_50 < 50%:   PAUSE + review strategy
IF brier_score > 0.30:       REDUCE position sizes by 50%
IF 5_consecutive_losses:     PAUSE for 24h
IF LLM_parse_error_rate > 20%: HALT + fix parser
```

---

## 5. MONITORING - Giam Sat Chien Truong

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

## 6. GO/NO-GO CRITERIA - Quyet Dinh Xuat Quan

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

## 7. OPTIMIZATION - Toi Uu Chien Thuat

### 7.1 Prompt Tuning (Based on Monitoring Data)

**If overconfident (predicted > actual):**
- Add "Be conservative in your estimate"
- Reduce kellyFraction from 0.5 to 0.25
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
  Batch B: Qwen 32B (faster, less reasoning)
  Compare: accuracy, Brier, calibration, latency

Decision: switch if Batch B significantly better on all metrics
```

### 7.3 Strategy Evolution

| Version | Change | Trigger |
|---------|--------|---------|
| v1.0 | Blind event-only | Initial strategy |
| v1.1 | Adjust edge thresholds | After 50 resolutions |
| v1.2 | Add category-specific prompts | If some categories consistently better |
| v2.0 | Ensemble (DeepSeek + Qwen vote) | If AB test shows complementary strengths |
| v2.1 | Add news context to prompt | If LLM knowledge cutoff hurts accuracy |

---

## 8. RETREAT PROTOCOL - Ke Hoach Rut Lui

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

# Monitor behavior (new script)
node scripts/monitor-deepseek-behavior.mjs

# AB test models
node scripts/ab-test-models.mjs

# Start live trading (dry-run first!)
node scripts/start-trading-bot.mjs --dry-run --capital=200

# Stats server for dashboard
node scripts/stats-server.mjs 3000 data/algo-trade.db
```

---

_Version: 1.0.0_
_Strategy: blind_event_only with DeepSeek R1 32B_
_Author: CashClaw AlgoTrade Team_
_Last Updated: 2026-03-24_
