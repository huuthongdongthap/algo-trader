# API Reference

> **ROIaaS Phase 8** — Comprehensive API documentation for algorithmic trading platform.
>
> **Base URL:** `https://algo-trader.api.com/api/v1` | **Dev:** `http://localhost:3000/api/v1`

## CLI Commands

All commands run via: `node dist/index.js <command> [options]` or `npm run dev -- <command>`

### Trading Commands

| Command | Description |
|---------|-------------|
| `live` | Run live trading bot |
| `backtest` | Backtest a strategy on mock data |
| `backtest:advanced` | Backtest with equity curve, Sortino, Calmar, MAE/MFE |
| `backtest:walk-forward` | Walk-forward analysis to detect overfitting |
| `compare` | Compare all non-arb strategies by Sharpe ratio |

```sh
# Live trading
node dist/index.js live -s BTC/USDT -e binance

# Backtest
node dist/index.js backtest -s RsiSma -d 30 -b 10000

# Advanced backtest (includes Monte Carlo)
node dist/index.js backtest:advanced -s MacdCrossover -d 90 -b 10000

# Walk-forward (5 windows, 90 days)
node dist/index.js backtest:walk-forward -s RsiSma -d 90 -w 5 -b 10000

# Compare all strategies
node dist/index.js compare -d 30 -b 10000
```

### Arbitrage Commands

| Command | Description |
|---------|-------------|
| `arb:scan` | Scan cross-exchange spreads (dry-run, no execution) |
| `arb:run` | Execute arbitrage trades when spread > threshold |
| `arb:engine` | SpreadDetectorEngine: scoring + orderbook validation + circuit breaker |
| `arb:orchestrator` | ArbitrageOrchestrator: latency optimizer + adaptive threshold |
| `arb:agi` | AGI engine: regime detection + Kelly sizing + self-tuning |
| `arb:auto` | Unified auto-execution: full detect→score→validate→execute pipeline |
| `spread:detect` | Spread detector with configurable alerting |

```sh
# Scan only (no trades)
node dist/index.js arb:scan -p BTC/USDT,ETH/USDT -e binance,okx,bybit -t 0.1 -n 10

# Live arb execution (requires API keys)
node dist/index.js arb:run -p BTC/USDT -e binance,okx -s 500 -t 0.15

# Full engine with circuit breaker
node dist/index.js arb:engine -p BTC/USDT,ETH/USDT -e binance,okx,bybit -s 1000 --max-loss 100

# AGI engine with Kelly sizing
node dist/index.js arb:agi -p BTC/USDT -e binance,okx,bybit --score-threshold 70

# Auto pipeline
node dist/index.js arb:auto -p BTC/USDT,ETH/USDT -e binance,okx,bybit -s 1000
```

### Marketplace / Tenant Commands

| Command | Description |
|---------|-------------|
| `marketplace:list` | List strategies with optional filters |
| `marketplace:detail <id>` | Show strategy details |
| `tenant:create` | Create new tenant |
| `tenant:assign` | Assign strategy to tenant |
| `tenant:status` | Show tenant status |

---

## Configuration Reference

### Environment Variables (`.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EXCHANGE_API_KEY` | live only | — | Exchange API key |
| `EXCHANGE_SECRET` | live only | — | Exchange API secret |
| `EXCHANGE_ID` | no | `binance` | CCXT exchange ID |
| `TRADING_PAIR` | no | `BTC/USDT` | Default trading symbol |
| `TIMEFRAME` | no | `1h` | Candle timeframe |
| `RSI_PERIOD` | no | `14` | RSI indicator period |
| `SMA_SHORT` | no | `20` | Short SMA period |
| `SMA_LONG` | no | `50` | Long SMA period |
| `MAX_POSITION_SIZE` | no | `0.01` | Position size (fraction) |
| `STOP_LOSS_PCT` | no | `2.0` | Stop-loss % |
| `TAKE_PROFIT_PCT` | no | `5.0` | Take-profit % |
| `MAX_DAILY_LOSS` | no | `100` | Max daily loss USD |
| `LOG_LEVEL` | no | `info` | Winston log level |
| `LOG_FILE` | no | `algo-trader.log` | Log file name |
| `BINANCE_API_KEY` | arb only | — | Binance key for arb commands |
| `BINANCE_SECRET` | arb only | — | Binance secret |
| `OKX_API_KEY` | arb only | — | OKX key |
| `OKX_SECRET` | arb only | — | OKX secret |
| `BYBIT_API_KEY` | arb only | — | Bybit key |
| `BYBIT_SECRET` | arb only | — | Bybit secret |

### YAML Config (`config/default.yaml`)

```yaml
exchange:
  id: "binance"
  testMode: true          # Set false for live trading

bot:
  symbol: "BTC/USDT"
  riskPercentage: 1.0     # % of balance risked per trade
  pollInterval: 1000      # ms between candle polls
  strategy: "RsiSma"

backtest:
  days: 30
  initialBalance: 10000

logging:
  level: "info"
  directory: "./logs"
```

Env vars `EXCHANGE_API_KEY` / `EXCHANGE_SECRET` override YAML values at runtime.

---

## Key TypeScript Interfaces

### IStrategy
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

### ISignal
```ts
interface ISignal {
  type: SignalType;          // BUY | SELL | NONE
  price: number;
  timestamp: number;
  tag?: string;
  metadata?: Record<string, unknown>;
}
```

### BotPlugin
```ts
interface BotPlugin {
  name: string;
  version: string;
  onStart?(ctx: PluginContext): Promise<void>;
  onPreTrade?(ctx: PluginContext, trade: PreTradeInfo): Promise<TradeDecision>;
  onPostTrade?(ctx: PluginContext, trade: PostTradeInfo): Promise<void>;
  onCandle?(ctx: PluginContext, candle: ICandle): Promise<void>;
  onSignal?(ctx: PluginContext, signal: ISignal): Promise<ISignal | null>;
  onStop?(ctx: PluginContext): Promise<void>;
}
```

### BotConfig
```ts
interface BotConfig {
  tenantId: string;
  symbol: string;
  riskPercentage: number;
  pollInterval: number;
  stopLoss?: number;           // % — triggers hard SL
  maxDrawdownPercent?: number; // % — stops engine if exceeded
  autonomyLevel?: AutonomyLevel;
}
```

### EngineResult (backtest output)
```ts
interface EngineResult {
  strategyName: string;
  totalReturn: number;     // %
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;     // %
  winRate: number;         // %
  totalTrades: number;
  expectancy: number;      // $ per trade
  equityCurve: EquityPoint[];
  detailedTrades: DetailedTrade[];
}
```
