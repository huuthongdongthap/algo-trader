/**
 * GRU Neural Network Trading Strategy
 *
 * Uses GRU model predictions for buy/sell signals.
 */

import * as tf from '@tensorflow/tfjs';
import { GruModel, GruModelConfig, PredictionResult } from '../ml/gru/gru-model';
import { DataPreprocessor, OhlcvData, prepareTrainingData } from '../ml/gru/data-preprocessor';
import { logger } from '../utils/logger';

export interface ISignal {
  action: 'buy' | 'sell' | 'wait';
  confidence: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface ICandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IStrategy {
  getName(): string;
  initialize(): Promise<void>;
  train?(candles: ICandle[]): Promise<void>;
  execute(candles: ICandle[]): Promise<ISignal>;
  getStatus?(): Record<string, any>;
  dispose?(): void;
}

export interface GruStrategyConfig {
  inputSteps: number;        // Historical candles for input (e.g., 60)
  outputSteps: number;       // Candles to predict (e.g., 1)
  gruUnits: number;          // GRU layer size (e.g., 64)
  denseUnits: number;        // Dense layer size (e.g., 32)
  learningRate: number;      // Training learning rate
  epochs: number;            // Training epochs
  batchSize: number;         // Training batch size
  confidenceThreshold: number; // Min confidence for signal (0.0-1.0)
  retrainInterval: number;   // Retrain every N candles
}

export class GruStrategy implements IStrategy {
  private model: GruModel;
  private config: GruStrategyConfig;
  private preprocessor: DataPreprocessor;
  private priceHistory: OhlcvData[] = [];
  private trained: boolean = false;
  private candleCount: number = 0;

  constructor(config: Partial<GruStrategyConfig> = {}) {
    this.config = {
      inputSteps: config.inputSteps || 60,
      outputSteps: config.outputSteps || 1,
      gruUnits: config.gruUnits || 64,
      denseUnits: config.denseUnits || 32,
      learningRate: config.learningRate || 0.001,
      epochs: config.epochs || 50,
      batchSize: config.batchSize || 32,
      confidenceThreshold: config.confidenceThreshold || 0.7,
      retrainInterval: config.retrainInterval || 100,
    };

    const modelConfig: GruModelConfig = {
      inputSteps: this.config.inputSteps,
      featureCount: 5, // OHLCV
      gruUnits: this.config.gruUnits,
      denseUnits: this.config.denseUnits,
      outputSteps: this.config.outputSteps,
      learningRate: this.config.learningRate,
      dropoutRate: 0.2,
    };

    this.model = new GruModel(modelConfig);
    this.preprocessor = new DataPreprocessor(
      this.config.inputSteps,
      this.config.outputSteps
    );
  }

  getName(): string {
    return 'GRU Neural Network';
  }

  /**
   * Initialize strategy - build model
   */
  async initialize(): Promise<void> {
    this.model.build();
    logger.info(`[GRU] Model initialized: ${this.config.inputSteps} steps → ${this.config.outputSteps} predictions`);
  }

  /**
   * Train model on historical data
   */
  async train(candles: OhlcvData[]): Promise<void> {
    if (candles.length < this.config.inputSteps + this.config.outputSteps) {
      throw new Error(
        `Insufficient data: need ${this.config.inputSteps + this.config.outputSteps} candles, got ${candles.length}`
      );
    }

    logger.info(`[GRU] Training on ${candles.length} candles...`);

    // Prepare training data
    const { X, y } = prepareTrainingData(
      candles,
      this.config.inputSteps,
      this.config.outputSteps
    );

    // Train model
    await this.model.train(X, y, this.config.epochs, this.config.batchSize, 0.2);

    // Cleanup tensors
    X.dispose();
    y.dispose();

    this.trained = true;
    this.priceHistory = [...candles];
    this.candleCount = candles.length;

    logger.info(`[GRU] Training complete. Model ready.`);
  }

  /**
   * Generate trading signal from current market data
   */
  async execute(candles: OhlcvData[]): Promise<ISignal> {
    if (!this.trained) {
      return { action: 'wait', confidence: 0, reason: 'Model not trained' };
    }

    // Update price history
    this.priceHistory.push(...candles);
    this.candleCount += candles.length;

    // Keep only recent history
    const maxHistory = this.config.inputSteps * 2;
    if (this.priceHistory.length > maxHistory) {
      this.priceHistory = this.priceHistory.slice(-maxHistory);
    }

    // Need at least inputSteps candles
    if (this.priceHistory.length < this.config.inputSteps) {
      return { action: 'wait', confidence: 0, reason: 'Insufficient data' };
    }

    // Prepare input sequence
    const inputSequence = this.priceHistory.slice(-this.config.inputSteps);
    const features = this.preprocessor.extractFeatures(inputSequence);
    const X = this.preprocessor.normalizeSequence(features);

    // Get prediction
    const prediction = this.model.predict(X);
    X.dispose();

    // Check confidence threshold
    if (prediction.confidence < this.config.confidenceThreshold) {
      return {
        action: 'wait',
        confidence: prediction.confidence,
        reason: `Low confidence: ${(prediction.confidence * 100).toFixed(1)}%`,
      };
    }

    // Generate signal based on trend prediction
    const signal: ISignal = {
      action: prediction.trend === 'up' ? 'buy' : prediction.trend === 'down' ? 'sell' : 'wait',
      confidence: prediction.confidence,
      reason: `GRU prediction: ${prediction.trend.toUpperCase()} (confidence: ${(prediction.confidence * 100).toFixed(1)}%)`,
      metadata: {
        predictedPrice: prediction.predictedPrice,
        trend: prediction.trend,
        modelType: 'GRU',
      },
    };

    return signal;
  }

  /**
   * Get current model status
   */
  getStatus(): { trained: boolean; candlesSeen: number; modelName: string } {
    return {
      trained: this.trained,
      candlesSeen: this.candleCount,
      modelName: this.getName(),
    };
  }

  /**
   * Save model to disk
   */
  async saveModel(path: string): Promise<void> {
    if (!this.trained) {
      throw new Error('Cannot save untrained model');
    }
    await this.model.save(path);
    logger.info(`[GRU] Model saved to ${path}`);
  }

  /**
   * Load model from disk
   */
  async loadModel(path: string): Promise<void> {
    this.model = await GruModel.load(path);
    this.trained = true;
    logger.info(`[GRU] Model loaded from ${path}`);
  }

  /**
   * Cleanup resources
   */
  dispose(): void {
    this.model.dispose();
  }
}
