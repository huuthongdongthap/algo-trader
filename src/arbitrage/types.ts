/**
 * Arbitrage Engine Types
 * Phase 2: Multi-exchange arbitrage trading
 */

export type ExchangeId = 'binance' | 'coinbase' | 'kraken' | 'uniswap' | 'polymarket';

export interface PricePoint {
  exchange: ExchangeId;
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
  volume24h?: number;
}

export interface OrderBookLevel {
  price: number;
  amount: number;
}

export interface OrderBook {
  exchange: ExchangeId;
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export interface ArbitrageOpportunity {
  id: string;
  type: 'triangular' | 'dex-cex' | 'funding-rate' | 'cross-exchange' | 'binary-arb' | 'settlement-arb';
  legs: ArbitrageLeg[];
  expectedProfit: number;
  expectedProfitPct: number;
  totalFees: number;
  gasFee?: number;
  slippage?: number;
  confidence: number;
  detectedAt: number;
  expiresAt: number;
}

export interface ArbitrageLeg {
  exchange: ExchangeId;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  fee: number;
}

export interface ExecutionResult {
  opportunityId: string;
  success: boolean;
  executedLegs: ExecutedLeg[];
  actualProfit: number;
  actualProfitPct: number;
  totalFees: number;
  error?: string;
  executedAt: number;
}

export interface ExecutedLeg {
  exchange: ExchangeId;
  symbol: string;
  side: 'buy' | 'sell';
  executedPrice: number;
  executedAmount: number;
  fee: number;
  txHash?: string;
}

export interface BacktestConfig {
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  exchanges: ExchangeId[];
  symbols: string[];
  minProfitThreshold: number;
  maxPositionSize: number;
}

export interface BacktestResult {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalProfit: number;
  totalLoss: number;
  netProfit: number;
  netProfitPct: number;
  sharpeRatio: number;
  maxDrawdown: number;
  avgTradeDuration: number;
  opportunities: OpportunityMetric[];
}

export interface OpportunityMetric {
  timestamp: number;
  type: string;
  expectedProfit: number;
  executed: boolean;
}

export interface ScannerConfig {
  exchanges: ExchangeId[];
  symbols: string[];
  pollIntervalMs: number;
  minVolume24h: number;
}

export interface DetectorConfig {
  minProfitThreshold: number;
  maxSlippageTolerance: number;
  supportedTypes: Array<'triangular' | 'dex-cex' | 'funding-rate' | 'cross-exchange'>;
}

export interface ExecutorConfig {
  dryRun: boolean;
  maxPositionSize: number;
  slippageTolerance: number;
  minProfitThreshold: number;
  timeoutMs: number;
}

export interface ExecutionEngineConfig {
  dryRun?: boolean;
  timeoutMs?: number;
}

/**
 * Polymarket binary prediction market structure
 */
export interface BinaryMarket {
  conditionId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
  endDate: Date;
  resolved: boolean;
}

/**
 * Binary arbitrage opportunity where YES + NO mispricing creates guaranteed profit
 */
export interface BinaryArbitrageOpportunity extends ArbitrageOpportunity {
  market: BinaryMarket;
  /** Deviation from 1.0 — YES + NO prices should sum to ~1.0 */
  mispricing: number;
  edge: 'yes-cheap' | 'no-cheap' | 'both-cheap';
}

export class ExecutionEngine {
  constructor(_config?: ExecutionEngineConfig) {
    // Implementation placeholder
  }

  async execute(_opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    // Implementation placeholder
    return { opportunityId: '', success: true, executedLegs: [], actualProfit: 0, actualProfitPct: 0, totalFees: 0, executedAt: Date.now() };
  }
}
