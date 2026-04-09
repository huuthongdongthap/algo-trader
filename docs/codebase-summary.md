# Codebase Summary — Algo Trader v3.0.0

## Overview
Algo Trader is a RaaS (Robot-as-a-Service) multi-tenant automated trading platform. Supports 6+ strategies, real-time WebSocket price feeds, AGI intelligence suite (regime detection, triangular arb, funding-rate arb), paper trading, and Fastify API gateway.

## Project Structure

### src/messaging/ — Event-Driven Message Bus (Phase 19)
| File | Class | Purpose |
|------|-------|---------|
| `nats-message-bus.ts` | `NatsMessageBus` | NATS.io pub/sub with JetStream persistence |
| `redis-message-bus.ts` | `RedisMessageBus` | Redis Pub/Sub fallback layer |
| `jetstream-manager.ts` | `JetStreamManager` | Stream config, consumer mgmt, message replay |
| `nats-connection-manager.ts` | `NatsConnectionManager` | Connection pooling, reconnection logic |
| `message-bus-interface.ts` | `IMessageBus` | Abstract interface for pluggable bus backends |
| `topic-schema.ts` | — | Event type definitions + routing rules |
| `create-message-bus.ts` | — | Factory for bus instantiation |
| `index.ts` | — | Module exports |

### src/intelligence/ — Semantic Dependency Discovery (Phase 20)
| File | Class | Purpose |
|------|-------|---------|
| `semantic-dependency-discovery.ts` | `SemanticDependencyDiscovery` | DeepSeek API analyzes market relationships |
| `relationship-graph-builder.ts` | `RelationshipGraphBuilder` | DAG construction from dependency analysis |
| `alphaear-client.ts` | `AlphaEarClient` | Gamma API integration for live market data |
| `kronos-fair-value.ts` | `KronosFairValue` | Time-series fair value computation |
| `semantic-cache.ts` | `SemanticCache` | Redis caching (24h TTL) for analyses |
| `market-context-builder.ts` | — | Context aggregation from multiple sources |

### src/arbitrage/ — Cross-Market ILP Solver (Phase 21)
| File | Class | Purpose |
|------|-------|---------|
| `integer-programming-solver.ts` | `IntegerProgrammingSolver` | javascript-lp-solver wrapper for optimization |
| `ilp-constraint-builder.ts` | `ILPConstraintBuilder` | Dynamic constraint generation |
| `cross-market-arbitrage-detector.ts` | `CrossMarketArbitrageDetector` | Multi-leg arb identification |
| `multi-leg-basket.ts` | `MultiLegBasket` | Multi-leg position representation |

### src/core/ — Engine & Multi-Tenant
- `BotEngine.ts` — Signal routing, strategy orchestration
- `RiskManager.ts` — Position sizing, risk calculation
- `OrderManager.ts` — Order state tracking
- `TenantArbPositionTracker.ts` — Multi-tenant positions, tier limits
- `TenantStrategyManager.ts` — Tenant CRUD, strategy assignment
- `PaperTradingEngine.ts` — Virtual trading simulation
- `WebSocketServer.ts` — Real-time stream broadcasting
- `StrategyAutoDetector.ts` — Nixpacks-inspired auto-detection, build plan
- `StrategyLoader.ts` — Dynamic strategy loading by name
- `pnl-realtime-snapshot-service.ts` — P&L snapshot (realized + unrealized)
- `signal-market-regime-detector.ts` — Signal-layer regime classification

### src/strategies/ — Trading Strategies
- **Technical**: RSI+SMA, RSI Crossover, Bollinger, MACD, MACD+Bollinger+RSI
- **Arbitrage**: Cross-Exchange, Triangular, Statistical, AGI
- **Polymarket (Phase 22)** (`src/strategies/polymarket/`):
  - Delta-Neutral: DeltaNeutralVolatilityArbitrage, DeltaNeutralPortfolioMonitor, DeltaCalculator
  - Event-Driven: EventDeadlineScaler, CrossEventDrift, EventHedgingSynthetic
  - Momentum: BollingerSqueeze, DecayRateMomentum, SentimentMomentumDivergence
  - Correlation: CrossCorrelationLag, CorrelationPairTrade
  - Microstructure: ClusterBreakout, GapFillReversion, VolatilitySurfaceSmile
  - **15+ Polymarket-optimized strategies** for implied probability arbitrage

### src/execution/ — Order Execution Pipeline
| File | Class | Purpose |
|------|-------|---------|
| `websocket-multi-exchange-price-feed-manager.ts` | `WebSocketMultiExchangePriceFeedManager` | Binance/OKX/Bybit streams, auto-reconnect |
| `fee-aware-cross-exchange-spread-calculator.ts` | `FeeAwareCrossExchangeSpreadCalculator` | Net spread = gross - fees - slippage, 5min TTL |
| `atomic-cross-exchange-order-executor.ts` | `AtomicCrossExchangeOrderExecutor` | Promise.allSettled buy/sell, rollback |
| `paper-trading-arbitrage-bridge.ts` | `PaperTradingArbitrageBridge` | Paper trading multi-exchange simulator |
| `realtime-arbitrage-scanner.ts` | `RealtimeArbitrageScanner` | EventEmitter; emits `opportunity` on profitable spreads |
| `arbitrage-execution-engine.ts` | `ArbitrageExecutionEngine` | Scanner → CircuitBreaker → Executor → Telegram |
| `order-book-depth-analyzer.ts` | `OrderBookDepthAnalyzer` | Real L2 order book slippage + liquidity check |
| `market-regime-detector.ts` | `MarketRegimeDetector` | Regime classification, adaptive param suggestions |
| `triangular-arbitrage-live-scanner.ts` | `TriangularArbitrageLiveScanner` | 3-leg intra-exchange cycle detection |
| `funding-rate-arbitrage-scanner.ts` | `FundingRateArbitrageScanner` | Cross-exchange funding rate spread detection |
| `adaptive-circuit-breaker-per-exchange.ts` | `AdaptiveCircuitBreaker` | Per-exchange trip/reset, health gating |
| `exchange-connection-pool.ts` | `ExchangeConnectionPool` | CCXT connection pooling |
| `exchange-health-monitor.ts` | `ExchangeHealthMonitor` | Latency + error rate monitoring |
| `exchange-registry.ts` | `ExchangeRegistry` | Named exchange instance registry |
| `exchange-router-with-fallback.ts` | `ExchangeRouterWithFallback` | Route with automatic fallback |
| `live-exchange-manager.ts` | `LiveExchangeManager` | Live session lifecycle management |
| `portkey-inspired-exchange-gateway-middleware-pipeline.ts` | `ExchangeGatewayMiddlewarePipeline` | Middleware chain for exchange calls |
| `signal-order-pipeline-live-trading.ts` | — | Signal → order pipeline for live trading |
| `strategy-position-manager.ts` | `StrategyPositionManager` | Per-strategy position tracking |
| `telegram-trade-alert-bot.ts` | `TelegramTradeAlertBot` | Trade execution notifications |
| `tick-to-candle-aggregator.ts` | `TickToCandleAggregator` | Real-time OHLCV candle aggregation |
| `distributed-nonce-manager.ts` | `DistributedNonceManager` | Redis atomic nonce counter for replay protection |
| `gas-batch-optimizer.ts` | `GasBatchOptimizer` | Multi-leg order gas cost minimization |
| `multi-leg-frank-wolfe-optimizer.ts` | `MultiLegFrankWolfeOptimizer` | Slippage minimization for multi-leg execution |

### Key Interfaces (Phase 9-11)
| Interface | File | Description |
|-----------|------|-------------|
| `ArbitrageOpportunity` | `realtime-arbitrage-scanner.ts` | Cross-exchange opportunity with tick age |
| `ArbEngineMetrics` | `arbitrage-execution-engine.ts` | Cumulative execution stats |
| `ArbTradeRecord` | `arbitrage-execution-engine.ts` | Individual trade record |
| `DepthAnalysis` | `order-book-depth-analyzer.ts` | Single-side L2 depth result |
| `SpreadDepthAnalysis` | `order-book-depth-analyzer.ts` | Combined buy+sell depth viability |
| `RegimeStats` | `market-regime-detector.ts` | Rolling volatility/trend stats |
| `ArbParamSuggestion` | `market-regime-detector.ts` | Adaptive scanner param overrides |
| `TriArbCycle` | `triangular-arbitrage-live-scanner.ts` | 3-leg path definition |
| `TriArbOpportunity` | `triangular-arbitrage-live-scanner.ts` | Profitable triangle with net profit |
| `FundingRateEntry` | `funding-rate-arbitrage-scanner.ts` | Per-exchange funding rate snapshot |
| `FundingRateOpportunity` | `funding-rate-arbitrage-scanner.ts` | Cross-exchange funding spread |

### src/api/ — RaaS API Layer (Fastify 5)
- `fastify-raas-server.ts` — Server bootstrap, plugin registration
- `routes/arbitrage-scan-execute-routes.ts` — POST /arb/scan, /arb/execute
- `routes/arbitrage-positions-history-routes.ts` — GET /positions, /history, /stats
- `routes/tenant-crud-routes.ts` — Tenant CRUD
- `routes/backtest-job-submission-routes.ts` — Backtest job submission
- `routes/pnl-realtime-snapshot-history-routes.ts` — P&L current + history
- `schemas/` — Zod validation schemas

### src/auth/ — Authentication & Security
- `tenant-auth-middleware.ts` — JWT + API Key auth, tenant isolation
- `jwt-token-service.ts` — JWT sign/verify
- `api-key-manager.ts` — API key validation
- `sliding-window-rate-limiter.ts` — In-memory + Redis rate limiting
- `scopes.ts` — Permission scopes (ADMIN, BACKTEST, TRADE, READ)

### src/cli/ — CLI Commands
| File | Commands |
|------|----------|
| `arb-scan-run-commands.ts` | `arb:scan`, `arb:run` |
| `arb-cli-commands.ts` | `arb:engine`, `arb:orchestrator` |
| `arb-engine-orchestrator-commands.ts` | Engine/orchestrator wiring |
| `arb-live-cross-exchange-command.ts` | `arb:live` + `ArbLiveOrchestrator` |
| `arb-agi-auto-execution-commands.ts` | `arb:agi`, `arb:auto` (unified all strategies) |
| `spread-detector-command.ts` | `arb:spread` |
| `live-dry-run-simulation-command.ts` | Dry-run with live data |
| `agi-trade-multi-exchange-golive-command.ts` | Multi-exchange go-live |
| `ml-train-and-backtest-commands.ts` | ML train + backtest |
| `strategy-marketplace-tenant-cli-commands.ts` | Marketplace CLI |
| `exchange-factory.ts` | Exchange instantiation helper |

### src/jobs/ — BullMQ Background Processing
- `bullmq-named-queue-registry-backtest-scan-webhook.ts` — Queue factory
- `workers/bullmq-backtest-worker-*.ts` — Backtest job processor
- `workers/bullmq-scan-worker-*.ts` — Scheduled strategy scan
- `ioredis-connection-factory-and-singleton-pool.ts` — Redis connection pool

### src/backtest/ — Backtesting Framework
- `BacktestRunner.ts` — Standard backtest execution
- `BacktestEngine.ts` — Equity curve, Sortino, Calmar, Monte Carlo, walk-forward
- `BacktestOptimizer.ts` — Grid/random search optimizer
- `walk-forward-optimizer-pipeline.ts` — Optimize-then-validate, overfitting detection

### src/reporting/ — Export & Analytics
- `ArbitrageTradeHistoryExporter.ts` — CSV/JSON export

### src/ui/ — Dashboard
- `ArbitrageCLIRealtimeDashboard.ts` — Real-time terminal metrics (chalk)

### prisma/ — Database Schema
- `schema.prisma` — Tenant, Strategy, Order, Trade, ApiKey, BacktestResult, Candle, PnlSnapshot, AlertRule (PostgreSQL)

### tests/ — Test Suite (97 suites)
- `tests/execution/` — All Phase 9-11 modules: realtime-arbitrage-scanner, arbitrage-execution-engine, order-book-depth-analyzer, market-regime-detector, triangular-arbitrage-live-scanner, funding-rate-arbitrage-scanner, atomic executor, fee-aware spread calc, paper trading bridge, exchange health/registry/pool, telegram alert bot, tick-to-candle, signal-order pipeline, strategy position manager
- `tests/cli/` — arb-live, agi-trade-golive, live-dry-run-simulation
- `tests/jobs/` — BullMQ workers, Redis pub/sub, rate limiter
- `tests/backtest/` — Walk-forward, random search, performance ranker
- `tests/ml/` — Feature engineering, GRU model, Q-learning, ML strategy loader
- `tests/core/` — Historical VaR, portfolio correlation, trailing stop
- `tests/e2e/` — Full RaaS API server integration
- `tests/load/` — API stress benchmark
- `src/*/` — Co-located unit tests (arbitrage engine, execution pipeline, API routes, auth, strategies)

### src/execution/ — Stealth Modules (Phase 15-17)
| File | Class | Purpose |
|------|-------|---------|
| `anti-detection-order-randomizer-safety-layer.ts` | `AntiDetectionSafetyLayer` | Order timing/size jitter, rate governor, kill switch |
| `binh-phap-stealth-trading-strategy.ts` | `BinhPhapStealthStrategy` | 孫子兵法 13-chapter anti-detection algorithm |
| `phantom-order-cloaking-engine.ts` | `PhantomOrderCloakingEngine` | 3-layer order cloaking: split, timing, size camouflage |
| `phantom-stealth-math.ts` | — | Stealth math helpers (jitter, normalization) |
| `stealth-cli-fingerprint-masking-middleware.ts` | — | Browser-like HTTP headers to mask bot fingerprint |
| `stealth-execution-algorithms.ts` | — | Shared stealth execution algorithms |

### src/a2ui/ — Agent-to-UI Bridge
- `agent-event-bus.ts` — Event bus between trading agents and UI layer
- `signal-explainer.ts` — Human-readable signal explanation
- `surface-manager.ts` — UI surface state management
- `trade-audit-logger.ts` — Audit trail for all trade events

### src/netdata/ — Collector & Metrics
- `AgiDbEngine.ts` — AGI state persistence engine
- `CollectorRegistry.ts` — Metrics collector registry
- `HealthManager.ts` — System health state management
- `SignalMesh.ts` — Cross-component signal routing mesh
- `TickStore.ts` — In-memory tick data store

### src/pipeline/ — Workflow Pipeline
- `workflow-pipeline-engine.ts` — Generic workflow pipeline with step sequencing

## Key Metrics
- **280+ source files** (TypeScript 5.9, strict mode)
- **1400+ tests** (Jest 29, 115+ suites, 100% pass rate)
- **20+ CLI commands** (Commander)
- **25+ trading strategies** (RSI, SMA, MACD, Cross-Exchange, Triangular, Funding-Rate, AGI, Delta-Neutral, Event-Driven, Momentum, GRU, Q-Learning, + 15 Polymarket)
- **28+ API endpoints** + 5 WebSocket channels (Fastify 5)
- **3 exchange integrations** (Binance, OKX, Bybit via CCXT 4.5)
- **9 database models** (Tenant, Strategy, Order, Trade, ApiKey, BacktestResult, Candle, PnlSnapshot, AlertRule via Prisma)
- **5 dashboard pages** + 10 components (React 19, Vite 6, Tailwind, TradingView Charts)
- **Event-driven messaging**: NATS primary + JetStream (persistent) + Redis fallback (8 modules)
- **Semantic intelligence**: DeepSeek API + relationship graph + semantic cache (6 modules)
- **Cross-market optimization**: ILP solver + Frank-Wolfe (4 modules)
- **Infrastructure hardening**: Distributed nonce, gas optimizer, TimescaleDB hypertables, Grafana/Prometheus

## Quality Metrics
- **0 TypeScript errors** (strict mode enforced)
- **0 `any` types** in production (test mocks only — acceptable)
- **0 console.log** (production clean)
- **0 TODO/FIXME** (zero tech debt)
- **0 secrets in code** (.env gitignored)
- **Binh Phap 6/6 fronts passing**

## Tech Stack
**Core**: TypeScript 5.9 | Node.js 20 | Fastify 5 | CCXT 4.5

**Messaging**: NATS.io (primary) | JetStream (persistence) | Redis (fallback)

**Optimization**: javascript-lp-solver (ILP) | Frank-Wolfe algorithm

**Data & Analytics**: BullMQ 5 | Redis (IoRedis) | PostgreSQL 16 (Prisma) | TimescaleDB (hypertables)

**Intelligence**: DeepSeek API (semantic analysis) | Gamma API (market data)

**Validation & Logging**: Zod 4.3 | Winston | Prometheus | Grafana

**ML & Testing**: TensorFlow.js | Jest 29 | Playwright

**CLI & UI**: Commander CLI | React 19 | Vite 6 | Tailwind CSS | Zustand 5

Updated: 2026-04-09
