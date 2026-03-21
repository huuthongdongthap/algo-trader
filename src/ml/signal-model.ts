// Simple weighted scoring model for trading signals
// No external ML libs — pure TypeScript math with least-squares weight optimization

import { PriceFeatures, PricePoint, extractFeatures } from './feature-extractor.js';

export interface SignalScore {
  /** Composite score: -1 (strong sell) to +1 (strong buy) */
  score: number;
  /** Confidence: 0 to 1 based on signal agreement */
  confidence: number;
  /** Human-readable signal reasons */
  signals: string[];
}

export interface ModelWeights {
  rsiWeight: number;
  momentumWeight: number;
  trendWeight: number;
  volatilityWeight: number;
  macdWeight: number;
}

export const DEFAULT_WEIGHTS: ModelWeights = {
  rsiWeight: 0.25,
  momentumWeight: 0.20,
  trendWeight: 0.25,
  volatilityWeight: 0.10,
  macdWeight: 0.20,
};

// ---------------------------------------------------------------------------
// Signal component scorers (each returns -1 to +1)
// ---------------------------------------------------------------------------

function scoreRSI(rsi: number): number {
  if (rsi < 30) return 1;           // oversold → buy
  if (rsi > 70) return -1;          // overbought → sell
  if (rsi < 45) return 0.3;
  if (rsi > 55) return -0.3;
  return 0;
}

function scoreTrend(sma20: number, sma50: number): number {
  if (sma20 === 0 || sma50 === 0) return 0;
  const diff = (sma20 - sma50) / sma50;
  // Clamp to [-1, 1] with sensitivity factor
  return Math.max(-1, Math.min(1, diff * 20));
}

function scoreMACD(macdLine: number, macdSignal: number): number {
  const diff = macdLine - macdSignal;
  if (diff === 0) return 0;
  // Normalize: positive diff = bullish crossover
  const magnitude = Math.abs(macdLine) + Math.abs(macdSignal) + 1e-10;
  return Math.max(-1, Math.min(1, diff / magnitude));
}

function scoreMomentum(momentum: number): number {
  // momentum is rate-of-change; clamp to [-1, 1] with 10% as full signal
  return Math.max(-1, Math.min(1, momentum * 10));
}

function scoreVolatility(volatility: number): number {
  // High volatility = lower confidence, score near 0 when chaotic
  // Returns slight sell bias during high volatility (risk-off)
  if (volatility > 0.05) return -0.2;  // >5% std dev = high risk
  if (volatility > 0.02) return -0.1;
  return 0;
}

// ---------------------------------------------------------------------------
// Main scoring function
// ---------------------------------------------------------------------------

export function scoreFeatures(features: PriceFeatures, weights: ModelWeights = DEFAULT_WEIGHTS): SignalScore {
  const rsiScore = scoreRSI(features.rsi14);
  const trendScore = scoreTrend(features.sma20, features.sma50);
  const macdScore = scoreMACD(features.macdLine, features.macdSignal);
  const momentumScore = scoreMomentum(features.momentum);
  const volatilityScore = scoreVolatility(features.volatility);

  const rawScore =
    rsiScore * weights.rsiWeight +
    trendScore * weights.trendWeight +
    macdScore * weights.macdWeight +
    momentumScore * weights.momentumWeight +
    volatilityScore * weights.volatilityWeight;

  // Clamp final score to [-1, 1]
  const score = Math.max(-1, Math.min(1, rawScore));

  // Confidence: proportion of signals agreeing with final direction
  const componentScores = [rsiScore, trendScore, macdScore, momentumScore];
  const agreeing = componentScores.filter(s => Math.sign(s) === Math.sign(score) && s !== 0).length;
  const confidence = componentScores.length > 0 ? agreeing / componentScores.length : 0;

  // Build human-readable signal list
  const signals: string[] = [];
  if (features.rsi14 < 30) signals.push(`RSI oversold (${features.rsi14.toFixed(1)})`);
  else if (features.rsi14 > 70) signals.push(`RSI overbought (${features.rsi14.toFixed(1)})`);
  if (features.sma20 > features.sma50) signals.push('SMA20 > SMA50 bullish');
  else if (features.sma20 < features.sma50) signals.push('SMA20 < SMA50 bearish');
  if (features.macdLine > features.macdSignal) signals.push('MACD bullish crossover');
  else if (features.macdLine < features.macdSignal) signals.push('MACD bearish crossover');
  if (features.momentum > 0.01) signals.push(`Momentum positive (${(features.momentum * 100).toFixed(2)}%)`);
  else if (features.momentum < -0.01) signals.push(`Momentum negative (${(features.momentum * 100).toFixed(2)}%)`);

  return { score, confidence, signals };
}

// ---------------------------------------------------------------------------
// Weight optimization via simple least-squares gradient descent
// ---------------------------------------------------------------------------

interface TrainingSample {
  features: PriceFeatures;
  /** Actual return over next period as decimal */
  actualReturn: number;
}

function buildTrainingSamples(historicalData: PricePoint[]): TrainingSample[] {
  const samples: TrainingSample[] = [];
  // Need at least 52 points for features + 1 lookahead
  for (let i = 51; i < historicalData.length - 1; i++) {
    const slice = historicalData.slice(0, i + 1);
    const features = extractFeatures(slice);
    if (!features) continue;
    const current = historicalData[i].price;
    const next = historicalData[i + 1].price;
    const actualReturn = current !== 0 ? (next - current) / current : 0;
    samples.push({ features, actualReturn });
  }
  return samples;
}

export function trainWeights(
  historicalData: PricePoint[],
  learningRate = 0.01,
  epochs = 50
): ModelWeights {
  const samples = buildTrainingSamples(historicalData);
  if (samples.length < 10) return { ...DEFAULT_WEIGHTS };

  let w = { ...DEFAULT_WEIGHTS };

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradients = { rsiWeight: 0, momentumWeight: 0, trendWeight: 0, volatilityWeight: 0, macdWeight: 0 };

    for (const { features, actualReturn } of samples) {
      const { score } = scoreFeatures(features, w);
      const error = score - actualReturn;

      // Partial derivatives: ∂loss/∂w_i = error * component_score_i
      gradients.rsiWeight += error * scoreRSI(features.rsi14);
      gradients.momentumWeight += error * scoreMomentum(features.momentum);
      gradients.trendWeight += error * scoreTrend(features.sma20, features.sma50);
      gradients.volatilityWeight += error * scoreVolatility(features.volatility);
      gradients.macdWeight += error * scoreMACD(features.macdLine, features.macdSignal);
    }

    const n = samples.length;
    // Gradient descent step
    (Object.keys(gradients) as (keyof ModelWeights)[]).forEach(k => {
      w[k] = Math.max(0, w[k] - learningRate * gradients[k] / n);
    });

    // Re-normalize weights to sum to 1
    const total = Object.values(w).reduce((s, v) => s + v, 0);
    if (total > 0) {
      (Object.keys(w) as (keyof ModelWeights)[]).forEach(k => { w[k] /= total; });
    }
  }

  return w;
}
