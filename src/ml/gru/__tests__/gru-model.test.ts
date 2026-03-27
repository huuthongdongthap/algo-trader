/**
 * GRU Model Tests
 */

import { describe, it, expect } from 'vitest';
import * as tf from '@tensorflow/tfjs';
import { GruModel } from '../gru-model';

describe('GruModel', () => {
  it('should build model with correct config', () => {
    const config = {
      inputSteps: 10,
      featureCount: 5,
      gruUnits: 32,
      denseUnits: 16,
      outputSteps: 1,
      learningRate: 0.001,
      dropoutRate: 0.2,
    };

    const model = new GruModel(config);
    const built = model.build();

    expect(built).toBeDefined();
    expect(model.getIsTrained()).toBe(false);

    model.dispose();
  });

  it('should create model with multiple GRU layers', () => {
    const config = {
      inputSteps: 60,
      featureCount: 5,
      gruUnits: 64,
      denseUnits: 32,
      outputSteps: 5,
      learningRate: 0.001,
      dropoutRate: 0.1,
    };

    const model = new GruModel(config);
    const built = model.build();

    expect(built.layers.length).toBeGreaterThan(2);
    model.dispose();
  }, 15000);

  it('should train on sample data', async () => {
    const config = {
      inputSteps: 5,
      featureCount: 5,
      gruUnits: 16,
      denseUnits: 8,
      outputSteps: 1,
      learningRate: 0.01,
      dropoutRate: 0.1,
    };

    const model = new GruModel(config);
    model.build();

    // Create small training dataset
    const X = tf.tensor3d([
      [[1, 2, 3, 4, 5], [2, 3, 4, 5, 6], [3, 4, 5, 6, 7], [4, 5, 6, 7, 8], [5, 6, 7, 8, 9]],
      [[2, 3, 4, 5, 6], [3, 4, 5, 6, 7], [4, 5, 6, 7, 8], [5, 6, 7, 8, 9], [6, 7, 8, 9, 10]],
    ], [2, 5, 5]);

    const y = tf.tensor2d([[6], [7]], [2, 1]);

    await model.train(X, y, 3, 1, 0.1);

    expect(model.getIsTrained()).toBe(true);

    X.dispose();
    y.dispose();
    model.dispose();
  });

  it('should predict from trained model', async () => {
    const config = {
      inputSteps: 3,
      featureCount: 5,
      gruUnits: 8,
      denseUnits: 4,
      outputSteps: 1,
      learningRate: 0.01,
      dropoutRate: 0.0,
    };

    const model = new GruModel(config);
    model.build();

    // Training data
    const X = tf.tensor3d([
      [[1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [3, 3, 3, 3, 3]],
      [[2, 2, 2, 2, 2], [3, 3, 3, 3, 3], [4, 4, 4, 4, 4]],
    ], [2, 3, 5]);

    const y = tf.tensor2d([[4], [5]], [2, 1]);

    await model.train(X, y, 5, 1, 0.1);

    // Predict
    const XTest = tf.tensor3d([[[3, 3, 3, 3, 3], [4, 4, 4, 4, 4], [5, 5, 5, 5, 5]]], [1, 3, 5]);
    const result = model.predict(XTest);

    expect(result).toBeDefined();
    expect(result.predictedPrice).toBeDefined();
    expect(typeof result.confidence).toBe('number');
    expect(['up', 'down', 'neutral']).toContain(result.trend);

    X.dispose();
    y.dispose();
    XTest.dispose();
    model.dispose();
  });

  it('should throw error when predicting untrained model', () => {
    const config = {
      inputSteps: 5,
      featureCount: 5,
      gruUnits: 16,
      denseUnits: 8,
      outputSteps: 1,
      learningRate: 0.001,
      dropoutRate: 0.1,
    };

    const model = new GruModel(config);
    model.build();

    const X = tf.tensor3d([[[1, 2, 3, 4, 5], [2, 3, 4, 5, 6], [3, 4, 5, 6, 7], [4, 5, 6, 7, 8], [5, 6, 7, 8, 9]]], [1, 5, 5]);

    expect(() => model.predict(X)).toThrow('Model not trained');

    X.dispose();
    model.dispose();
  });

  it('should dispose model resources', () => {
    const config = {
      inputSteps: 5,
      featureCount: 5,
      gruUnits: 16,
      denseUnits: 8,
      outputSteps: 1,
      learningRate: 0.001,
      dropoutRate: 0.1,
    };

    const model = new GruModel(config);
    model.build();
    model.dispose();

    expect(model.getIsTrained()).toBe(false);
  });
});
