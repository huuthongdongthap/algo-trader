/**
 * Backtester
 * Historical data replay, strategy optimization, PnL analytics
 */

import { BacktestConfig, BacktestResult, OpportunityMetric, PricePoint } from './types';
import { DEFAULT_DETECTOR_CONFIG } from './config';
import { OpportunityDetector } from './opportunity-detector';

export class Backtester {
  private config: BacktestConfig;
  private detector: OpportunityDetector;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.detector = new OpportunityDetector(DEFAULT_DETECTOR_CONFIG);
  }

  async run(historicalData: PricePoint[][]): Promise<BacktestResult> {
    const opportunities: OpportunityMetric[] = [];
    let totalProfit = 0;
    let totalLoss = 0;
    let winningTrades = 0;
    let losingTrades = 0;
    let capital = this.config.initialCapital;

    for (const timeSlice of historicalData) {
      const metric = await this.processTimeSlice(timeSlice, capital);
      opportunities.push(metric);

      if (metric.executed) {
        const pnl = metric.expectedProfit;
        if (pnl > 0) {
          totalProfit += pnl;
          winningTrades++;
        } else {
          totalLoss += Math.abs(pnl);
          losingTrades++;
        }
        capital += pnl;
      }
    }

    return this.calculateMetrics(opportunities, totalProfit, totalLoss, winningTrades, losingTrades, capital);
  }

  private async processTimeSlice(prices: PricePoint[], capital: number): Promise<OpportunityMetric> {
    const opportunity = this.detector.detectTriangularArbitrage(prices);

    if (opportunity && opportunity.expectedProfitPct > this.config.minProfitThreshold) {
      const positionSize = Math.min(this.config.maxPositionSize, capital * 0.1);
      const expectedProfit = (positionSize * opportunity.expectedProfitPct) / 100;

      return {
        timestamp: Date.now(),
        type: opportunity.type,
        expectedProfit,
        executed: true,
      };
    }

    return {
      timestamp: Date.now(),
      type: 'none',
      expectedProfit: 0,
      executed: false,
    };
  }

  private calculateMetrics(
    opportunities: OpportunityMetric[],
    totalProfit: number,
    totalLoss: number,
    winningTrades: number,
    losingTrades: number,
    finalCapital: number
  ): BacktestResult {
    const totalTrades = winningTrades + losingTrades;
    const netProfit = totalProfit - totalLoss;
    const netProfitPct = ((netProfit / this.config.initialCapital) * 100);
    const winRate = totalTrades > 0 ? winningTrades / totalTrades : 0;
    const avgWin = winningTrades > 0 ? totalProfit / winningTrades : 0;
    const avgLoss = losingTrades > 0 ? totalLoss / losingTrades : 0;
    const profitFactor = totalLoss > 0 ? totalProfit / totalLoss : Infinity;

    const sharpeRatio = this.calculateSharpeRatio(opportunities);
    const maxDrawdown = this.calculateMaxDrawdown(opportunities);
    const avgTradeDuration = 0;

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      totalProfit,
      totalLoss,
      netProfit,
      netProfitPct,
      sharpeRatio,
      maxDrawdown,
      avgTradeDuration,
      opportunities,
    };
  }

  private calculateSharpeRatio(opportunities: OpportunityMetric[]): number {
    const returns = opportunities.filter((o) => o.executed).map((o) => o.expectedProfit);
    if (returns.length === 0) return 0;

    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    return stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;
  }

  private calculateMaxDrawdown(opportunities: OpportunityMetric[]): number {
    let peak = this.config.initialCapital;
    let maxDrawdown = 0;
    let capital = this.config.initialCapital;

    for (const opp of opportunities) {
      if (opp.executed) {
        capital += opp.expectedProfit;
        if (capital > peak) peak = capital;
        const drawdown = (peak - capital) / peak;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  optimize(): { minProfitThreshold: number; maxPositionSize: number } {
    return {
      minProfitThreshold: this.config.minProfitThreshold,
      maxPositionSize: this.config.maxPositionSize,
    };
  }
}
