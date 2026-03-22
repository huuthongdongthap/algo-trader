import { describe, it, expect } from 'vitest';
import {
  equityToReturns,
  calculateSharpeRatio,
  calculateMaxDrawdown,
} from '../../src/backtest/backtest-math-helpers.js';

describe('equityToReturns', () => {
  it('should convert equity curve to period returns', () => {
    const curve = [100, 110, 105, 120];
    const returns = equityToReturns(curve);
    expect(returns.length).toBe(3);
    expect(returns[0]).toBeCloseTo(0.1, 5);    // 100→110 = +10%
    expect(returns[1]).toBeCloseTo(-0.04545, 4); // 110→105
    expect(returns[2]).toBeCloseTo(0.14286, 4); // 105→120
  });

  it('should return empty for single-point curve', () => {
    expect(equityToReturns([100])).toEqual([]);
  });

  it('should return empty for empty curve', () => {
    expect(equityToReturns([])).toEqual([]);
  });

  it('should skip zero-value previous points', () => {
    const curve = [0, 100, 110];
    const returns = equityToReturns(curve);
    // First period skipped (prev=0), second = (110-100)/100
    expect(returns.length).toBe(1);
    expect(returns[0]).toBeCloseTo(0.1, 5);
  });
});

describe('calculateSharpeRatio', () => {
  it('should return 0 for fewer than 2 returns', () => {
    expect(calculateSharpeRatio([])).toBe(0);
    expect(calculateSharpeRatio([0.01])).toBe(0);
  });

  it('should return 0 for zero standard deviation', () => {
    expect(calculateSharpeRatio([0.01, 0.01, 0.01])).toBe(0);
  });

  it('should compute positive Sharpe for consistently positive returns', () => {
    const returns = Array.from({ length: 100 }, () => 0.005); // +0.5%/day
    // Add some noise
    returns[10] = -0.001;
    returns[50] = -0.002;
    const sharpe = calculateSharpeRatio(returns);
    expect(sharpe).toBeGreaterThan(0);
  });

  it('should accept custom risk-free rate', () => {
    const returns = [0.01, 0.02, 0.015, 0.005, 0.01];
    const s1 = calculateSharpeRatio(returns, 0.02);
    const s2 = calculateSharpeRatio(returns, 0.10);
    // Higher risk-free rate → lower Sharpe
    expect(s1).toBeGreaterThan(s2);
  });
});

describe('calculateMaxDrawdown', () => {
  it('should return 0 for monotonically increasing curve', () => {
    expect(calculateMaxDrawdown([100, 110, 120, 130])).toBe(0);
  });

  it('should return 0 for fewer than 2 points', () => {
    expect(calculateMaxDrawdown([100])).toBe(0);
    expect(calculateMaxDrawdown([])).toBe(0);
  });

  it('should compute drawdown correctly', () => {
    // Peak at 200, drops to 150 → 25% drawdown
    const curve = [100, 150, 200, 180, 150, 190];
    const dd = calculateMaxDrawdown(curve);
    expect(dd).toBeCloseTo(0.25, 5); // (200-150)/200
  });

  it('should handle multiple drawdowns and return the max', () => {
    // First dd: 100→80 = 20%, second dd: 120→60 = 50%
    const curve = [100, 80, 120, 60];
    const dd = calculateMaxDrawdown(curve);
    expect(dd).toBeCloseTo(0.5, 5);
  });
});
