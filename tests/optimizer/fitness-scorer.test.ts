import { describe, it, expect } from 'vitest';
import { calculateFitness, DEFAULT_WEIGHTS } from '../../src/optimizer/fitness-scorer.js';
import type { BacktestReport } from '../../src/backtest/report-generator.js';

function makeReport(overrides: Partial<BacktestReport> = {}): BacktestReport {
  return {
    totalReturn: 0.50,
    sharpeRatio: 1.5,
    maxDrawdown: 0.10,
    winRate: 0.60,
    tradeCount: 100,
    avgWin: 0.02,
    avgLoss: 0.01,
    profitFactor: 2.0,
    initialCapital: 10_000,
    finalEquity: 15_000,
    totalFees: 50,
    ...overrides,
  };
}

describe('calculateFitness', () => {
  it('should return 0 for no trades', () => {
    expect(calculateFitness(makeReport({ tradeCount: 0 }))).toBe(0);
  });

  it('should return positive score for good performance', () => {
    const score = calculateFitness(makeReport());
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should penalize high drawdown', () => {
    const low = calculateFitness(makeReport({ maxDrawdown: 0.05 }));
    const high = calculateFitness(makeReport({ maxDrawdown: 0.50 }));
    expect(low).toBeGreaterThan(high);
  });

  it('should reward higher Sharpe ratio', () => {
    const lowSharpe = calculateFitness(makeReport({ sharpeRatio: 0.5 }));
    const highSharpe = calculateFitness(makeReport({ sharpeRatio: 2.5 }));
    expect(highSharpe).toBeGreaterThan(lowSharpe);
  });

  it('should reward higher win rate', () => {
    const low = calculateFitness(makeReport({ winRate: 0.30 }));
    const high = calculateFitness(makeReport({ winRate: 0.80 }));
    expect(high).toBeGreaterThan(low);
  });

  it('should handle negative returns gracefully', () => {
    const score = calculateFitness(makeReport({ totalReturn: -0.30 }));
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('should handle Infinity Sharpe as 0', () => {
    const score = calculateFitness(makeReport({ sharpeRatio: Infinity }));
    // normalizeSharpe returns 0 for non-finite
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('should accept custom weights', () => {
    const drawdownHeavy = {
      sharpeWeight: 0, winRateWeight: 0, returnWeight: 0, drawdownPenalty: 1.0,
    };
    const score = calculateFitness(makeReport({ maxDrawdown: 0.50 }), drawdownHeavy);
    // Heavy drawdown penalty with 50% drawdown
    expect(score).toBeLessThan(50);
  });

  it('should clamp score to [0, 100]', () => {
    // Even extreme values should stay in range
    const extreme = makeReport({ sharpeRatio: 10, winRate: 1, totalReturn: 5, maxDrawdown: 0 });
    expect(calculateFitness(extreme)).toBeLessThanOrEqual(100);
    expect(calculateFitness(extreme)).toBeGreaterThanOrEqual(0);
  });
});
