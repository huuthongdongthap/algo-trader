// Market regime detection — identify trending/ranging/volatile conditions
// Ported from: market-regime-detector concept
// Pure math, no external dependencies.

export type MarketRegime = 'trending-up' | 'trending-down' | 'ranging' | 'volatile' | 'unknown';

export interface RegimeIndicators {
  /** Average Directional Index (0–100). >25 = trending */
  adx: number;
  /** ATR as % of price (normalized volatility) */
  volatility: number;
  /** Net price change / ATR — signed trend strength */
  trendStrength: number;
  regime: MarketRegime;
}

export interface StrategyRecommendation {
  regime: MarketRegime;
  recommended: string[];
  avoid: string[];
  note: string;
}

/** Default smoothing periods */
const DEFAULT_ADX_PERIOD = 14;
const DEFAULT_ATR_PERIOD = 14;

/**
 * Detects market regime from a price series.
 *
 * Classification thresholds:
 *   ADX > 25 AND trendStrength > 0  → trending-up
 *   ADX > 25 AND trendStrength < 0  → trending-down
 *   volatility > 3%                 → volatile (overrides ranging)
 *   ADX <= 25                       → ranging
 */
export class MarketRegimeDetector {
  /**
   * Calculate Average True Range over `period` bars.
   * Requires at least period+1 prices.
   */
  calculateATR(prices: number[], period: number = DEFAULT_ATR_PERIOD): number {
    if (prices.length < period + 1) return 0;

    // True Range = |high - low| approximated as |price[i] - price[i-1]|
    // (single price series — no OHLC available)
    const trueRanges: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      trueRanges.push(Math.abs(prices[i] - prices[i - 1]));
    }

    // Wilder's smoothing (EMA with alpha = 1/period)
    let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
    for (let i = period; i < trueRanges.length; i++) {
      atr = (atr * (period - 1) + trueRanges[i]) / period;
    }
    return atr;
  }

  /**
   * Calculate ADX (Average Directional Index) — measures trend strength.
   * Simplified version using price-only (no separate high/low).
   * Range: 0–100. Values >25 indicate a trending market.
   */
  calculateADX(prices: number[], period: number = DEFAULT_ADX_PERIOD): number {
    if (prices.length < period * 2 + 1) return 0;

    const plusDM: number[] = [];
    const minusDM: number[] = [];
    const tr: number[] = [];

    for (let i = 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      plusDM.push(Math.max(diff, 0));
      minusDM.push(Math.max(-diff, 0));
      tr.push(Math.abs(diff));
    }

    // Wilder's smoothed sums
    const smooth = (arr: number[]) => {
      let val = arr.slice(0, period).reduce((s, v) => s + v, 0);
      const result = [val];
      for (let i = period; i < arr.length; i++) {
        val = val - val / period + arr[i];
        result.push(val);
      }
      return result;
    };

    const smoothPDM = smooth(plusDM);
    const smoothMDM = smooth(minusDM);
    const smoothTR = smooth(tr);

    const dx: number[] = [];
    for (let i = 0; i < smoothTR.length; i++) {
      if (smoothTR[i] === 0) { dx.push(0); continue; }
      const diPlus = (smoothPDM[i] / smoothTR[i]) * 100;
      const diMinus = (smoothMDM[i] / smoothTR[i]) * 100;
      const diSum = diPlus + diMinus;
      dx.push(diSum === 0 ? 0 : (Math.abs(diPlus - diMinus) / diSum) * 100);
    }

    if (dx.length < period) return 0;
    // Final ADX = Wilder smoothed DX
    let adx = dx.slice(-period).reduce((s, v) => s + v, 0) / period;
    return Math.min(adx, 100);
  }

  /**
   * Analyze a price array and classify the current market regime.
   */
  detectRegime(prices: number[]): RegimeIndicators {
    if (prices.length < DEFAULT_ADX_PERIOD * 2 + 2) {
      return { adx: 0, volatility: 0, trendStrength: 0, regime: 'unknown' };
    }

    const lastPrice = prices[prices.length - 1];
    const atr = this.calculateATR(prices);
    const adx = this.calculateADX(prices);

    // Normalized volatility: ATR as % of current price
    const volatility = lastPrice > 0 ? (atr / lastPrice) * 100 : 0;

    // Trend strength: net move over last `period` bars / ATR
    const lookback = prices[prices.length - 1 - DEFAULT_ADX_PERIOD] ?? prices[0];
    const trendStrength = atr > 0 ? (lastPrice - lookback) / atr : 0;

    let regime: MarketRegime;
    if (volatility > 3) {
      regime = 'volatile';
    } else if (adx > 25) {
      regime = trendStrength >= 0 ? 'trending-up' : 'trending-down';
    } else {
      regime = 'ranging';
    }

    return { adx, volatility, trendStrength, regime };
  }

  /** Strategy recommendations per detected regime */
  getStrategyRecommendation(regime: MarketRegime): StrategyRecommendation {
    const map: Record<MarketRegime, StrategyRecommendation> = {
      'trending-up': {
        regime,
        recommended: ['cross-market-arb', 'dca-bot'],
        avoid: ['market-maker', 'grid-trading'],
        note: 'Ride momentum — avoid mean-reversion strategies',
      },
      'trending-down': {
        regime,
        recommended: ['cross-market-arb', 'funding-rate-arb'],
        avoid: ['dca-bot', 'market-maker'],
        note: 'Defensive posture — arb and funding harvesting viable',
      },
      'ranging': {
        regime,
        recommended: ['market-maker', 'grid-trading'],
        avoid: ['dca-bot'],
        note: 'Mean-reversion optimal — tight spread market-making',
      },
      'volatile': {
        regime,
        recommended: ['funding-rate-arb'],
        avoid: ['market-maker', 'grid-trading', 'dca-bot'],
        note: 'Reduce size, widen spreads, prefer funding harvesting',
      },
      'unknown': {
        regime,
        recommended: [],
        avoid: ['market-maker', 'grid-trading'],
        note: 'Insufficient data — wait for regime signal',
      },
    };

    return map[regime];
  }
}
