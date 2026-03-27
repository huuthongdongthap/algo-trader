# Reddit Posts

## r/cryptocurrency Post

**Title:** I built an open-source crypto arbitrage bot — 847 opportunities captured last month, here's what I learned

**Body:**

Hey r/CryptoCurrency,

Long-time lurker, first-time poster. I've spent the last 6 months building a crypto arbitrage trading bot, and wanted to share what I learned in case it helps others.

**What it does:**
- Scans 100+ exchanges simultaneously (Binance, Coinbase, Kraken, etc.)
- Detects price discrepancies in real-time
- Auto-executes profitable trades via API
- Supports triangular arbitrage (e.g., USDT→BTC→ETH→USDT)

**Results from last month:**
- 847 arbitrage opportunities detected
- 1,923 trades executed (94.2% success rate)
- Average profit: 1.3% per trade
- No directional risk (always market neutral)

**Key learnings:**

1. **Opportunities exist but disappear fast** — median lifetime is 200-500ms. Manual trading is nearly impossible.

2. **Fees matter more than you think** — a 0.1% fee difference between exchanges can turn a profitable arb into a loser.

3. **DEX-CEX arbitrage is underrated** — Uniswap prices lag Binance by ~2 seconds on average. That's an eternity for arb.

4. **Infrastructure is everything** — I moved from AWS us-east-1 to a VPS in Tokyo (closer to Binance servers) and cut latency by 40ms.

**Tech stack:**
- Node.js + TypeScript
- CCXT for exchange connectivity
- Redis for opportunity queue
- PostgreSQL for trade logging

**Am I rich yet?**
Not quite. The space is competitive. But the bot consistently covers my costs and generates ~$2-4K/month passive. More importantly, it's MARKET NEUTRAL — I sleep well at night.

**Open source:**
Decided to open-source it because the community helped me immensely. If you want to check it out / contribute: [GitHub link]

**AMA** — happy to answer questions about:
- Specific arbitrage strategies
- Exchange API quirks
- Backtesting methodology
- Risk management

Not financial advice. DYOR.

---

## r/defi Post

**Title:** DEX-CEX Arbitrage: How I capture 2-second price inefficiencies between Uniswap and Binance

**Body:**

r/defi friends,

Wanted to share a strategy that's been consistently profitable: **DEX-CEX arbitrage**.

**The opportunity:**

DEX prices (Uniswap, Curve) lag CEX prices (Binance, Coinbase) by 1-3 seconds on average. This creates arbitrage windows:

1. ETH pumps 2% on Binance
2. Uniswap price hasn't updated yet
3. Buy on Uniswap, sell on Binance
4. Pocket the spread (minus gas)

**Real example from yesterday:**

```
14:23:47 UTC — BTC jumps from $67,400 → $68,100 on Binance (+1.04%)
14:23:49 UTC — Uniswap WETH still trading at $67,450
14:23:51 UTC — Arbitrage detected (buy UNI, sell CEX)
14:23:54 UTC — Executed: 10 ETH arb, profit = $420 (after $87 gas)
```

**Why this works:**

- AMM pricing is mechanical (constant product formula)
- Liquidity providers rebalance slowly
- CEX order books update instantly

**Risks:**

- Gas spikes can kill profits (always calculate before executing)
- Slippage on larger trades
- Failed transactions = lost gas

**My setup:**

- Monitoring 15 DEX pools across Ethereum, Arbitrum, Polygon
- Gas price oracle for real-time fee estimation
- Auto-calculate profitability before execution
- 50ms polling interval

**Open-sourced my bot** if anyone wants to experiment: [GitHub link]

**Questions?** Happy to share more about:
- Specific pools I monitor
- Gas optimization tricks
- MEV protection strategies

---

## r/algotrading Post

**Title:** Built a market-neutral crypto arbitrage system: 3.8 Sharpe, 94% win rate, here's the breakdown

**Body:**

r/algotrading,

After 18 months of development, my crypto arbitrage system is finally stable. Thought the quant folks here might appreciate the technical deep dive.

**Strategy overview:**

Pure arbitrage (no directional exposure):
1. Simple 2-leg: Buy Exchange A, sell Exchange B
2. Triangular: 3-leg arb within same exchange
3. DEX-CEX: Cross-venue arb

**Performance (Q1 2026):**

| Metric | Value |
|--------|-------|
| Total opportunities | 2,847 |
| Trades executed | 1,923 |
| Win rate | 94.2% |
| Avg profit/trade | 1.3% |
| Sharpe ratio | 3.8 |
| Max drawdown | -4.2% |
| Avg daily PnL | +$187 |

**Infrastructure:**

```
Exchange APIs (WebSocket) → Price Normalizer → Opportunity Detector
                                                    ↓
                                            Profitability Calculator
                                                    ↓
                                            Execution Engine → Exchange APIs
                                                    ↓
                                            PostgreSQL (audit trail)
```

**Key technical challenges:**

1. **Latency arbitrage** — Some exchanges have faster APIs than others. CoinBase ~50ms, Kraken ~120ms, Binance ~80ms. Normalized with async queues.

2. **Order book modeling** — Top of book isn't enough. Need depth-10 for realistic fill probability estimation.

3. **Slippage estimation** — Used historical fill data to model slippage as function of order size / 24h volume.

4. **Failover logic** — If leg 1 fills but leg 2 fails, you're now directional. Built in auto-hedge with stop-loss.

**Backtesting methodology:**

- Tick-level data from 6 exchanges
- Modeled latency + slippage + fees
- Walk-forward optimization (no look-ahead bias)
- Monte Carlo simulation for edge cases

**Tech stack:**

- Node.js + TypeScript (considering Rust for latency-critical paths)
- CCXT for exchange connectivity
- Redis for opportunity queue
- PostgreSQL + TimescaleDB for historical data
- Grafana for real-time monitoring

**Open source:** [GitHub link]

Happy to discuss:
- Specific execution logic
- Backtesting framework
- Risk management parameters
- Exchange API quirks

Not financial advice.
