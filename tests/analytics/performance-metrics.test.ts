import { describe, it, expect } from 'vitest';
import {
  calculateDailyReturns,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateCalmarRatio,
  generatePerformanceReport,
} from '../../src/analytics/performance-metrics.js';
import type { TradeResult } from '../../src/core/types.js';

function makeTrade(side: 'buy' | 'sell', price: string, size: string, timestamp: number): TradeResult {
  return {
    orderId: `o-${timestamp}`, marketId: 'BTC-USDC', side,
    fillPrice: price, fillSize: size, fees: '1', timestamp, strategy: 'grid-trading',
  };
}

describe('calculateDailyReturns', () => {
  it('should return empty for no trades', () => {
    expect(calculateDailyReturns([], 10000)).toHaveLength(0);
  });

  it('should compute daily returns from trades', () => {
    const trades = [
      makeTrade('sell', '100', '10', new Date('2025-01-01').getTime()),
      makeTrade('buy', '50', '10', new Date('2025-01-02').getTime()),
    ];
    const daily = calculateDailyReturns(trades, 10000);
    expect(daily.length).toBeGreaterThan(0);
    expect(daily[0].date).toBe('2025-01-01');
  });
});

describe('calculateSharpeRatio', () => {
  it('should return 0 for < 2 data points', () => {
    expect(calculateSharpeRatio([])).toBe(0);
    expect(calculateSharpeRatio([0.01])).toBe(0);
  });

  it('should compute positive Sharpe for positive returns', () => {
    const returns = [0.01, 0.02, 0.015, 0.005, 0.01, 0.02, 0.01];
    expect(calculateSharpeRatio(returns)).toBeGreaterThan(0);
  });

  it('should compute negative Sharpe for negative returns', () => {
    const returns = [-0.01, -0.02, -0.015, -0.005, -0.01];
    expect(calculateSharpeRatio(returns)).toBeLessThan(0);
  });

  it('should return 0 for zero std dev', () => {
    expect(calculateSharpeRatio([0.01, 0.01, 0.01])).toBe(0);
  });
});

describe('calculateSortinoRatio', () => {
  it('should return 0 for < 2 data points', () => {
    expect(calculateSortinoRatio([])).toBe(0);
  });

  it('should return Infinity for all positive returns', () => {
    const returns = [0.01, 0.02, 0.015];
    expect(calculateSortinoRatio(returns)).toBe(Infinity);
  });

  it('should be higher than Sharpe when few negative returns', () => {
    const returns = [0.02, 0.03, -0.005, 0.01, 0.02];
    const sharpe = calculateSharpeRatio(returns);
    const sortino = calculateSortinoRatio(returns);
    expect(sortino).toBeGreaterThan(sharpe);
  });
});

describe('calculateCalmarRatio', () => {
  it('should return Infinity when no drawdown', () => {
    expect(calculateCalmarRatio(0.5, 0)).toBe(Infinity);
  });

  it('should return ratio of return/drawdown', () => {
    expect(calculateCalmarRatio(0.2, 0.1)).toBeCloseTo(2);
  });

  it('should return 0 for zero return and zero drawdown', () => {
    expect(calculateCalmarRatio(0, 0)).toBe(0);
  });
});

describe('generatePerformanceReport', () => {
  it('should generate report with no trades', () => {
    const report = generatePerformanceReport([], 10000);
    expect(report.startEquity).toBe(10000);
    expect(report.endEquity).toBe(10000);
    expect(report.dailyReturns).toHaveLength(0);
  });

  it('should generate full report with trades', () => {
    const trades = [
      makeTrade('sell', '100', '5', new Date('2025-01-01').getTime()),
      makeTrade('buy', '50', '5', new Date('2025-01-02').getTime()),
      makeTrade('sell', '200', '3', new Date('2025-01-03').getTime()),
    ];
    const report = generatePerformanceReport(trades, 10000);
    expect(report.dailyReturns.length).toBeGreaterThan(0);
    expect(report.weeklyReturns.length).toBeGreaterThanOrEqual(0);
    expect(typeof report.sharpeRatio).toBe('number');
    expect(typeof report.sortinoRatio).toBe('number');
    expect(typeof report.calmarRatio).toBe('number');
    expect(typeof report.maxDrawdown).toBe('number');
  });
});
