# Phase 01: NATS Message Bus Integration

## Context Links
- [PDF Architecture Section 3.2](../../Desktop/DeepSeek%20-%20Vào%20Nơi%20Bí%20Ẩn.pdf)
- [Existing Redis PubSub](../../src/redis/pubsub.ts)
- [Existing Wiring](../../src/wiring/)

## Overview
- **Priority**: P0 (Foundation)
- **Status**: completed
- **Parallel Group**: A (must complete before B)

Replace Redis pub/sub with NATS as primary message bus. Keep Redis for cache/state only. NATS provides: decoupling, replay (JetStream), multi-worker scaling.

## Key Insights
- Existing `src/redis/pubsub.ts` handles event streaming — replace with NATS
- NATS v3 uses modular packages: `@nats-io/nats-core`, `@nats-io/jetstream`
- JetStream enables persistent message replay for backtesting
- Keep Redis for cache (prices, state) — only move events to NATS

## Requirements
### Functional
- NATS connection manager with auto-reconnect
- Topic schema: `market.{market_id}.update`, `signal.{strategy}.detected`, `order.{action}`, `risk.alert`
- JetStream streams for trade history replay
- Publish/subscribe adapters compatible with existing event patterns

### Non-functional
- < 1ms publish latency (local NATS)
- Graceful degradation to Redis pub/sub if NATS unavailable
- Docker compose service for NATS server

## Architecture
```
[Market Data Ingestor] --publish--> NATS topic: market.*.update
[Signal Engine] --subscribe--> market.*.update
[Signal Engine] --publish--> signal.*.detected
[Risk Manager] --subscribe--> signal.*.detected
[Order Manager] --subscribe--> (after risk check)
[Dashboard] --subscribe--> SSE bridge from NATS
```

## Related Code Files
### Modify
- `src/redis/pubsub.ts` — extract interface, keep Redis impl as fallback
- `src/wiring/index.ts` — wire NATS into DI container
- `docker-compose.yml` — add NATS service

### Create
- `src/messaging/nats-connection-manager.ts` — connect, reconnect, health
- `src/messaging/nats-publisher.ts` — typed publish helpers
- `src/messaging/nats-subscriber.ts` — typed subscribe helpers
- `src/messaging/message-bus-interface.ts` — abstract interface (NATS or Redis)
- `src/messaging/topic-schema.ts` — topic constants and types
- `src/messaging/jetstream-manager.ts` — JetStream stream/consumer config

## Implementation Steps
1. Install NATS packages: `pnpm add @nats-io/nats-core @nats-io/jetstream`
2. Create `src/messaging/message-bus-interface.ts` — IMessageBus interface
3. Create `src/messaging/topic-schema.ts` — topic enum + message types
4. Create `src/messaging/nats-connection-manager.ts` — connection lifecycle
5. Create `src/messaging/nats-publisher.ts` — typed publish
6. Create `src/messaging/nats-subscriber.ts` — typed subscribe
7. Create `src/messaging/jetstream-manager.ts` — persistent streams
8. Refactor `src/redis/pubsub.ts` to implement IMessageBus
9. Update `src/wiring/index.ts` to inject NATS or Redis based on config
10. Add NATS to `docker-compose.yml`
11. Add NATS config to `.env.example`
12. Write tests for messaging layer

## Todo List
- [x] Install NATS packages
- [x] Create IMessageBus interface
- [x] Create topic schema + types
- [x] Implement NATS connection manager
- [x] Implement NATS publisher
- [x] Implement NATS subscriber
- [x] Implement JetStream manager
- [x] Refactor Redis pubsub as IMessageBus impl
- [x] Wire into DI container (factory pattern)
- [x] Add Docker service
- [x] Write unit tests
- [ ] Integration test with local NATS (deferred — requires running NATS server)

## Success Criteria
- All existing event flows work through NATS
- Redis pub/sub works as fallback when NATS_URL not set
- JetStream replays last 24h of market events
- < 1ms publish latency locally

## Risk Assessment
- **Breaking existing flows**: Mitigated by IMessageBus abstraction + Redis fallback
- **NATS server dependency**: Docker compose handles local, fallback to Redis in prod if needed

## Security Considerations
- NATS auth tokens in env vars, not hardcoded
- TLS for production NATS connections
