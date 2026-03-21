// Feature extraction from price data for ML signal generation
// Pure TypeScript math, no external ML libraries

export interface PriceFeatures {
  sma20: number;
  sma50: number;
  rsi14: number;
  momentum: number;
  volatility: number;
  volumeChange: number;
  priceChange: number;
  macdLine: number;
  macdSignal: number;
}

export interface PricePoint {
  price: number;
  volume: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Core indicator functions
// ---------------------------------------------------------------------------

export function calculateSMA(prices: number[], period: number): number {
  if (prices.length < period) return 0;
  const slice = prices.slice(-period);
  return slice.reduce((sum, p) => sum + p, 0) / period;
}

export function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50; // neutral when insufficient data

  const changes = prices.slice(-period - 1).map((p, i, arr) =>
    i === 0 ? 0 : p - arr[i - 1]
  ).slice(1);

  const gains = changes.map(c => c > 0 ? c : 0);
  const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

  const avgGain = gains.reduce((s, v) => s + v, 0) / period;
  const avgLoss = losses.reduce((s, v) => s + v, 0) / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function calculateMomentum(prices: number[], period = 10): number {
  if (prices.length < period + 1) return 0;
  const current = prices[prices.length - 1];
  const past = prices[prices.length - 1 - period];
  if (past === 0) return 0;
  return (current - past) / past; // rate of change as decimal
}

export function calculateVolatility(prices: number[], period = 20): number {
  if (prices.length < period + 1) return 0;

  const slice = prices.slice(-period - 1);
  const returns = slice.map((p, i, arr) =>
    i === 0 ? 0 : (p - arr[i - 1]) / arr[i - 1]
  ).slice(1);

  const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// EMA helper used internally by MACD
function calculateEMA(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const ema: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calculateMACD(
  prices: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macdLine: number; macdSignal: number } {
  if (prices.length < slow + signal) return { macdLine: 0, macdSignal: 0 };

  const emaFast = calculateEMA(prices, fast);
  const emaSlow = calculateEMA(prices, slow);

  // MACD line = EMA(fast) - EMA(slow), aligned by index
  const macdSeries = emaFast.map((v, i) => v - emaSlow[i]);

  const signalEma = calculateEMA(macdSeries.slice(-signal * 3), signal);

  return {
    macdLine: macdSeries[macdSeries.length - 1],
    macdSignal: signalEma[signalEma.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Main feature extraction
// ---------------------------------------------------------------------------

export function extractFeatures(history: PricePoint[]): PriceFeatures | null {
  if (history.length < 51) return null; // need at least 51 points for SMA50

  const prices = history.map(h => h.price);
  const volumes = history.map(h => h.volume);

  const current = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  const priceChange = prev !== 0 ? (current - prev) / prev : 0;

  const currentVol = volumes[volumes.length - 1];
  const prevVol = volumes[volumes.length - 2];
  const volumeChange = prevVol !== 0 ? (currentVol - prevVol) / prevVol : 0;

  const { macdLine, macdSignal } = calculateMACD(prices);

  return {
    sma20: calculateSMA(prices, 20),
    sma50: calculateSMA(prices, 50),
    rsi14: calculateRSI(prices, 14),
    momentum: calculateMomentum(prices, 10),
    volatility: calculateVolatility(prices, 20),
    volumeChange,
    priceChange,
    macdLine,
    macdSignal,
  };
}
