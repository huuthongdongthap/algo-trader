/**
 * GRU Strategy Tests
 */

import { describe, it, expect } from 'vitest';
import { GruStrategy } from './GruStrategy';

describe('GruStrategy', () => {
  const sampleCandles = [
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
    { timestamp: 11, open: 127, high: 130, low: 126, close: 129, volume: 2000 },
    { timestamp: 12, open: 129, high: 132, low: 128, close: 131, volume: 2100 },
    { timestamp: 13, open: 131, high: 135, low: 130, close: 134, volume: 2200 },
    { timestamp: 14, open: 134, high: 138, low: 133, close: 137, volume: 2300 },
    { timestamp: 15, open: 137, high: 140, low: 136, close: 139, volume: 2400 },
  ];

  it('should initialize with default config', async () => {
    const strategy = new GruStrategy();
    await strategy.initialize();

    const status = strategy.getStatus();
    expect(status.modelName).toBe('GRU Neural Network');
    expect(status.trained).toBe(false);

    strategy.dispose?.();
  }, 15000);

  it('should initialize with custom config', async () => {
    const strategy = new GruStrategy({
      inputSteps: 5,
      outputSteps: 1,
      gruUnits: 32,
      epochs: 10,
      confidenceThreshold: 0.5,
    });

    await strategy.initialize();

    const status = strategy.getStatus();
    expect(status.modelName).toBe('GRU Neural Network');

    strategy.dispose?.();
  });

  it('should return wait signal when not trained', async () => {
    const strategy = new GruStrategy({ inputSteps: 5 });
    await strategy.initialize();

    const signal = await strategy.execute(sampleCandles.slice(0, 5));

    expect(signal.action).toBe('wait');
    expect(signal.confidence).toBe(0);

    strategy.dispose?.();
  });

  it('should train on historical data', async () => {
    const strategy = new GruStrategy({
      inputSteps: 5,
      outputSteps: 1,
      gruUnits: 16,
      denseUnits: 8,
      epochs: 5,
      batchSize: 1,
    });

    await strategy.initialize();
    await strategy.train(sampleCandles);

    const status = strategy.getStatus();
    expect(status.trained).toBe(true);
    expect(status.candlesSeen).toBe(sampleCandles.length);

    strategy.dispose?.();
  });

  it('should generate signals after training', async () => {
    const strategy = new GruStrategy({
      inputSteps: 5,
      outputSteps: 1,
      gruUnits: 16,
      denseUnits: 8,
      epochs: 10,
      batchSize: 1,
      confidenceThreshold: 0.3,
    });

    await strategy.initialize();
    await strategy.train(sampleCandles);

    // Execute with new candle
    const newCandle = [{ timestamp: 16, open: 139, high: 142, low: 138, close: 141, volume: 2500 }];
    const signal = await strategy.execute(newCandle);

    expect(signal).toBeDefined();
    expect(['buy', 'sell', 'wait']).toContain(signal.action);
    expect(typeof signal.confidence).toBe('number');
    expect(signal.reason).toBeDefined();

    strategy.dispose?.();
  });

  it('should require minimum candles for execution', async () => {
    const strategy = new GruStrategy({ inputSteps: 10, epochs: 3, batchSize: 1, gruUnits: 8, denseUnits: 4 });
    await strategy.initialize();

    // Execute without training - should return wait
    const signal = await strategy.execute(sampleCandles.slice(0, 5));

    expect(signal.action).toBe('wait');
    expect(signal.confidence).toBe(0);
    expect(signal.reason).toContain('not trained');

    strategy.dispose?.();
  }, 15000);

  it('should throw error for insufficient training data', async () => {
    const strategy = new GruStrategy({ inputSteps: 10 });
    await strategy.initialize();

    const shortData = sampleCandles.slice(0, 5);

    await expect(strategy.train(shortData)).rejects.toThrow('Insufficient data');

    strategy.dispose?.();
  });

  it('should return strategy name', async () => {
    const strategy = new GruStrategy();
    await strategy.initialize();

    const name = strategy.getName();
    expect(name).toBe('GRU Neural Network');

    strategy.dispose?.();
  });

  it('should handle multiple execute calls', async () => {
    const strategy = new GruStrategy({
      inputSteps: 5,
      outputSteps: 1,
      gruUnits: 16,
      epochs: 5,
      batchSize: 1,
    });

    await strategy.initialize();
    await strategy.train(sampleCandles);

    // Multiple executions
    const signal1 = await strategy.execute([{ timestamp: 16, open: 139, high: 142, low: 138, close: 141, volume: 2500 }]);
    const signal2 = await strategy.execute([{ timestamp: 17, open: 141, high: 144, low: 140, close: 143, volume: 2600 }]);
    const signal3 = await strategy.execute([{ timestamp: 18, open: 143, high: 146, low: 142, close: 145, volume: 2700 }]);

    expect(signal1).toBeDefined();
    expect(signal2).toBeDefined();
    expect(signal3).toBeDefined();

    strategy.dispose?.();
  });
});
