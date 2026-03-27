/**
 * Data Preprocessor Tests
 */

import { describe, it, expect } from 'vitest';
import { DataPreprocessor, prepareTrainingData } from '../data-preprocessor';

describe('DataPreprocessor', () => {
  const sampleData = [
    { timestamp: 1, open: 100, high: 105, low: 99, close: 103, volume: 1000 },
    { timestamp: 2, open: 103, high: 108, low: 102, close: 107, volume: 1100 },
    { timestamp: 3, open: 107, high: 110, low: 106, close: 109, volume: 1200 },
    { timestamp: 4, open: 109, high: 112, low: 108, close: 111, volume: 1300 },
    { timestamp: 5, open: 111, high: 115, low: 110, close: 114, volume: 1400 },
    { timestamp: 6, open: 114, high: 118, low: 113, close: 117, volume: 1500 },
    { timestamp: 7, open: 117, high: 120, low: 116, close: 119, volume: 1600 },
    { timestamp: 8, open: 119, high: 122, low: 118, close: 121, volume: 1700 },
    { timestamp: 9, open: 121, high: 125, low: 120, close: 124, volume: 1800 },
    { timestamp: 10, open: 124, high: 128, low: 123, close: 127, volume: 1900 },
  ];

  it('should extract features from OHLCV data', () => {
    const preprocessor = new DataPreprocessor(5, 1);
    const features = preprocessor.extractFeatures(sampleData);

    expect(features).toHaveLength(10);
    expect(features[0]).toHaveLength(5);
    expect(features[0]).toEqual([100, 105, 99, 103, 1000]);
  });

  it('should create sequences with correct dimensions', () => {
    const preprocessor = new DataPreprocessor(5, 1);
    const { X, y } = preprocessor.createSequences(sampleData);

    // 10 candles - 5 input - 1 output + 1 = 5 samples
    expect(X.shape).toEqual([5, 5, 5]);
    expect(y.shape).toEqual([5, 1]);

    X.dispose();
    y.dispose();
  });

  it('should normalize data', () => {
    const preprocessor = new DataPreprocessor(5, 1);
    const { X, y, XMean, XStd, yMean, yStd } = preprocessor.createSequences(sampleData);

    // Normalized data should have mean ~0 and std ~1
    const XMeanNorm = X.mean().dataSync()[0];
    const yMeanNorm = y.mean().dataSync()[0];

    expect(Math.abs(XMeanNorm)).toBeLessThan(0.1);
    expect(Math.abs(yMeanNorm)).toBeLessThan(0.1);

    expect(XMean).toBeGreaterThan(0);
    expect(XStd).toBeGreaterThan(0);
    expect(yMean).toBeGreaterThan(0);
    expect(yStd).toBeGreaterThan(0);

    X.dispose();
    y.dispose();
  });

  it('should prepare training data via helper function', () => {
    const data = prepareTrainingData(sampleData, 5, 1);

    expect(data.X).toBeDefined();
    expect(data.y).toBeDefined();
    expect(data.X.shape[0]).toBeGreaterThan(0);
    expect(data.y.shape[0]).toBeGreaterThan(0);

    data.X.dispose();
    data.y.dispose();
  });

  it('should throw error for insufficient data', () => {
    const preprocessor = new DataPreprocessor(10, 1);
    const smallData = sampleData.slice(0, 5); // Only 5 candles, need 11

    expect(() => preprocessor.createSequences(smallData)).toThrow();
  });

  it('should handle outputSteps > 1', () => {
    const preprocessor = new DataPreprocessor(3, 3);
    const { y } = preprocessor.createSequences(sampleData);

    // Should predict 3 steps ahead
    expect(y.shape[1]).toBe(3);

    y.dispose();
  });

  it('should calculate log returns', () => {
    const preprocessor = new DataPreprocessor(5, 1);
    const prices = [100, 105, 110, 115, 120];
    const returns = preprocessor.calculateLogReturns(prices);

    expect(returns).toHaveLength(4);
    expect(returns[0]).toBeCloseTo(Math.log(105 / 100), 4);
    expect(returns[1]).toBeCloseTo(Math.log(110 / 105), 4);
  });

  it('should normalize single sequence for prediction', () => {
    const preprocessor = new DataPreprocessor(5, 1);
    const sequence = [
      [1, 2, 3, 4, 5],
      [2, 3, 4, 5, 6],
      [3, 4, 5, 6, 7],
      [4, 5, 6, 7, 8],
      [5, 6, 7, 8, 9],
    ];

    const normalized = preprocessor.normalizeSequence(sequence);

    expect(normalized.shape).toEqual([1, 5, 5]);

    normalized.dispose();
  });
});
