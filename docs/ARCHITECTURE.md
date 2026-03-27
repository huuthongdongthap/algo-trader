# Architecture

## Trading Engine Flow

```
Market Data (DataProvider)
        │
        ▼
   TickStore ──► SignalMesh ──► BotEngine.onCandle()
                                      │
                     ┌────────────────┼────────────────┐
                     ▼                ▼                 ▼
              PluginManager     RiskManager      Strategy.onCandle()
              (onCandle hooks)  (SL/TP check)         │
                                                  ISignal (BUY/SELL/NONE)
                                                       │
                                              PluginManager.onSignal()
                                              (can veto/enrich signal)
                                                       │
                                              SignalExplainer (A2UI audit)
                                                       │
                                              AutonomyController.canExecute()
                                                       │
                                              BotTradeExecutor.executeTrade()
                                                       │
                                              OrderManager → IExchange
```

## Component Interactions

| Component | Role |
|-----------|------|
| `BotEngine` | Orchestrates all subsystems; owns lifecycle (start/stop) |
| `StrategyLoader` | Loads `IStrategy` by name from registry |
| `OrderManager` | Manages order state, deduplication |
| `BotTradeExecutor` | Executes buy/sell, syncs position, checks drawdown |
| `RiskManager` | Static SL/TP calculations |
| `PluginManager` | Pre/post trade hooks, signal veto pipeline |
| `IExchange` (CCXT) | Live exchange adapter (binance, okx, bybit, etc.) |

## Strategy Interface

```ts
interface IStrategy {
  name: string;
  init(history: ICandle[], config?: Record<string, unknown>): Promise<void>;
  onCandle(candle: ICandle): Promise<ISignal | null>;
  onStart?(): Promise<void>;
  onTick?(tick: { price: number; timestamp: number }): Promise<ISignal | null>;
  onSignal?(signal: ISignal): Promise<ISignal | null>;
  onFinish?(): Promise<void>;
  updateConfig?(config: Record<string, unknown>): Promise<void>;
}
```

Built-in strategies: `RsiSma`, `RsiCrossover`, `Bollinger`, `MacdCrossover`, `MacdBollingerRsi`

## Backtest vs Live Mode

| | Backtest | Live |
|---|---|---|
| Data source | `MockDataProvider` (generated candles) | `WebSocketDataProvider` / polling |
| Exchange | `BacktestEngine` (simulated fills) | `ExchangeClientBase` (CCXT, real orders) |
| Slippage | `slippageBps` applied | Real market |
| Entry point | `backtest`, `backtest:advanced`, `backtest:walk-forward` | `live` command |

**BacktestEngine** adds over `BacktestRunner`:
- Equity curve (sampled every 100 candles)
- Sortino / Calmar / Expectancy ratios
- Walk-forward analysis (train/test split per window, robustness ratio)
- Monte Carlo simulation (shuffled trade order, ruin probability)

## Plugin System

Plugins implement `BotPlugin` and hook into the engine lifecycle:

```
BotPlugin hooks:
  onStart()       — engine startup
  onCandle()      — every candle (monitoring, indicators)
  onTick()        — every price tick
  onSignal()      — signal enrichment / veto (return null to block)
  onPreTrade()    — trade gate (return { approved: false } to block)
  onPostTrade()   — logging, notifications, PnL tracking
  onStop()        — cleanup
  onFinish()      — final teardown
```

Built-in plugin factories (`bot-engine-builtin-plugin-factories.ts`):
- `DailyLossLimitPlugin` — vetoes trades when daily loss USD exceeded
- `SignalFilterPlugin` — scores signals, vetoes below threshold
- `WebhookPlugin` — posts trade events to HTTP endpoint

## Netdata Subsystem

Inspired by Netdata architecture for real-time metric streaming:

| Component | Role |
|-----------|------|
| `TickStore` | Ring buffer (10k ticks hot storage) |
| `SignalMesh` | In-process pub/sub event bus (topic-based) |
| `HealthManager` | Metric thresholds → ok/warning/critical → publishes `RISK_EVENT` |
| `CollectorRegistry` | Registers metric collectors |

DataProvider ticks flow: `DataProvider → TickStore → SignalMesh('tick') → BotEngine`

## A2UI Subsystem

Autonomy-to-UI layer for agent transparency and human-in-the-loop control:

| Component | Role |
|-----------|------|
| `AgentEventBus` | Internal event bus for audit events |
| `SignalExplainer` | Logs signal rationale with indicator values |
| `TradeAuditLogger` | Immutable audit trail of every trade attempt |
| `AutonomyController` | Configurable autonomy level: `ACT_FREELY` / `ACT_CONFIRM` / `SUGGEST_ONLY` |

## Arbitrage Pipeline

```
arb:scan  → ArbitrageScanner (opportunity detection, no execution)
arb:run   → ArbitrageExecutor (live execution with min threshold)
arb:engine → SpreadDetectorEngine (scoring + orderbook validation + circuit breaker)
arb:orchestrator → ArbitrageOrchestrator (latency optimizer + adaptive threshold)
arb:agi   → AgiArbitrageEngine (regime detection + Kelly sizing + self-tuning)
arb:auto  → SpreadDetectorEngine with full detect→score→validate→execute pipeline
```

## Caching Layer

`src/execution/portkey-inspired-exchange-gateway-middleware-pipeline.ts`

| Layer | TTL | Bypass |
|-------|-----|--------|
| Middleware response cache | 5s | POST/DELETE/mutable ops |
| Exchange connection pool | idle 5min / max age 30min | auto-eviction on expiry |

```
Request → MiddlewarePipeline → cacheKey lookup
               │                    │
               │              hit   └─► return cached response
               │              miss  └─► call ExchangeClient → cache → return
               ▼
    ExchangeConnectionPool (Map<exchangeId, PooledClient>)
    Eviction: setInterval checks idle time + max age per entry
```

## WebSocket Server

`src/core/websocket-server.ts`

Channels broadcast to subscribed clients in real time:

| Channel | Payload |
|---------|---------|
| `tick` | `{ symbol, price, timestamp }` |
| `signal` | `{ strategy, signal, confidence }` |
| `health` | `{ status, drawdown, openPositions }` |

Protocol:
```json
// Subscribe
{ "type": "subscribe", "channel": "tick" }
// Unsubscribe
{ "type": "unsubscribe", "channel": "signal" }
```

Heartbeat runs every 30s; connections with no pong in 60s are terminated and removed from subscriber maps.

## Rate Limiting

| Limiter | Scope | Config |
|---------|-------|--------|
| HTTP endpoint | per IP/key, sliding window | 60 RPM (`src/execution/exchange-router-with-fallback.ts`) |
| Strategy budget | daily notional + fees cap | `maxDailyNotional`, `maxDailyFees` |
| CCXT built-in | per exchange | `enableRateLimit: true` (default) |

```
Incoming order → BudgetGuard.check(notional, fee)
                       │
               under limit → ExchangeRouter → CCXT (rate-limited internally)
               over limit  → reject, emit RISK_EVENT('budget_exceeded')
```

## Deployment

### Docker (multi-stage)

```dockerfile
FROM node:20-alpine AS builder   # compile TS
FROM node:20-alpine AS runtime   # copy dist + node_modules (prod only)
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### PM2

`ecosystem.config.js` — two apps: `algo-trader` (cluster mode) + `health-monitor` (fork).

### Health Endpoints

| Path | Purpose |
|------|---------|
| `GET /health` | liveness — returns `{ status: "ok" }` |
| `GET /ready` | readiness — checks exchange connectivity |

### GitHub Actions CI

```
lint → typecheck → test → build → docker-build
```

Triggered on push to `main`; Docker image pushed to registry on tag.

## Security

| Control | Implementation | Location |
|---------|---------------|----------|
| Config validation | Zod schemas; rejects unknown keys | `src/utils/config-schema.ts` |
| Trading pair validation | allowlist regex + exchange capability check | `src/utils/trading-input-sanitizer-and-validator.ts` |
| Timeframe validation | enum guard (`1m`/`5m`/`1h`/`4h`/`1d`) | same |
| Log sanitization | ANSI escape strip before write | `src/utils/trading-input-sanitizer-and-validator.ts` |
| WebSocket auth | bearer token on upgrade handshake | `src/core/websocket-server.ts` |
