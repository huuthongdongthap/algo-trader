# Polymarket API Advanced Research Report
**Date:** 2026-03-24 | **Duration:** 1 research cycle | **Model:** Haiku 4.5

---

## Executive Summary

Polymarket exposes **3 API layers**: Gamma (market metadata), CLOB (trading), Data (user state). Node.js bots can scan 100+ markets per cycle within rate limits via cacheable Gamma queries + monitored CLOB throughput. Resolution prediction is feasible via UMA 2-hour challenge mechanics.

---

## 1. Gamma API — Market Discovery & Metadata

### Public Endpoints (No Auth)
- `GET /events` — list events w/ filters, pagination
- `GET /events/{id}` — event details
- `GET /markets` — list all tradable markets
- `GET /markets/{id}` — market by ID
- `GET /markets` query params: `status`, `eventId`, `liquidity` (sortable)
- `GET /tags` — ranked categories
- `GET /series` — grouped event collections (sports leagues)
- `GET /sports` — sports leagues + series_id filter

### Response Data Fields per Market
```
{
  id: string,
  question: string,
  outcomes: ["Yes", "No"],
  outcomePrices: [0.65, 0.35],  // implied probabilities
  volume24h: number,
  bestBid: number,
  bestAsk: number,
  spread: (ask - bid),
  enableOrderBook: boolean,
  conditionId: string,
  tokens: [clob_id_yes, clob_id_no],
  liquidity: number,
  closed: boolean
}
```

### Key Insights
- **Cacheable**: Gamma data changes slowly. Cache 5-10min between cycles.
- **Participant Count**: NOT directly in API. Infer from trade volume/time.
- **Liquidity Depth**: `outcomePrices` show spread. Full depth requires CLOB `/books`.

---

## 2. CLOB API — Order Book & Trading

### Rate Limits (Cloudflare Throttled, Not Rejected)
| Endpoint | Limit | Notes |
|----------|-------|-------|
| `/books` (bulk) | 300 req/10s | ~30 markets/cycle |
| `/price` | 100 req/10s | Fast midpoint checks |
| `POST /order` | 500 burst/10s, 3000/10min | 50/s burst, 5/s sustained |
| `DELETE /order` | 500 burst/10s, 3000/10min | Cancel rate |

### For Scanning 100+ Markets
**Strategy:** Cache Gamma, sample via `/price` (fast), only call `/books` on high-volume markets.
- Cycle time: ~2-3sec for 100 markets via `/price` + 10 `/books` calls
- Burst to 500/10s, then throttle gracefully

### Order Book Response (`/books`)
```
{
  bids: [{price: 0.68, size: 1000}, ...],
  asks: [{price: 0.72, size: 500}, ...],
  midpoint: 0.70,
  market: {
    tokenId: "0x...",
    minOrderSize: 1,
    tickSize: 0.01
  }
}
```

### Known Issues
- `/book` endpoint serves **stale snapshots**; `/price` is live ⚠️
- Recommend: Poll `/price` + confirm with `/books` before large orders

---

## 3. Market Resolution Mechanics — UMA Oracle

### Timeline
1. **Event Ends** → User proposes outcome + bond
2. **Challenge Period**: 2 hours (CRITICAL WINDOW)
3. **If Undisputed** → Auto-settle, payouts execute
4. **If Disputed** → UMA Data Verification Mechanism (DVM) vote

### Trading Bot Implications
- **Settlement Arb Timing**: Profits in 2h-4h window (proposal + DVM if needed)
- **Prediction Window**: Markets close when event concludes; trading ends ~1-2h before resolution
- **No Fast Resolution**: UMA DVM decisions take hours/days for disputed markets
- **Bankless Coverage**: Some markets have external fact sources (news APIs, sports APIs) for faster assertion

### Opportunity
Monitor UMA proposal stage → estimate resolution time → price in time-value decay.

---

## 4. Order Book Depth & Market Efficiency

### Spread Analysis
- Gamma API: `outcomePrices[0] - outcomePrices[1]` = crude spread
- CLOB API `/books`: `asks[0].price - bids[0].price` = true spread
- **High Liquidity** = tight spread (< 0.02 = efficient market)
- **Low Liquidity** = wide spread (> 0.10 = arb-friendly)

### Liquidity Depth Signals
```
if (bestAsk - bestBid) > 0.05:
  → Thin market, prediction less efficient
  → Possible arb opportunity vs aggregate pricing
if (bids[0].size + asks[0].size) < 500 USDC:
  → Can move market with 200-500 order → momentum play
```

### Integration Point
For **market-making bot**: Monitor `/books` on 10-20 liquid markets, track spread widening → reactive liquidity provision.

---

## 5. Analytics & Bot Activity Tracking

### Public Dashboards (READ-ONLY)
- **Dune Analytics**: `dune.com/filarm/polymarket-activity` — volume, open interest, users
- **Polymarket Analytics**: `polymarketanalytics.com` — real-time trading, top traders, positions
- **Trade Activity Tracker**: Dune dashboard by @0xclark_kent for bot spotting

### Data Available
- Aggregate volume (NOT trader count)
- Open interest per market
- Top trader addresses (wallet-level, not bot identity)
- Resolution predictions (community tracked)

### Limitation
No API endpoint for "bot activity"; infer via:
1. Address clustering (repeated small trades)
2. Order timing patterns (sub-second execution)
3. Volume concentration vs dispersed retail

---

## 6. Actionable Technical Parameters

### For Node.js TypeScript Bot

**Config Variables:**
```typescript
// Gamma (read-heavy, cacheable)
GAMMA_ENDPOINT = "https://gamma-api.polymarket.com"
GAMMA_CACHE_TTL = 300_000  // 5min
GAMMA_MARKET_LIMIT = 100   // per page

// CLOB (rate-limited, monitored)
CLOB_ENDPOINT = "https://clob.polymarket.com"
CLOB_PRICE_QPS = 10   // 100 req/10s
CLOB_BOOKS_QPS = 30   // 300 req/10s

// Scan strategy for 100+ markets
SCAN_CYCLE_SEC = 3.0
PRICE_SAMPLES = 100      // Gamma + /price
DEPTH_SAMPLES = 10       // /books only on hottest
```

**Scanning Algorithm:**
1. Fetch Gamma (cached) → 100 markets metadata
2. Batch `/price` calls (throttled) → current midpoints
3. Identify top 10 by liquidity + spread
4. Call `/books` only on these 10 → full depth
5. Cycle: repeat every 3sec

**Rate Limit Safety:**
- Monitor response headers: `X-Ratelimit-Remaining`, `X-Ratelimit-Reset`
- Implement exponential backoff on throttle (Cloudflare stalls, not rejects)
- Avoid concentrated bursts; spread across 10sec window

---

## Unresolved Questions

1. **Participant Count**: No API field. Possible via indexing trades + deduplicating addresses, but expensive.
2. **Bot Identity**: Dune has heuristics; no official Polymarket bot-flagging API.
3. **Spread Prediction**: Can we predict pre-resolution spread widening using UMA timing signals? (Untested)
4. **Emergency Resolution**: Do any markets skip 2h challenge for major events (e.g., election night)? (Policy question)

---

## Sources

- [Polymarket Gamma API Documentation](https://docs.polymarket.com/developers/gamma-markets-api/overview)
- [Polymarket API Rate Limits](https://docs.polymarket.com/quickstart/introduction/rate-limits)
- [How Markets Are Resolved - UMA Oracle](https://docs.polymarket.com/polymarket-learn/markets/how-are-markets-resolved)
- [Order Book API Reference](https://docs.polymarket.com/api-reference/orderbook/get-order-book-summary)
- [Polymarket Activity Dashboard - Dune](https://dune.com/filarm/polymarket-activity)
- [TheGraph/Dune Bot Activity Tracking](https://github.com/aarora4/Awesome-Prediction-Market-Tools)
- [Medium: Polymarket API Architecture (Jan 2026)](https://medium.com/@gwrx2005/the-polymarket-api-architecture-endpoints-and-use-cases-f1d88fa6c1bf)
