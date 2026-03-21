// Live ML signal feed: combines feature extraction + scoring per symbol
// Maintains per-symbol price history and emits trading signals

import { PricePoint, extractFeatures } from './feature-extractor.js';
import { SignalScore, ModelWeights, DEFAULT_WEIGHTS, scoreFeatures, trainWeights } from './signal-model.js';

export interface SignalThresholds {
  buyThreshold: number;
  sellThreshold: number;
  minConfidence: number;
}

export const DEFAULT_THRESHOLDS: SignalThresholds = {
  buyThreshold: 0.3,
  sellThreshold: -0.3,
  minConfidence: 0.5,
};

export interface SymbolSignal {
  symbol: string;
  signal: SignalScore;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// MlSignalFeed
// ---------------------------------------------------------------------------

export class MlSignalFeed {
  private history = new Map<string, PricePoint[]>();
  private signals = new Map<string, SignalScore>();
  private weights: ModelWeights;
  private thresholds: SignalThresholds;
  /** Max price history points kept per symbol */
  private readonly maxHistory: number;

  constructor(
    weights: ModelWeights = DEFAULT_WEIGHTS,
    thresholds: SignalThresholds = DEFAULT_THRESHOLDS,
    maxHistory = 200
  ) {
    this.weights = weights;
    this.thresholds = thresholds;
    this.maxHistory = maxHistory;
  }

  // ---------------------------------------------------------------------------
  // Data ingestion
  // ---------------------------------------------------------------------------

  addPrice(symbol: string, price: number, volume: number, timestamp: number): void {
    if (!this.history.has(symbol)) this.history.set(symbol, []);
    const buf = this.history.get(symbol)!;

    buf.push({ price, volume, timestamp });

    // Trim to maxHistory
    if (buf.length > this.maxHistory) buf.splice(0, buf.length - this.maxHistory);

    // Recompute signal if enough data
    const features = extractFeatures(buf);
    if (features) {
      this.signals.set(symbol, scoreFeatures(features, this.weights));
    }
  }

  // ---------------------------------------------------------------------------
  // Signal retrieval
  // ---------------------------------------------------------------------------

  getSignal(symbol: string): SignalScore | null {
    return this.signals.get(symbol) ?? null;
  }

  getSignals(): SymbolSignal[] {
    const result: SymbolSignal[] = [];
    for (const [symbol, signal] of this.signals) {
      result.push({ symbol, signal, updatedAt: Date.now() });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Trading decisions
  // ---------------------------------------------------------------------------

  shouldBuy(symbol: string): boolean {
    const signal = this.getSignal(symbol);
    if (!signal) return false;
    return (
      signal.score > this.thresholds.buyThreshold &&
      signal.confidence >= this.thresholds.minConfidence
    );
  }

  shouldSell(symbol: string): boolean {
    const signal = this.getSignal(symbol);
    if (!signal) return false;
    return (
      signal.score < this.thresholds.sellThreshold &&
      signal.confidence >= this.thresholds.minConfidence
    );
  }

  // ---------------------------------------------------------------------------
  // Weight management
  // ---------------------------------------------------------------------------

  /** Retrain weights from current history of a symbol */
  retrainWeights(symbol: string): ModelWeights | null {
    const buf = this.history.get(symbol);
    if (!buf || buf.length < 60) return null;
    this.weights = trainWeights(buf);
    return this.weights;
  }

  setWeights(weights: ModelWeights): void {
    this.weights = weights;
    // Recompute all signals with new weights
    for (const [symbol, buf] of this.history) {
      const features = extractFeatures(buf);
      if (features) this.signals.set(symbol, scoreFeatures(features, this.weights));
    }
  }

  setThresholds(thresholds: Partial<SignalThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  getWeights(): ModelWeights { return { ...this.weights }; }
  getThresholds(): SignalThresholds { return { ...this.thresholds }; }

  /** Number of price points stored for a symbol */
  historySize(symbol: string): number {
    return this.history.get(symbol)?.length ?? 0;
  }
}
