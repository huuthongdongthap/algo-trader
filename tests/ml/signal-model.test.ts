import { describe, it, expect } from 'vitest';
import {
  scoreFeatures,
  trainWeights,
  DEFAULT_WEIGHTS,
  type ModelWeights,
} from '../../src/ml/signal-model.js';
import type { PriceFeatures, PricePoint } from '../../src/ml/feature-extractor.js';

const oversoldFeatures: PriceFeatures = {
  sma20: 105, sma50: 100, rsi14: 25, momentum: 0.02,
  volatility: 0.01, volumeChange: 0.1, priceChange: 0.01,
  macdLine: 0.5, macdSignal: 0.3,
};

const overboughtFeatures: PriceFeatures = {
  sma20: 95, sma50: 100, rsi14: 75, momentum: -0.02,
  volatility: 0.01, volumeChange: -0.1, priceChange: -0.01,
  macdLine: -0.5, macdSignal: -0.3,
};

const neutralFeatures: PriceFeatures = {
  sma20: 100, sma50: 100, rsi14: 50, momentum: 0,
  volatility: 0.01, volumeChange: 0, priceChange: 0,
  macdLine: 0, macdSignal: 0,
};

describe('scoreFeatures', () => {
  it('should return positive score for oversold/bullish features', () => {
    const result = scoreFeatures(oversoldFeatures);
    expect(result.score).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.signals.some(s => s.includes('RSI oversold'))).toBe(true);
  });

  it('should return negative score for overbought/bearish features', () => {
    const result = scoreFeatures(overboughtFeatures);
    expect(result.score).toBeLessThan(0);
    expect(result.signals.some(s => s.includes('bearish'))).toBe(true);
  });

  it('should return near-zero score for neutral features', () => {
    const result = scoreFeatures(neutralFeatures);
    expect(Math.abs(result.score)).toBeLessThan(0.1);
  });

  it('should clamp score to [-1, 1]', () => {
    // Extreme bullish everything
    const extreme: PriceFeatures = {
      sma20: 200, sma50: 100, rsi14: 10, momentum: 1,
      volatility: 0, volumeChange: 1, priceChange: 0.5,
      macdLine: 100, macdSignal: 0,
    };
    const result = scoreFeatures(extreme);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(-1);
  });

  it('should respect custom weights', () => {
    const rsiHeavy: ModelWeights = {
      rsiWeight: 0.9, momentumWeight: 0.025, trendWeight: 0.025,
      volatilityWeight: 0.025, macdWeight: 0.025,
    };
    const result = scoreFeatures(oversoldFeatures, rsiHeavy);
    // RSI oversold = +1 * 0.9 → heavily positive
    expect(result.score).toBeGreaterThan(0.7);
  });

  it('should include signal descriptions', () => {
    const result = scoreFeatures(oversoldFeatures);
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals.some(s => s.includes('SMA20 > SMA50 bullish'))).toBe(true);
    expect(result.signals.some(s => s.includes('MACD bullish crossover'))).toBe(true);
  });

  it('should include momentum signal for positive momentum', () => {
    const features = { ...neutralFeatures, momentum: 0.05 };
    const result = scoreFeatures(features);
    expect(result.signals.some(s => s.includes('Momentum positive'))).toBe(true);
  });

  it('should return volatility sell bias for high volatility', () => {
    const features = { ...neutralFeatures, volatility: 0.06 };
    const result = scoreFeatures(features);
    // High volatility adds slight negative bias
    expect(result.score).toBeLessThanOrEqual(0);
  });
});

describe('trainWeights', () => {
  it('should return default weights for insufficient data', () => {
    const shortData: PricePoint[] = Array.from({ length: 10 }, (_, i) => ({
      price: 100 + i, volume: 1000, timestamp: i,
    }));
    const weights = trainWeights(shortData);
    expect(weights).toEqual(DEFAULT_WEIGHTS);
  });

  it('should return weights summing to ~1', () => {
    // Generate enough data for training
    const data: PricePoint[] = Array.from({ length: 100 }, (_, i) => ({
      price: 100 + Math.sin(i / 10) * 20 + i * 0.1,
      volume: 1000 + Math.random() * 500,
      timestamp: i * 60_000,
    }));
    const weights = trainWeights(data, 0.01, 20);
    const total = Object.values(weights).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it('should keep all weights non-negative', () => {
    const data: PricePoint[] = Array.from({ length: 100 }, (_, i) => ({
      price: 100 + Math.random() * 10,
      volume: 1000,
      timestamp: i * 60_000,
    }));
    const weights = trainWeights(data);
    expect(weights.rsiWeight).toBeGreaterThanOrEqual(0);
    expect(weights.momentumWeight).toBeGreaterThanOrEqual(0);
    expect(weights.trendWeight).toBeGreaterThanOrEqual(0);
    expect(weights.volatilityWeight).toBeGreaterThanOrEqual(0);
    expect(weights.macdWeight).toBeGreaterThanOrEqual(0);
  });
});
