/**
 * Kronos-Enhanced Fair Value — time-series forecasting via AlphaEar sidecar.
 * Supplements LLM-based fair value with quantitative price prediction.
 *
 * Requires: AlphaEar sidecar running at :8100 with Kronos model loaded.
 * Gracefully returns null if sidecar unavailable — never blocks trading.
 */

import { alphaear } from './alphaear-client.js';
import { logger } from '../core/logger.js';

export interface KronosFairValue {
  predictedPrice: number;
  priceRange: { low: number; high: number };
  direction: 'up' | 'down' | 'flat';
  confidence: number;
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
