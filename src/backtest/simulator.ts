// Simulated exchange engine for backtesting strategies against historical data
// Fills orders at candle close price with configurable slippage

import type { TradeResult, OrderSide, StrategyName } from '../core/types.js';
import type { TradeRequest } from '../engine/trade-executor.js';
import type { HistoricalCandle } from './data-loader.js';
import { generateId } from '../core/utils.js';

/** Configuration for a backtest run */
export interface BacktestConfig {
  initialCapital: number;
  /** Slippage as decimal (0.001 = 0.1%) */
  slippage: number;
  /** Fee per trade as decimal (0.001 = 0.1%) */
  feeRate: number;
  strategy: StrategyName;
}

/** Minimal strategy interface for backtest runner */
export interface BacktestStrategy {
  /** Called on each new candle; return trade request or null */
  onCandle(candle: HistoricalCandle, state: SimulatorState): TradeRequest | null;
}

/** Snapshot of simulator state visible to strategy */
export interface SimulatorState {
  balance: number;
  position: number; // net position size (positive = long, negative = short)
  positionAvgPrice: number;
  currentCandle: HistoricalCandle;
  equity: number;
}

/** Internal filled trade record */
interface FilledTrade {
  result: TradeResult;
  pnl: number;
}

/**
 * SimulatedExchange: mock order book that fills orders against candle data.
 * Tracks balance, positions, and P&L throughout a backtest run.
 */
export class SimulatedExchange {
  private balance: number;
  private position: number = 0;
  private positionAvgPrice: number = 0;
  private trades: FilledTrade[] = [];
  private equityCurve: number[] = [];
  private config: BacktestConfig;
  private currentCandle: HistoricalCandle | null = null;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.balance = config.initialCapital;
  }

  /** Simulate a trade fill at current candle close +/- slippage */
  simulateTrade(request: TradeRequest): TradeResult {
    if (!this.currentCandle) throw new Error('No active candle — call setCandle() first');

    const closePrice = this.currentCandle.close;
    const slipMult = request.side === 'buy'
      ? 1 + this.config.slippage
      : 1 - this.config.slippage;
    const fillPrice = closePrice * slipMult;
    const size = parseFloat(request.size);
    const cost = fillPrice * size;
    const fee = cost * this.config.feeRate;

    let pnl = 0;

    if (request.side === 'buy') {
      // Update position (weighted average entry)
      if (this.position >= 0) {
        const totalCost = this.positionAvgPrice * this.position + fillPrice * size;
        this.position += size;
        this.positionAvgPrice = this.position > 0 ? totalCost / this.position : 0;
      } else {
        // Covering short
        pnl = (this.positionAvgPrice - fillPrice) * Math.min(size, Math.abs(this.position));
        this.position += size;
        if (this.position > 0) this.positionAvgPrice = fillPrice;
      }
      this.balance -= cost + fee;
    } else {
      // Sell/short
      if (this.position > 0) {
        // Closing long
        pnl = (fillPrice - this.positionAvgPrice) * Math.min(size, this.position);
        this.position -= size;
        if (this.position < 0) this.positionAvgPrice = fillPrice;
      } else {
        // Opening short
        const totalCost = Math.abs(this.positionAvgPrice * this.position) + fillPrice * size;
        this.position -= size;
        this.positionAvgPrice = this.position < 0 ? totalCost / Math.abs(this.position) : 0;
      }
      this.balance += cost - fee;
    }

    const result: TradeResult = {
      orderId: generateId('bt'),
      marketId: request.symbol,
      side: request.side,
      fillPrice: fillPrice.toFixed(6),
      fillSize: request.size,
      fees: fee.toFixed(6),
      timestamp: this.currentCandle.timestamp,
      strategy: this.config.strategy,
    };

    this.trades.push({ result, pnl });
    return result;
  }

  /** Update the active candle (called by runBacktest each step) */
  setCandle(candle: HistoricalCandle): void {
    this.currentCandle = candle;
    this.equityCurve.push(this.getEquity());
  }

  getEquity(): number {
    if (!this.currentCandle || this.position === 0) return this.balance;
    const unrealized = (this.currentCandle.close - this.positionAvgPrice) * this.position;
    return this.balance + unrealized;
  }

  getState(): SimulatorState {
    if (!this.currentCandle) throw new Error('No active candle');
    return {
      balance: this.balance,
      position: this.position,
      positionAvgPrice: this.positionAvgPrice,
      currentCandle: this.currentCandle,
      equity: this.getEquity(),
    };
  }

  getFilledTrades(): FilledTrade[] { return [...this.trades]; }
  getEquityCurve(): number[] { return [...this.equityCurve]; }
  getTradeResults(): TradeResult[] { return this.trades.map(t => t.result); }
}

/**
 * Run a strategy against historical candles.
 * Returns trade results and equity curve for report generation.
 */
export async function runBacktest(
  strategy: BacktestStrategy,
  candles: HistoricalCandle[],
  config: BacktestConfig,
): Promise<{ trades: TradeResult[]; equityCurve: number[]; finalEquity: number }> {
  const exchange = new SimulatedExchange(config);

  for (const candle of candles) {
    exchange.setCandle(candle);
    const state = exchange.getState();
    const request = strategy.onCandle(candle, state);

    if (request) {
      exchange.simulateTrade({ ...request, dryRun: true });
    }
  }

  return {
    trades: exchange.getTradeResults(),
    equityCurve: exchange.getEquityCurve(),
    finalEquity: exchange.getEquity(),
  };
}
