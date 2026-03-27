/**
 * Data Preprocessing for GRU Model
 *
 * Handles OHLCV data normalization, sequence creation, and feature engineering.
 */

import * as tf from '@tensorflow/tfjs';

export interface OhlcvData {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizedData {
  X: tf.Tensor3D;
  y: tf.Tensor2D;
  XMean: number;
  XStd: number;
  yMean: number;
  yStd: number;
}

export class DataPreprocessor {
  private inputSteps: number;
  private outputSteps: number;
  private featureCount: number = 5; // OHLCV (using close price primarily)

  constructor(inputSteps: number, outputSteps: number = 1) {
    this.inputSteps = inputSteps;
    this.outputSteps = outputSteps;
  }

  /**
   * Extract features from OHLCV data
   * Returns normalized feature matrix
   */
  extractFeatures(data: OhlcvData[]): number[][] {
    const features: number[][] = [];

    for (const candle of data) {
      // Feature vector: [open, high, low, close, volume]
      features.push([
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
      ]);
    }

    return features;
  }

  /**
   * Create sequences for time-series training
   * X: [samples, inputSteps, features]
   * y: [samples, outputSteps] - target: next N close prices
   */
  createSequences(data: OhlcvData[]): NormalizedData {
    const features = this.extractFeatures(data);
    const samples = features.length - this.inputSteps - this.outputSteps + 1;

    const XArray: number[][][] = [];
    const yArray: number[][] = [];

    for (let i = 0; i < samples; i++) {
      // Input sequence
      const inputSeq = features.slice(i, i + this.inputSteps);
      XArray.push(inputSeq);

      // Target: next outputSteps close prices
      const targetSeq: number[] = [];
      for (let j = 0; j < this.outputSteps; j++) {
        targetSeq.push(data[i + this.inputSteps + j].close);
      }
      yArray.push(targetSeq);
    }

    // Convert to tensors
    const X = tf.tensor3d(XArray);
    const y = tf.tensor2d(yArray);

    // Normalize
    const XMean = X.mean().dataSync()[0];
    const XStd = X.sub(XMean).square().mean().sqrt().dataSync()[0];
    const yMean = y.mean().dataSync()[0];
    const yStd = y.sub(yMean).square().mean().sqrt().dataSync()[0];

    const XNorm = X.sub(XMean).div(XStd + 1e-8);
    const yNorm = y.sub(yMean).div(yStd + 1e-8);

    return {
      X: XNorm as tf.Tensor3D,
      y: yNorm as tf.Tensor2D,
      XMean,
      XStd,
      yMean,
      yStd,
    };
  }

  /**
   * Normalize single sequence for prediction
   */
  normalizeSequence(sequence: number[][]): tf.Tensor3D {
    const X = tf.tensor3d([sequence]);
    // Use training statistics (should be stored and reused)
    const mean = X.mean().dataSync()[0];
    const std = X.sub(mean).square().mean().sqrt().dataSync()[0];
    return X.sub(mean).div(std + 1e-8) as tf.Tensor3D;
  }

  /**
   * Denormalize prediction
   */
  denormalize(prediction: number, mean: number, std: number): number {
    return prediction * std + mean;
  }

  /**
   * Add technical indicators as additional features
   */
  addTechnicalIndicators(data: OhlcvData[]): OhlcvData[] {
    // Can be extended with RSI, MACD, Bollinger Bands, etc.
    // For now, return raw data - feature engineering can be added later
    return data;
  }

  /**
   * Calculate log returns for stationary features
   */
  calculateLogReturns(prices: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      returns.push(Math.log(prices[i] / prices[i - 1]));
    }
    return returns;
  }
}

/**
 * Generate training data from historical candles
 */
export function prepareTrainingData(
  candles: OhlcvData[],
  inputSteps: number,
  outputSteps: number = 1
): NormalizedData {
  const preprocessor = new DataPreprocessor(inputSteps, outputSteps);
  return preprocessor.createSequences(candles);
}
