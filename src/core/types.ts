// Core type definitions for algo-trade platform
// All monetary values use string to avoid float precision issues

export type MarketType = 'polymarket' | 'cex' | 'dex';
export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'open' | 'filled' | 'partially_filled' | 'cancelled' | 'rejected';
export type PositionSide = 'long' | 'short';
export type StrategyName = 'adverse-selection-filter' | 'bayesian-prob-updater' | 'bollinger-squeeze' | 'book-imbalance-reversal' | 'cluster-breakout' | 'consensus-drift' | 'correlation-breakdown' | 'cross-correlation-lag' | 'cross-event-drift' | 'cross-market-arb' | 'cross-platform-basis' | 'dca-bot' | 'decay-rate-momentum' | 'entropy-scorer' | 'event-deadline-scalper' | 'expiry-theta-decay' | 'funding-rate-arb' | 'gamma-scalping' | 'gap-fill-reversion' | 'grid-dca' | 'grid-trading' | 'herd-behavior-detector' | 'info-asymmetry-scanner' | 'inventory-skew-rebalancer' | 'kalman-filter-tracker' | 'liquidation-cascade' | 'liquidity-migration' | 'liquidity-vacuum' | 'market-maker' | 'markov-chain-predictor' | 'mean-reversion' | 'mean-variance-optimizer' | 'microstructure-alpha' | 'momentum-cascade' | 'momentum-exhaustion' | 'multi-leg-hedge' | 'news-catalyst-fade' | 'order-arrival-rate' | 'order-flow-toxicity' | 'orderbook-depth-ratio' | 'pairs-stat-arb' | 'pivot-point-bounce' | 'polymarket-arb' | 'price-acceleration' | 'price-impact-estimator' | 'recency-bias-exploiter' | 'regime-adaptive-momentum' | 'regime-switch-detector' | 'relative-strength-rotation' | 'resolution-frontrunner' | 'sentiment-momentum' | 'session-vol-sniper' | 'smart-money-divergence' | 'spread-compression-arb' | 'spread-mean-reversion' | 'stale-quote-sniper' | 'tail-risk-harvester' | 'tick-momentum-burst' | 'time-weighted-mean-reversion' | 'twap-accumulator' | 'vol-compression-breakout' | 'volatility-surface-arb' | 'volatility-targeting' | 'volume-profile-anomaly' | 'vwap-deviation-sniper' | 'weighted-sentiment-aggregator' | 'whale-tracker';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface MarketInfo {
  id: string;
  symbol: string;
  type: MarketType;
  /** Exchange or protocol name (e.g. 'binance', 'uniswap-v4', 'polymarket') */
  exchange: string;
  baseCurrency: string;
  quoteCurrency: string;
  active: boolean;
}

export interface Order {
  id: string;
  marketId: string;
  side: OrderSide;
  /** Decimal string */
  price: string;
  /** Decimal string */
  size: string;
  status: OrderStatus;
  type: 'limit' | 'market';
  createdAt: number;
  filledAt?: number;
}

export interface Position {
  marketId: string;
  side: PositionSide;
  entryPrice: string;
  size: string;
  unrealizedPnl: string;
  openedAt: number;
}

export interface TradeResult {
  orderId: string;
  marketId: string;
  side: OrderSide;
  fillPrice: string;
  fillSize: string;
  fees: string;
  timestamp: number;
  strategy: StrategyName;
}

export interface RiskLimits {
  /** Max size for a single position (decimal string) */
  maxPositionSize: string;
  /** Max portfolio drawdown as decimal (0.20 = 20%) */
  maxDrawdown: number;
  maxOpenPositions: number;
  /** Per-position stop-loss as decimal (0.10 = 10%) */
  stopLossPercent: number;
  /** Max leverage multiplier */
  maxLeverage: number;
}

export interface StrategyConfig {
  name: StrategyName;
  enabled: boolean;
  /** Capital allocated to this strategy (decimal string) */
  capitalAllocation: string;
  params: Record<string, unknown>;
}

export interface PnlSnapshot {
  timestamp: number;
  equity: string;
  peakEquity: string;
  drawdown: number;
  realizedPnl: string;
  unrealizedPnl: string;
  tradeCount: number;
  winCount: number;
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  /** For Polymarket: Polygon private key */
  privateKey?: string;
}

export interface AppConfig {
  env: 'development' | 'staging' | 'production';
  logLevel: LogLevel;
  dbPath: string;
  riskLimits: RiskLimits;
  strategies: StrategyConfig[];
  exchanges: Record<string, ExchangeCredentials>;
  polymarket: {
    clobUrl: string;
    chainId: number;
    rpcUrl: string;
  };
}
