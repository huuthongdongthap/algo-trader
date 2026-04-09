/**
 * Kronos Foundation Model Trading Strategy
 *
 * Uses the Kronos OHLCV forecasting endpoint on the AlphaEar Python sidecar
 * to generate buy/sell/wait signals based on predicted close vs. current close.
 *
 * Requires: AlphaEar sidecar running at ALPHAEAR_URL (default :8100).
 * Gracefully falls back to 'wait' if the sidecar is unavailable.
 */

import type { IStrategy, ICandle, ISignal } from '../interfaces/IStrategy.js';
import { getKronosOhlcvForecast } from '../intelligence/kronos-fair-value.js';
import { logger } from '../utils/logger.js';

const STRATEGY_NAME = 'KronosFoundation';

export class KronosStrategy implements IStrategy {
  /** Rolling window of recent candles for forecasting context */
  private priceHistory: ICandle[] = [];

  private readonly lookback: number;
  private readonly predLen: number;
  private readonly confidenceThreshold: number;
  private readonly sidecarUrl: string;

  constructor(opts?: {
    lookback?: number;
    predLen?: number;
    confidenceThreshold?: number;
    sidecarUrl?: string;
  }) {
    this.lookback = opts?.lookback ?? 60;
    this.predLen = opts?.predLen ?? 5;
    this.confidenceThreshold = opts?.confidenceThreshold ?? 0.6;
    this.sidecarUrl =
      opts?.sidecarUrl ??
      process.env['ALPHAEAR_URL'] ??
      process.env['ALPHAEAR_SIDECAR_URL'] ??
      'http://localhost:8100';
  }

  getName(): string {
    return STRATEGY_NAME;
  }

  /** Health-check the sidecar on startup. Non-fatal if unavailable. */
  async initialize(): Promise<void> {
    try {
      const resp = await fetch(`${this.sidecarUrl}/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (resp.ok) {
        logger.info('[KronosStrategy] Sidecar healthy', STRATEGY_NAME);
      } else {
        logger.warn(`[KronosStrategy] Sidecar health check returned ${resp.status}`, STRATEGY_NAME);
      }
    } catch {
      logger.warn('[KronosStrategy] Sidecar unreachable — will fallback to wait signals', STRATEGY_NAME);
    }
  }

  /**
   * Execute strategy on the latest candles.
   * Updates internal history, calls Kronos OHLCV forecast,
   * compares predicted close to current close, and emits a signal.
   */
  async execute(candles: ICandle[]): Promise<ISignal> {
    // Append new candles; trim to 2× lookback to cap memory
    this.priceHistory.push(...candles);
    if (this.priceHistory.length > this.lookback * 2) {
      this.priceHistory = this.priceHistory.slice(-this.lookback * 2);
    }

    if (this.priceHistory.length < this.lookback) {
      return this.waitSignal(
        `Insufficient history: ${this.priceHistory.length}/${this.lookback} candles`,
      );
    }

    const inputCandles = this.priceHistory.slice(-this.lookback);
    const predictions = await getKronosOhlcvForecast(inputCandles, this.predLen);

    if (!predictions || predictions.length === 0) {
      return this.waitSignal('Kronos sidecar unavailable or returned no predictions');
    }

    // Use first prediction step for signal decision
    const next = predictions[0]!;
    const currentClose = inputCandles[inputCandles.length - 1]!.close;

    if (next.confidence < this.confidenceThreshold) {
      return this.waitSignal(
        `Low confidence: ${(next.confidence * 100).toFixed(1)}% < threshold ${(this.confidenceThreshold * 100).toFixed(0)}%`,
      );
    }

    const pctChange = (next.close - currentClose) / currentClose;
    const action: ISignal['action'] =
      pctChange > 0.005 ? 'buy' : pctChange < -0.005 ? 'sell' : 'wait';

    logger.info(
      `[KronosStrategy] Signal=${action.toUpperCase()} close=${currentClose.toFixed(4)} → predicted=${next.close.toFixed(4)} (${(pctChange * 100).toFixed(2)}%) conf=${(next.confidence * 100).toFixed(1)}%`,
      STRATEGY_NAME,
    );

    return {
      action,
      confidence: next.confidence,
      reason: `Kronos: predicted close ${pctChange >= 0 ? '+' : ''}${(pctChange * 100).toFixed(2)}% (conf ${(next.confidence * 100).toFixed(1)}%)`,
      metadata: {
        predictedClose: next.close,
        predictedHigh: next.high,
        predictedLow: next.low,
        currentClose,
        pctChange,
        modelType: 'KronosFoundation',
      },
    };
  }

  /** Return current state for monitoring */
  getStatus(): Record<string, unknown> {
    return {
      name: STRATEGY_NAME,
      historyCandleCount: this.priceHistory.length,
      lookback: this.lookback,
      predLen: this.predLen,
      confidenceThreshold: this.confidenceThreshold,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private waitSignal(reason: string): ISignal {
    return { action: 'wait', confidence: 0, reason };
  }
}
