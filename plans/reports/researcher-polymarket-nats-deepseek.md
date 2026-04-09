# Polymarket AI Arbitrage Bot: Tech Stack Research
**Date:** 2026-04-09 | **Scope:** 3 core technologies for TypeScript/Node.js trading system

---

## 1. Polymarket CLOB Client (TypeScript)

### Current SDK Options
- **Primary:** `@polymarket/clob-client` v5.8.1 (ethers v5)
- **Modern:** `@polymarket/clob-client-v2` (viem, better for chains + typed APIs)
- **Builder Program:** `@polymarket/builder-signing-sdk` (order attribution)
- **Gasless:** `@polymarket/builder-relayer-client` (proxy wallet relaying)

### API Patterns & Architecture
```typescript
// Initialization
const client = new ClobClient(
  "https://clob.polymarket.com",
  137, // Polygon chain
  signer, // ethers.Signer or viem Wallet
  apiCreds // { longFormAuth: string } or builder key
);

// Market queries + order creation
const markets = await client.getMarkets();
const order = await client.createAndPostOrder({
  tokenID: string,
  price: number,
  side: "BUY" | "SELL",
  size: number,
  negRisk: boolean // Polygon-specific
});
```

### WebSocket Streams
- **Official:** `@polymarket/real-time-data-client` for real-time orderbook
- **Pattern:** Event-driven CLOB with streaming price updates
- **Rate Limits:** Dual-tier (burst 3,500/10s, sustained 36,000/10min on Cloudflare)

### EIP-712 Signing (Key Discovery)
- Used for off-chain order authorization
- Client handles typed-data signing internally
- `signer` (ethers.Signer) abstracts EIP-712 via `signTypedData()`
- No direct exposure needed; client wraps it

### Verdict
Use **`@polymarket/clob-client-v2`** (viem-based) for new projects. Simpler typed APIs, better error handling, active maintenance. Python `py-clob-client` v0.34.6+ also robust if falling back.

---

## 2. NATS.io for Node.js Trading System

### Architecture
- **NATS Core:** Pub/Sub + Request/Reply (in-memory, sub-100µs latency)
- **JetStream:** Persistence layer (RAFT-based quorum, R=3 ideal for HA)
- **Modules:** Core, JetStream, KV (key-value), Services (orchestration)

### TypeScript Setup
```bash
npm install nats
```

### Pub/Sub Pattern (Market Data Pipeline)
```typescript
import { connect } from "nats";

const nc = await connect({ servers: ["nats://localhost:4222"] });
const { subscribe } = nc;

// Publisher: streaming price updates
const subj_prices = "market.prices";
nc.publish(subj_prices, JSON.stringify({ market: "ID", bid: 0.45, ask: 0.48 }));

// Subscriber: listen to prices
const sub = subscribe(subj_prices);
for await (const msg of sub) {
  const data = JSON.parse(msg.data); // { market, bid, ask }
  // Feed to LLM sentiment engine
}
```

### Request/Reply (Order Execution Service)
```typescript
// Server: order execution service
const svc = await nc.subscribe("order.place");
for await (const msg of svc) {
  const req = JSON.parse(msg.data);
  const result = await executeOrder(req); // Polymarket clob-client
  msg.respond(JSON.stringify(result));
}

// Client: request order
const reply = await nc.request("order.place", JSON.stringify({ 
  tokenID, price, side, size 
}), { timeout: 5000 });
```

### JetStream (Persistent Trade Log)
```typescript
import { jetstream } from "nats";

const js = jetstream(nc);

// Stream: store all trades for replay/audit
await js.streams.add({
  name: "trades",
  subjects: ["trade.>"],
  storage: "file", // or "memory"
  retention: "limits",
  max_age: 30 * 24 * 3600 * 1e9, // 30 days
});

// Publish to stream
js.publish("trade.executed", JSON.stringify({ id, pnl, edge }));

// Consumer: replay for analysis
const consumer = await js.consumers.add("trades", {
  durable_name: "analysis",
  flow_control: { idle_heartbeat: 5000 },
  ack_policy: "explicit",
});

const messages = await consumer.fetch({ batch: 100 });
for await (const msg of messages) {
  const trade = JSON.parse(msg.data);
  msg.ack();
}
```

### Deployment Pattern
- Single NATS server (localhost:4222) for MVP
- Multi-region clustering (3-node RAFT quorum) for production
- JetStream persistence to local disk or cloud storage

### Verdict
**Excellent choice** for trading system: low latency (sub-100µs), persistent message queues, built-in request/reply solves order execution RPC elegantly. npm package `nats` v2.28+ mature & well-maintained.

---

## 3. DeepSeek API for Semantic Market Analysis

### Setup & Authentication
```typescript
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: "https://api.deepseek.com",
});
```

### Market Relationship Discovery
**Use Case:** Analyze market descriptions to find logical dependencies (e.g., "Will BTC > $100K?" depends on "Will US stock market rise?")

```typescript
const response = await client.chat.completions.create({
  model: "deepseek-chat", // or deepseek-reasoner for slow thinking
  messages: [
    {
      role: "system",
      content: "You are a prediction market analyst. Find logical market dependencies."
    },
    {
      role: "user",
      content: `Analyze these markets for semantic correlations:\n${marketDescriptions}`
    }
  ],
  temperature: 0.3, // Lower = more factual relationships
  max_tokens: 1000,
});

// Extract dependency graph from response
const dependencies = parseMarketRelationships(response.choices[0].message.content);
```

### Available Models
- **deepseek-chat:** 128K context, fastest, suitable for real-time analysis
- **deepseek-reasoner:** Extended thinking mode, 15-30s per response, better for novel market relationships

### Cost Advantage
- **vs OpenAI GPT-4o:** ~10-30x cheaper
- **Strategy:** Use DeepSeek for high-volume sentiment scoring; reserve GPT-4o for calibration checks
- **Caching:** Semantic caching stores similar queries (useful for recurring market pairs)

### Integration with Trading Loop
```typescript
async function detectMarketArbitrage(markets: Market[]): Promise<Arbitrage[]> {
  // 1. Fetch all market descriptions
  const descriptions = markets.map(m => `${m.id}: ${m.description}`).join("\n");
  
  // 2. DeepSeek semantic analysis (find relationships)
  const relationships = await analyzeWithDeepSeek(descriptions);
  
  // 3. Cross-reference with orderbook (price inconsistencies)
  const arbitrages = findArbitrageOpportunities(relationships, markets);
  
  // 4. Risk filter: Qwen 32B local validates (sub-300ms)
  const filtered = await localRiskFilter(arbitrages);
  
  return filtered; // Feed to NATS order.place queue
}
```

### Verdict
**Ideal for discovery phase:** Semantic analysis finds which markets SHOULD be correlated. Costs pennies vs dollars. Pair with local Qwen 32B for risk filtering. DeepSeek-reasoner overkill for real-time; use chat model.

---

## System Architecture (Integrated)

```
┌─────────────────┐
│ Polymarket CLOB │  (WebSocket: orderbook, trades)
└────────┬────────┘
         │
    ┌────▼───────┐         ┌─────────────┐
    │ NATS Core  │◄────────┤ DeepSeek    │ (semantic analysis)
    │ (pub/sub)  │         │ + Qwen 32B  │ (risk filtering)
    └────┬───────┘         └─────────────┘
         │
    ┌────▼───────────┐
    │  JetStream     │  (trade log, audit, replay)
    │  (persistence) │
    └────────────────┘
```

**Message Flow:**
1. CLOB WebSocket → NATS `market.prices` topic
2. DeepSeek analyzes market descriptions → NATS `market.relationships` queue
3. Risk filter (Qwen) → NATS `trade.signal` topic
4. Order service subscribes, executes via CLOB client
5. Execution logged to JetStream `trades` stream

---

## Unresolved Questions

1. **Polymarket v2 SDK stability:** Is `@polymarket/clob-client-v2` (viem) production-ready vs v1 (ethers)? Latest version adoption?
2. **DeepSeek rate limits:** What's the actual throughput cap for real-time sentiment analysis at high-frequency trading scale?
3. **NATS clustering on edge:** How to replicate NATS state across AWS+M1 Max for low-latency local execution?

---

## Sources

- [Polymarket Documentation - Clients & SDKs](https://docs.polymarket.com/api-reference/clients-sdks)
- [GitHub - Polymarket/clob-client](https://github.com/Polymarket/clob-client)
- [npm - @polymarket/clob-client](https://www.npmjs.com/package/@polymarket/clob-client)
- [NATS Docs - JetStream](https://docs.nats.io/nats-concepts/jetstream)
- [GitHub - nats-io/nats.js](https://github.com/nats-io/nats.js)
- [DeepSeek API Documentation](https://api-docs.deepseek.com/)
- [DeepSeek vs. OpenAI Jan 2026](https://dev.to/nima_moosarezaie/deepseek-vs-openai-jan-2026-how-the-free-model-war-is-changing-4095)
