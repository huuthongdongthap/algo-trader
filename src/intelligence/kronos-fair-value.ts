/**
 * Kronos-Enhanced Fair Value — time-series forecasting via AlphaEar sidecar.
 * Supplements LLM-based fair value with quantitative price prediction.
 *
 * Requires: AlphaEar sidecar running at :8100 with Kronos model loaded.
 * Gracefully returns null if sidecar unavailable — never blocks trading.
 */

import { alphaear } from './alphaear-client.js';
import { logger } from '../core/logger.js';

/** OHLCV prediction point from Kronos foundation model */
export interface KronosOhlcvPrediction {
  close: number;
  high: number;
  low: number;
  confidence: number;
}

export interface KronosFairValue {
  predictedPrice: number;
  priceRange: { low: number; high: number };
  direction: 'up' | 'down' | 'flat';
  confidence: number;
  predictions?: KronosOhlcvPrediction[];
}

/** Candle shape accepted by getKronosOhlcvForecast */
export interface OhlcvCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const MIN_HISTORY_LENGTH = 30;

/**
 * Get Kronos time-series forecast for a market.
 * Returns null if insufficient data or sidecar unavailable.
 */
export async function getKronosFairValue(
  historicalPrices: number[],
  newsContext = '',
): Promise<KronosFairValue | null> {
  if (historicalPrices.length < MIN_HISTORY_LENGTH) {
    logger.debug(`Kronos needs ${MIN_HISTORY_LENGTH}+ price points, got ${historicalPrices.length}`, 'KronosFV');
    return null;
  }

  const forecast = await alphaear.forecast(
    historicalPrices,
    Math.min(historicalPrices.length, 60),
    5,
    newsContext,
  );

  if (!forecast.length) return null;

  const lastPrice = historicalPrices[historicalPrices.length - 1]!;
  const avgForecast = forecast.reduce((s, f) => s + f.close, 0) / forecast.length;
  const minForecast = Math.min(...forecast.map(f => f.low));
  const maxForecast = Math.max(...forecast.map(f => f.high));

  const pctChange = (avgForecast - lastPrice) / lastPrice;
  const direction = pctChange > 0.01 ? 'up' : pctChange < -0.01 ? 'down' : 'flat';

  // Confidence inversely proportional to forecast spread
  const spread = lastPrice > 0 ? (maxForecast - minForecast) / lastPrice : 1;
  const confidence = Math.max(0, Math.min(1, 1 - spread));

  return {
    predictedPrice: avgForecast,
    priceRange: { low: minForecast, high: maxForecast },
    direction,
    confidence,
  };
}

const SIDECAR_URL = process.env['ALPHAEAR_URL'] || process.env['ALPHAEAR_SIDECAR_URL'] || 'http://localhost:8100';
const OHLCV_TIMEOUT_MS = 30_000;

/**
 * Get Kronos OHLCV forecast via the upgraded /v1/kronos/predict-ohlcv endpoint.
 * Calls the Python sidecar directly with full OHLCV candles.
 * Returns null if sidecar unavailable or insufficient data.
 */
export async function getKronosOhlcvForecast(
  candles: OhlcvCandle[],
  predLen = 5,
): Promise<KronosOhlcvPrediction[] | null> {
  if (candles.length < MIN_HISTORY_LENGTH) {
    logger.debug(
      `KronosOHLCV needs ${MIN_HISTORY_LENGTH}+ candles, got ${candles.length}`,
      'KronosFV',
    );
    return null;
  }

  try {
    const resp = await fetch(`${SIDECAR_URL}/v1/kronos/predict-ohlcv`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candles, pred_len: predLen }),
      signal: AbortSignal.timeout(OHLCV_TIMEOUT_MS),
    });

    if (!resp.ok) {
      logger.warn(`KronosOHLCV sidecar returned ${resp.status}`, 'KronosFV');
      return null;
    }

    const data = await resp.json() as { predictions?: KronosOhlcvPrediction[] };
    if (!Array.isArray(data.predictions) || data.predictions.length === 0) {
      logger.debug('KronosOHLCV returned empty predictions', 'KronosFV');
      return null;
    }

    return data.predictions;
  } catch (err) {
    logger.debug(`KronosOHLCV sidecar unavailable: ${String(err)}`, 'KronosFV');
    return null;
  }
}
