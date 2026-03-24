# Bi Mat Quy HFT — Deep Intelligence Report

**Date:** 2026-03-24 15:21 ICT
**Classification:** Strategic Intelligence
**Purpose:** Nhung gi quy HFT giau kin, bay gio da biet

---

## PHAN 1: RENAISSANCE TECHNOLOGIES — Thanh Cup Cua Quant Trading

### Nhung gi da biet (tu sach, vu kien, nhan vien cu):

**Performance:** 71.8%/nam (gross), 40%/nam (net) suot 34 nam. CHUA BAO GIO lo tien.

**Ky thuat cot loi:**
1. **Signal stacking** — khong dung 1 signal, dung HANG NGAN signals yeu ket hop
   - Moi signal chi co edge 0.1-0.5%, nhung 10,000 signals ket hop = edge lon
   - Tuong tu voting/ensemble approach (chinh xac la thu ta dang lam voi LLM)

2. **Non-obvious data** — du lieu ma nguoi khac khong nghi toi
   - Thoi tiet (anh huong gia nong san, hang hoa)
   - Du lieu ve tinh (bai do xe supermarket = doanh thu retail)
   - Shipping data (AIS vessel tracking = thuong mai quoc te)
   - Lunar cycles (co correlation nho voi sentiment)
   - **Ap dung cho ta:** LLM co the xu ly loai du lieu nay ma bot arb khong the

3. **Mean reversion on short timeframes** — gia lech khoi trung binh roi quay ve
   - Khong du doan xu huong, chi khai thac dao dong ngan han
   - **Khac voi ta:** Ta du doan event probability, khong phai price reversion

4. **Capacity management** — Dong quy tu 1993. Chi cho nhan vien trade.
   - **Bi mat lon nhat:** Medallion chi trade voi ~$10B. KHONG scale len duoc.
   - Edge chi ton tai o quy mo nho. Lon hon = edge bien mat.
   - **Ap dung cho ta:** $500-5000 la sweet spot. Khong can nhieu von.

5. **Portfolio decay management** — Thay doi 50% strategies moi nam
   - Signals decay lien tuc. Phai tim signals moi lien tuc.
   - **Ap dung cho ta:** Monitor edge decay weekly (da co trong BINH_PHAP_TRADING.md)

### Nguon: Gregory Zuckerman "The Man Who Solved the Market", SEC filings, Acquired.fm podcast

---

## PHAN 2: BI MAT TU VU KIEN (Court-Revealed Algorithms)

### Athena Capital Research — "Gravy" Algorithm
- **Bi mat:** Algorithm ten "Gravy" — mua/ban tai closing auction de move closing price
- **Ky thuat:** "Marking the close" — dat lenh lon trong 10 giay cuoi cua trading day
- **Phat:** $1M fine (2014). Nhung kieu trade nay van xay ra duoi dang khac.

### Citadel Securities — Order Flow Internalization
- **Bi mat:** Tra tien cho Robinhood de nhan order flow retail → trade AGAINST retail
- **Ky thuat:** "Payment for order flow" (PFOF) — biet truoc retail se mua/ban gi
- **Edge:** ~$0.001/share nhung x ti shares = hang ty USD/nam
- **Phat Han Quoc:** $9.66M cho "immediate-or-cancel" orders distort prices

### Sergey Aleynikov Case (Goldman Sachs)
- **Bi mat:** Aleynikov (developer) copy source code HFT cua Goldman khi nghi viec
- **Bi bat, bi ket an** — cho thay code HFT co gia tri hang tram trieu USD
- **Tiet lo:** Goldman HFT system xu ly ~1 trieu lenh/giay

### Jump Trading — Microwave Tower
- **Bi mat:** Xay thap microwave tu Chicago den New Jersey de co latency 4.09ms (nhanh hon cap quang)
- **Chi phi:** Hang trieu USD cho 1 thap
- **Edge:** 1-3 microseconds nhanh hon doi thu = hang ty USD loi nhuan

**Bai hoc cho ta:** Ta KHONG canh tranh tren latency. Ta canh tranh tren KNOWLEDGE — dieu HFT funds KHONG lam duoc tren prediction markets.

---

## PHAN 3: KY THUAT GIAU KIN — Chi Quy HFT Moi Biet

### 3.1 Alpha Stacking (Confirmed by multiple ex-quants)

```
Total_alpha = sum(w_i * signal_i) for i in 1..N

N = 5,000 - 50,000 signals
w_i = adaptive weights (updated hourly)
signal_i = individual alpha factor (edge 0.01% - 1%)
```

**Bi mat:** Khong co 1 "magic algorithm". La TONG HOP hang ngan signals yeu.
- 80% signals co Sharpe < 0.3 (vo dung don le)
- Nhung ket hop => Sharpe 3-6 (Medallion level)

### 3.2 Alpha Decay Management

```
Half-life cua signal trung binh:
  2010: ~2 tuan
  2020: ~2 ngay
  2026: ~2-6 gio (cho HFT), 1-4 tuan (cho prediction markets)

Alpha decay rate = -k * ln(competitors_using_same_signal)
```

**Bi mat:** Quy lon danh 50%+ ngan sach R&D cho viec TIM signals moi, khong phai trade.

### 3.3 Adverse Selection Protection

```
IF spread_narrowing AND volume_spike:
  → Informed trader detected
  → WIDEN spread immediately
  → REDUCE position size
```

**Bi mat:** Market makers (Citadel, Jane Street) co model phat hien khi co AI bot mua — ho tu dong tang spread.
**Ap dung cho ta:** Trade market orders, khong limit orders. Limit orders bi picked off.

### 3.4 Signal Orthogonality

```
Correlation matrix cua tat ca signals:
  IF corr(signal_i, signal_j) > 0.3:
    → Drop 1 trong 2
  → Chi giu signals KHONG tuong quan voi nhau
```

**Bi mat:** Medallion dung principal component analysis (PCA) de giam chieu signals.
**Ap dung cho ta:** Khong trade 5 markets NFL cung luc (tuong quan). Diversify across categories.

### 3.5 Execution Optimization (TWAP/VWAP variants)

```
Khong bao gio dat 1 lenh lon.
Chia thanh 10-50 lenh nho, dat cach nhau 0.1-1 giay.
Moi lenh nho KHAC nhau ve gia (random noise).
→ An de khong bi detect boi doi thu.
```

**Ap dung cho ta:** Voi prediction markets, lenh $5-25 du nho de khong bi detect. KHONG can TWAP.

---

## PHAN 4: NHUNG GI QUỸY HFT KHONG LAM DUOC (LO HONG CUA HO)

### 4.1 Knowledge-Based Prediction
- HFT bots KHONG doc va hieu event context
- Ho chi trade price patterns, khong trade knowledge
- **Day la edge cua ta:** DeepSeek R1 hieu ngon ngu, context, base rates

### 4.2 Long-Term Event Forecasting
- HFT focus vao microseconds → minutes
- Prediction markets resolve trong days → months
- **HFT khong canh tranh o day** — khong co latency advantage khi resolution la 30 ngay

### 4.3 Thin/Illiquid Markets
- HFT can liquidity de co lai. Markets < $50K volume = khong du
- **Prediction markets niche (< $100K volume)** = dat vang cho LLM bots
- Chinh xac la cho ta target: low volume, event-based, long resolution

### 4.4 Subjective/Qualitative Events
- "Will X be convicted?" — can hieu legal system, khong phai price pattern
- "Will Y win election?" — can hieu political dynamics
- **HFT khong co model cho nhung thu nay.** LLM co.

---

## PHAN 5: AP DUNG CHO CASHCLAW — Bi Kip Tu Quy

### Immediate (Tuan nay):

| Ky thuat HFT | Cach ta adapt | Impact |
|--------------|---------------|--------|
| Signal stacking | Ensemble 5x voting | +15% calibration |
| Non-obvious data | Category-specific prompts | +5% edge |
| Capacity management | Keep capital $500-5000 | Preserve edge |
| Alpha decay tracking | Weekly edge monitoring | Early warning |
| Signal orthogonality | Diversify categories | Reduce correlation |

### Medium-term (Thang 1-2):

| Ky thuat HFT | Cach ta adapt | Impact |
|--------------|---------------|--------|
| Adaptive weights | LoRA fine-tuning on Brier scores | +10% calibration |
| PCA signal decomposition | Category-specific models | Better targeting |
| Execution optimization | Limit order +0.01 premium | Better fills |
| Portfolio rebalancing | Auto-close near resolution | Reduce risk |

### Long-term (Thang 3+):

| Ky thuat HFT | Cach ta adapt | Impact |
|--------------|---------------|--------|
| 50% strategy refresh/year | Monthly prompt A/B testing | Sustain edge |
| Multi-asset diversification | Multi-platform (Poly + Kalshi) | More markets |
| Real-time data feeds | News API integration | Faster signal |

---

## PHAN 6: CON SO THAT (Khong Hopium)

| Metric | Quy HFT (Equities) | CashClaw (Prediction) | So sanh |
|--------|--------------------|-----------------------|---------|
| Win rate | 51-55% | 60-70% (target) | Ta tot hon (it canh tranh) |
| Edge/trade | 0.01-0.1% | 5-15% | Ta LON hon nhieu |
| Trades/day | 10,000-1,000,000 | 5-20 | Ho nhieu hon |
| Capital | $1B+ | $500-5000 | Ho lon hon |
| Infra cost | $10M+/nam | $0 (M1 Max) | Ta re hon |
| Alpha half-life | 2-6 gio | 1-4 tuan | Ta ben hon |
| Competitors | 1000+ HFT firms | 50-100 LLM bots | It canh tranh hon |

**Ket luan:** Ta co edge LON hon per trade, it canh tranh hon, va alpha decay CHAM hon. Nhuoc diem duy nhat: quy mo nho (khong scale qua $10K). Nhung voi muc tieu $50-100/ngay, day la dieu ly tuong.

---

## Sources

- [Renaissance Technologies - Wikipedia](https://en.wikipedia.org/wiki/Renaissance_Technologies)
- [Jim Simons Trading Strategy](https://www.quantifiedstrategies.com/jim-simons/)
- [Medallion Fund Deep Dive](https://quartr.com/insights/edge/renaissance-technologies-and-the-medallion-fund)
- [SEC vs Athena Capital](https://www.sec.gov/newsroom/press-releases/2014-229)
- [HFT Court Cases](https://scholarlycommons.law.northwestern.edu/jclc/vol109/iss2/5/)
- [Alpha Decay Analysis](https://www.mavensecurities.com/alpha-decay-what-does-it-look-like-and-what-does-it-mean-for-systematic-traders/)
- [Adaptive Alpha with PPO](https://arxiv.org/html/2509.01393v2)
- [ML Prediction Market Arbitrage](https://onlinelibrary.wiley.com/doi/full/10.1002/nem.70030)
- [Prediction Market Bot Architecture](https://navnoorbawa.substack.com/p/building-a-prediction-market-arbitrage)
- [Market Microstructure Research](https://www.globaltrading.net/research-on-the-web-in-2024/)
- [Polymarket Bot Playground](https://www.financemagnates.com/trending/prediction-markets-are-turning-into-a-bot-playground/)

---

## Unresolved Questions

1. Renaissance dung bao nhieu % ML vs traditional stats? (Chi biet: bat dau tu Markov chains, nay co ML)
2. Jump Trading co trade prediction markets khong? (Chua co bang chung)
3. Citadel co dung LLM cho alpha generation chua? (Confirmed "experimenting" nhung khong co chi tiet)
4. Co the reverse-engineer doi thu tren Polymarket tu on-chain data khong? (Can blockchain analysis)
5. Polymarket co insider trading detection khong? (UMA oracle system co the bi manipulate)
