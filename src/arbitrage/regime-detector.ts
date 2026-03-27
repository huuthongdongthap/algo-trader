/**
 * Regime Detector
 * Detects market regime changes affecting arbitrage strategy
 *
 * Regimes:
 * - NORMAL: Stable spreads, low volatility
 * - VOLATILE: High volatility, wider spreads
 * - TRENDING: Strong directional movement
 * - CRASH: Extreme volatility, liquidity crisis
 */

import { getRedisClient, type RedisClientType } from '../redis';
import { logger } from '../utils/logger';

export type MarketRegime = 'NORMAL' | 'VOLATILE' | 'TRENDING' | 'CRASH';

export interface RegimeMetrics {
  regime: MarketRegime;
  volatility: number;
  spreadAvg: number;
  spreadStdDev: number;
  volumeChange: number;
  confidence: number;
  timestamp: number;
}

export interface RegimeConfig {
  volatilityThresholds: {
    normal: number;
    volatile: number;
    crash: number;
  };
  lookbackPeriods: number;
  checkIntervalMs: number;
}

export class RegimeDetector {
  private redis: RedisClientType;
  private config: RegimeConfig;
  private currentRegime: MarketRegime = 'NORMAL';
  private regimeHistory: MarketRegime[] = [];

  constructor(redis?: RedisClientType, config?: Partial<RegimeConfig>) {
    this.redis = redis || getRedisClient();
    this.config = {
      volatilityThresholds: {
        normal: 0.5,
        volatile: 1.5,
        crash: 3.0,
      },
      lookbackPeriods: 100,
      checkIntervalMs: 5000,
      ...config,
    };
  }

  /**
   * Calculate volatility from price series
   */
  private calculateVolatility(prices: number[]): number {
    if (prices.length < 2) return 0;

    const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / returns.length;

    return Math.sqrt(variance) * 100;
  }

  /**
   * Calculate spread statistics
   */
  private calculateSpreadStats(spreads: number[]): { avg: number; stdDev: number } {
    if (spreads.length === 0) return { avg: 0, stdDev: 0 };

    const avg = spreads.reduce((a, b) => a + b, 0) / spreads.length;
    const variance = spreads.reduce((a, s) => a + Math.pow(s - avg, 2), 0) / spreads.length;

    return { avg, stdDev: Math.sqrt(variance) };
  }

  /**
   * Get historical spreads from Redis
   */
  private async getHistoricalSpreads(
    symbol: string,
    exchanges: string[],
    periods: number
  ): Promise<number[]> {
    const spreads: number[] = [];

    for (const exchange of exchanges) {
      const key = `ticker:${exchange}:${symbol}`;
      const ticker = await this.redis.hgetall(key);

      if (ticker && Object.keys(ticker).length > 0) {
        const bid = parseFloat(ticker.bid) || 0;
        const ask = parseFloat(ticker.ask) || 0;
        if (bid > 0 && ask > 0) {
          spreads.push(((ask - bid) / bid) * 100);
        }
      }
    }

    return spreads.slice(-periods);
  }

  /**
   * Detect current market regime
   */
  async detectRegime(
    symbol: string,
    exchanges: string[]
  ): Promise<RegimeMetrics> {
    const spreads = await this.getHistoricalSpreads(
      symbol,
      exchanges,
      this.config.lookbackPeriods
    );

    const { avg: spreadAvg, stdDev: spreadStdDev } = this.calculateSpreadStats(spreads);
    const volatility = this.calculateVolatility(spreads);

    let regime: MarketRegime = 'NORMAL';
    let confidence = 0.5;

    if (volatility >= this.config.volatilityThresholds.crash) {
      regime = 'CRASH';
      confidence = 0.9;
    } else if (volatility >= this.config.volatilityThresholds.volatile) {
      regime = 'VOLATILE';
      confidence = 0.8;
    } else if (volatility >= this.config.volatilityThresholds.normal) {
      regime = 'TRENDING';
      confidence = 0.7;
    } else {
      regime = 'NORMAL';
      confidence = 0.8;
    }

    return {
      regime,
      volatility,
      spreadAvg,
      spreadStdDev,
      volumeChange: 0,
      confidence,
      timestamp: Date.now(),
    };
  }

  /**
   * Update current regime
   */
  private updateRegime(metrics: RegimeMetrics): void {
    this.regimeHistory.push(metrics.regime);
    if (this.regimeHistory.length > 10) {
      this.regimeHistory.shift();
    }

    // Confirm regime change if 3 consecutive readings
    const lastThree = this.regimeHistory.slice(-3);
    if (
      lastThree.length === 3 &&
      lastThree.every(r => r === metrics.regime) &&
      metrics.regime !== this.currentRegime
    ) {
      this.currentRegime = metrics.regime;
    }
  }

  /**
   * Start continuous regime detection
   */
  start(
    symbol: string,
    exchanges: string[],
    onRegimeChange: (metrics: RegimeMetrics) => void
  ): void {
    const check = async () => {
      try {
        const metrics = await this.detectRegime(symbol, exchanges);
        const previousRegime = this.currentRegime;
        this.updateRegime(metrics);

        if (this.currentRegime !== previousRegime) {
          onRegimeChange(metrics);
        }
      } catch (error) {
        logger.error('RegimeDetector error:', { error });
      }
    };

    check();
    setInterval(check, this.config.checkIntervalMs);
  }

  /**
   * Get current regime
   */
  getCurrentRegime(): MarketRegime {
    return this.currentRegime;
  }

  /**
   * Get regime history
   */
  getHistory(): MarketRegime[] {
    return [...this.regimeHistory];
  }

  /**
   * Store regime metrics to Redis
   */
  async storeMetrics(metrics: RegimeMetrics, symbol: string): Promise<void> {
    const key = `regime:${symbol}:${metrics.timestamp}`;
    const data = {
      regime: metrics.regime,
      volatility: metrics.volatility.toString(),
      spreadAvg: metrics.spreadAvg.toString(),
      spreadStdDev: metrics.spreadStdDev.toString(),
      volumeChange: metrics.volumeChange.toString(),
      confidence: metrics.confidence.toString(),
      timestamp: metrics.timestamp.toString(),
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(key, data);
    pipeline.expire(key, 3600);
    await pipeline.exec();
  }
}
