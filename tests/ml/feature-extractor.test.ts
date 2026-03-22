import { describe, it, expect } from 'vitest';
import {
  calculateSMA,
  calculateRSI,
  calculateMomentum,
  calculateVolatility,
  calculateMACD,
  extractFeatures,
  type PricePoint,
} from '../../src/ml/feature-extractor.js';

describe('calculateSMA', () => {
  it('should return 0 when insufficient data', () => {
    expect(calculateSMA([1, 2], 5)).toBe(0);
  });

  it('should compute simple moving average', () => {
    const prices = [10, 20, 30, 40, 50];
    expect(calculateSMA(prices, 3)).toBeCloseTo(40, 5); // avg of [30,40,50]
    expect(calculateSMA(prices, 5)).toBeCloseTo(30, 5);
  });
});

describe('calculateRSI', () => {
  it('should return 50 (neutral) for insufficient data', () => {
    expect(calculateRSI([1, 2, 3], 14)).toBe(50);
  });

  it('should return 100 for only gains', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 100 + i); // monotonic up
    expect(calculateRSI(prices, 14)).toBe(100);
  });

  it('should return low RSI for mostly losses', () => {
    const prices = Array.from({ length: 20 }, (_, i) => 200 - i * 5); // monotonic down
    expect(calculateRSI(prices, 14)).toBeLessThan(10);
  });
});

describe('calculateMomentum', () => {
  it('should return 0 for insufficient data', () => {
    expect(calculateMomentum([1, 2], 10)).toBe(0);
  });

  it('should compute rate of change', () => {
    const prices = Array.from({ length: 12 }, (_, i) => 100 + i * 2);
    // current=122, past=102 → (122-102)/102
    expect(calculateMomentum(prices, 10)).toBeCloseTo(20 / 102, 4);
  });

  it('should return 0 when past price is 0', () => {
    const prices = [0, ...Array.from({ length: 10 }, () => 100)];
    expect(calculateMomentum(prices, 10)).toBe(0);
  });
});

describe('calculateVolatility', () => {
  it('should return 0 for insufficient data', () => {
    expect(calculateVolatility([100], 20)).toBe(0);
  });

  it('should return 0 for constant prices', () => {
    const prices = Array.from({ length: 25 }, () => 100);
    expect(calculateVolatility(prices, 20)).toBe(0);
  });

  it('should return positive volatility for varying prices', () => {
    const prices = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 5 : -5));
    expect(calculateVolatility(prices, 20)).toBeGreaterThan(0);
  });
});

describe('calculateMACD', () => {
  it('should return zeros for insufficient data', () => {
    const prices = Array.from({ length: 10 }, () => 100);
    const result = calculateMACD(prices);
    expect(result.macdLine).toBe(0);
    expect(result.macdSignal).toBe(0);
  });

  it('should compute MACD for trending data', () => {
    // 50 points of upward trend → fast EMA > slow EMA → positive MACD
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
    const result = calculateMACD(prices);
    expect(result.macdLine).toBeGreaterThan(0);
  });
});

describe('extractFeatures', () => {
  it('should return null for insufficient history', () => {
    const history: PricePoint[] = Array.from({ length: 30 }, (_, i) => ({
      price: 100, volume: 1000, timestamp: i,
    }));
    expect(extractFeatures(history)).toBeNull();
  });

  it('should extract features from sufficient history', () => {
    const history: PricePoint[] = Array.from({ length: 60 }, (_, i) => ({
      price: 100 + Math.sin(i / 5) * 10,
      volume: 1000 + i * 10,
      timestamp: i * 60_000,
    }));

    const features = extractFeatures(history);
    expect(features).not.toBeNull();
    expect(features!.sma20).toBeGreaterThan(0);
    expect(features!.sma50).toBeGreaterThan(0);
    expect(features!.rsi14).toBeGreaterThanOrEqual(0);
    expect(features!.rsi14).toBeLessThanOrEqual(100);
    expect(typeof features!.momentum).toBe('number');
    expect(typeof features!.volatility).toBe('number');
    expect(typeof features!.volumeChange).toBe('number');
    expect(typeof features!.priceChange).toBe('number');
    expect(typeof features!.macdLine).toBe('number');
    expect(typeof features!.macdSignal).toBe('number');
  });
});
