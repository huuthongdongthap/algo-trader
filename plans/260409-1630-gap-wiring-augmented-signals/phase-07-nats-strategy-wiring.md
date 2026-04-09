# Phase 07: NATS → Strategy Event Wiring

## Overview
- **Priority**: P0 (CRITICAL — bridges the entire architecture gap)
- **Status**: completed

Wire NATS messaging into the strategy engine event loop. Strategies should SUBSCRIBE to market data and signal topics, and PUBLISH trade decisions.

## Key Insight
- `src/wiring/strategy-wiring.ts` registers strategies but has NO messaging integration
- `src/messaging/topic-schema.ts` defines 13 topics but only `semantic-dependency-discovery.ts` publishes
- Need: bridge module that subscribes to NATS topics → feeds data to strategies → publishes signals

## Related Code Files
### Modify
- `src/wiring/strategy-wiring.ts` — import and init NATS bridge

### Create
- `src/wiring/nats-strategy-bridge.ts` — subscribe to market/signal NATS topics, dispatch to strategies
- `src/wiring/nats-event-loop.ts` — event loop that processes NATS messages and triggers strategy tick

## Implementation Steps
1. Read existing `src/wiring/strategy-wiring.ts` to understand strategy registration
2. Read existing `src/polymarket/trading-pipeline.ts` for current tick flow
3. Create `nats-strategy-bridge.ts`: subscribe `market.*.update` → parse → feed to registered strategies
4. Create `nats-event-loop.ts`: startup init that connects NATS, subscribes all topics, routes messages
5. Strategies publish signals back to NATS: `signal.*.detected`
6. Update `strategy-wiring.ts` to optionally init NATS bridge if NATS_URL is set

## Todo List
- [x] Read existing wiring and pipeline code
- [x] Create NATS strategy bridge
- [x] Create NATS event loop
- [x] Wire into strategy registration
- [ ] Test with mock market data (deferred — no test files per task constraints)

## Success Criteria
- At least 1 strategy receives data via NATS subscription
- Signal output published to NATS topic
- Falls back to existing tick-based flow when NATS_URL not set
