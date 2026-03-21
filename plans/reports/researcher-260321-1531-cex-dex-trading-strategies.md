# CEX/DEX Trading Strategies Research Report

**Date**: 2026-03-21 | **Scope**: 20% of platform revenue | **Target**: $200K+ ARR

---

## PART 1: CEX API LANDSCAPE (Binance, Bybit, OKX)

### Binance
- **REST API**: https://api.binance.com/api (spot/futures endpoints)
- **WebSocket**: wss://stream.binance.com:9443/ws (user data, order updates, depth)
- **Rate Limits**: 1200 requests/min (IP-based), 100K weight/min (user-based)
- **Auth**: HMAC SHA256 (API key + secret)
- **Key Trading Pairs**: BTC/USDT, ETH/USDT, SOL/USDT (high liquidity)
- **Futures Leverage**: Up to 125x (high risk/reward)

### Bybit
- **REST API**: https://api.bybit.com/v5 (unified account system)
- **WebSocket**: wss://stream.bybit.com/v5/public/spot (order book, trades)
- **Rate Limits**: 50-100 requests/sec depending on endpoint
- **Auth**: HMAC SHA256 (API key + secret + timestamp)
- **Key Trading Pairs**: USDT, USDC perpetuals with funding rates 0.01%-0.1%/8h
- **Feature**: Inverse perpetuals (profit in BTC, less correlated)

### OKX
- **REST API**: https://www.okx.com/api/v5 (consolidated spot+futures+options)
- **WebSocket**: wss://ws.okx.com:8443/ws/v5/public (multi-instrument streaming)
- **Rate Limits**: 10 requests/2sec (public), 20 requests/2sec (private)
- **Auth**: HMAC SHA256 (passphrase required in addition to key+secret)
- **Key Trading Pairs**: 500+ spot pairs, advanced options market
- **Feature**: Grid trading tools built-in

---

## PART 2: DEX PROTOCOLS & SMART CONTRACTS

### Uniswap V4 (Ethereum, Base, Arbitrum)
- **Latest**: V4 (2025) - customizable hooks, lower gas via singleton architecture
- **Key Method**: `swap()` via ISwapRouter04 (0.01%-1% fees configurable)
- **Libraries**: `ethers.js` v6 + Uniswap SDK v4
- **Slippage**: Expect 0.5%-2% on large orders; use sqrtPriceLimitX96 param
- **Factory**: 0x1F98431c8aD98523631AE4a59f267346ea31F984 (Ethereum mainnet)

### Jupiter (Solana)
- **Routing**: Auto-splits orders across Orca, Marinade, Raydium, Magic Eden
- **SDK**: @jupiter-ag/jupiter-core (v4)
- **API**: POST /quote (price routing), POST /swap (execution)
- **Slippage**: 0.5%-3% typical; supports slippageBps param
- **Speed**: Sub-second execution; low tx fees ($0.00025-$0.001)

### PancakeSwap (BSC, Ethereum)
- **Factory**: 0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73 (BSC)
- **Router**: 0x10ED43C718714eb63d5aA57B78f985F8ed5C099a
- **Fee Tiers**: 0.01%, 0.04%, 0.25%, 0.5%
- **Liquidity**: >$1B BSC; $100M+ on Ethereum

---

## PART 3: PROFITABLE STRATEGIES (CONCRETE)

### 1. CEX-DEX Arbitrage (High Opportunity)
- **Mechanism**: Buy asset on DEX (low price) → Sell on CEX (Binance) (high price)
- **Example**: ETH $2500 on Jupiter → $2505 on Binance (0.2% profit)
- **Gas Cost**: Solana $0.0005 (negligible); Ethereum $10-50 (need >0.5% spread)
- **Tool**: CCXT (Python) for CEX, ethers.js + Uniswap SDK for DEX
- **Risk**: MEV sandwich attacks; set max gas price threshold
- **Profitability**: $500-5K/day with $10-50K capital on low-gas chains

### 2. Cross-Exchange Arbitrage
- **Setup**: Binance/OKX BTC/USDT price difference historically 0.05%-0.3%
- **Example**: Buy BTC $43,200 (Bybit) → Sell $43,400 (Binance) = $200/1BTC
- **Limitation**: Withdrawal fees eat 50-80% of profit; requires exchange deposits
- **Reality Check**: Mostly profitable for large institutions; margin for retail ~0.01%

### 3. Grid Trading (CEX Dominant)
- **Setup**: Define buy/sell levels across price range; bot auto-executes
- **Binance Grid**: Native tool available; set 10-50 grids, 2%-5% price range
- **Capital Efficiency**: Turn $10K into $15K/month in sideways market (40-50% APY)
- **Tool**: Bybit/OKX native grid + custom CCXT bots
- **Risk**: Works only in ranging markets; loses in strong trends

### 4. DCA (Dollar-Cost Averaging) Bot
- **Mechanism**: Buy fixed amount daily/weekly regardless of price
- **Use Case**: Retail-friendly; reduce timing risk
- **APY**: 15-25% if market goes up; holds in bear markets
- **Tool**: CCXT + simple schedule (cron + Python)
- **Capital**: $100-10K/month; scales to any amount

### 5. Funding Rate Arbitrage (Futures)
- **Setup**: Long spot + short perpetual (or vice versa); pocket funding rate
- **Rate**: Bybit/OKX typically 0.01%-0.1% every 8 hours
- **APY**: 3%-36% annualized on capital
- **Capital Required**: $5K-50K to avoid liquidation risk
- **Execution**: Enter spot buy, short 1x perpetual; hold until close
- **Tool**: CCXT + manual management or custom bots

### 6. MEV/Sandwich Prevention (Ethical)
- **Don't**: Create sandwich attacks (buy before user, sell after)
- **Do**: Use intent-based DEX (CoW Protocol, MEV-resistant chains like Solana)
- **Tool**: Solana Jupiter for MEV protection; Ethereum private mempools (Flashbots, MEV-Blocker)

---

## PART 4: KEY LIBRARIES & TECH STACK

| Purpose | Library | Language | Use Case |
|---------|---------|----------|----------|
| CEX API | CCXT | Python/Node.js | Unified CEX trading |
| DEX Swap | ethers.js v6 | TypeScript/JS | Ethereum smart contracts |
| DEX Swap | web3.py | Python | Ethereum (Python-first) |
| Solana | @solana/web3.js | TypeScript | Jupiter, Raydium |
| Price Routing | @jupiter-ag/jupiter-core | TypeScript | Solana DEX routing |
| Monitoring | node-cron | Node.js | Periodic task scheduling |
| Backtesting | backtrader | Python | Strategy validation |
| Risk Mgmt | TypeError checks | All | Position sizing |

**Recommended Stack**: Node.js + TypeScript (CCXT + ethers.js) for unified CEX/DEX trading.

---

## PART 5: RISK MANAGEMENT ESSENTIALS

| Risk | Mitigation | Implementation |
|------|-----------|-----------------|
| **Liquidation** | Max 2x leverage, 10% stop-loss | Code: `if(unrealizedLoss > capitalPercent * 0.1) closePosition()` |
| **Max Drawdown** | Portfolio: max 20%; position: max 5% | Track running max; reset on new ATH |
| **Slippage** | Set slippageBps param, test on testnet | CCXT: `amount * 0.995` (0.5% buffer) |
| **API Fail** | Fallback endpoints, exponential backoff | Retry 3x with 2s, 4s, 8s delays |
| **MEV Loss** | Use private relays (Flashbots) | Ethereum only; Solana inherently safer |

---

## PART 6: INFRASTRUCTURE & LATENCY

- **Co-location**: Binance/OKX co-lo not needed for <100ms strategies
- **VPS**: Hetzner DE ($5/mo, 10ms to Binance EU), AWS US-East ($20/mo)
- **Bandwidth**: <1 Mbps sufficient; WebSocket streaming 10-50 KB/sec
- **Database**: SQLite or PostgreSQL for order history; CSV for quick start

---

## PART 7: REVENUE MODEL ($200K ARR SEGMENT)

### Tier 1: Retail APIs ($20K-50K ARR)
- Offer CCXT wrappers + risk management dashboards for individual traders
- Subscription: $9/mo per user; target 300-500 users

### Tier 2: Managed Strategies ($100K-150K ARR)
- Run grid trading + DCA bots on user capital (2-3% fee on profits)
- Require min. $5K deposit; target 20-50 active accounts

### Tier 3: White-Label Infrastructure ($50K ARR)
- License CEX/DEX arbitrage engine to other platforms
- Revenue-share model: 20-30% of bot fees

### Blended: ~$200K/yr = 2% fee on $100M AUM (1,000 users × $100K avg)

---

## PART 8: REGULATORY & COMPLIANCE

- **US**: Requires MSB license (money transmitter) if accepting customer deposits
- **EU**: MICA (Markets in Crypto Assets) — requires compliance officer + audit trail
- **Reality**: Start with self-serve tools (no deposit custody) to avoid licensing
- **Logging**: Record all orders, PnL, API calls for audit; retention 7 years minimum

---

## SUMMARY TABLE

| Strategy | Capital Min | APY | Risk | Implementation Days |
|----------|-----------|-----|------|-------------------|
| **Grid Trading** | $1K | 40-50% | Medium | 7 |
| **DCA Bot** | $100 | 15-25% | Low | 3 |
| **Funding Rate Arb** | $5K | 12-36% | Medium | 14 |
| **CEX-DEX Arb** | $10K | 50-200% | High | 21 |
| **Cross-CEX Arb** | $50K | 5-15% | Low | 10 |

---

## UNRESOLVED QUESTIONS

1. **Capital Requirements**: Determine platform's initial trading capital allocation
2. **User Custody Model**: Will platform hold user funds or integrate with exchanges directly?
3. **Geographic Restrictions**: Which countries to target (compliance scope)?
4. **Backtest Data**: Source of historical OHLCV data for strategy validation?
5. **MEV Strategy**: Accept sandwich attack revenue or strict ethical stance?
6. **Leverage Policy**: Allow/disallow leverage trading in ToS?
