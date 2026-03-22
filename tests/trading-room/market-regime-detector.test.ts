import { describe, it, expect } from 'vitest';
import { MarketRegimeDetector } from '../../src/trading-room/market-regime-detector.js';

describe('MarketRegimeDetector', () => {
  const detector = new MarketRegimeDetector();

  // Generate a price series: start at base, increment each bar
  function trendUp(bars: number, base = 100, step = 1): number[] {
    return Array.from({ length: bars }, (_, i) => base + i * step);
  }

  function trendDown(bars: number, base = 200, step = 1): number[] {
    return Array.from({ length: bars }, (_, i) => base - i * step);
  }

  function flat(bars: number, base = 100): number[] {
    return Array.from({ length: bars }, () => base);
  }

  // Oscillating +-amplitude around base
  function ranging(bars: number, base = 100, amplitude = 0.5): number[] {
    return Array.from({ length: bars }, (_, i) => base + (i % 2 === 0 ? amplitude : -amplitude));
  }

  describe('calculateATR', () => {
    it('should return 0 for insufficient data', () => {
      expect(detector.calculateATR([100, 101])).toBe(0);
    });

    it('should calculate ATR for trending series', () => {
      const prices = trendUp(30, 100, 2);
      const atr = detector.calculateATR(prices);
      expect(atr).toBeGreaterThan(0);
      expect(atr).toBeCloseTo(2, 0); // each bar moves ~2
    });

    it('should return 0 for flat prices', () => {
      const prices = flat(30);
      expect(detector.calculateATR(prices)).toBe(0);
    });
  });

  describe('calculateADX', () => {
    it('should return 0 for insufficient data', () => {
      expect(detector.calculateADX([100, 101, 102])).toBe(0);
    });

    it('should produce high ADX for strong trend', () => {
      const prices = trendUp(60, 100, 3);
      const adx = detector.calculateADX(prices);
      expect(adx).toBeGreaterThan(25);
    });

    it('should be capped at 100', () => {
      const prices = trendUp(60, 100, 10);
      const adx = detector.calculateADX(prices);
      expect(adx).toBeLessThanOrEqual(100);
    });
  });

  describe('detectRegime', () => {
    it('should return unknown for insufficient data', () => {
      const result = detector.detectRegime([100, 101, 102]);
      expect(result.regime).toBe('unknown');
    });

    it('should detect trending-up for strong uptrend', () => {
      const prices = trendUp(60, 100, 3);
      const result = detector.detectRegime(prices);
      expect(['trending-up', 'volatile']).toContain(result.regime);
    });

    it('should detect trending-down for strong downtrend', () => {
      const prices = trendDown(60, 300, 3);
      const result = detector.detectRegime(prices);
      expect(['trending-down', 'volatile']).toContain(result.regime);
    });

    it('should detect ranging for flat/oscillating prices', () => {
      const prices = ranging(60, 100, 0.01);
      const result = detector.detectRegime(prices);
      expect(result.regime).toBe('ranging');
    });

    it('should return regime indicators', () => {
      const prices = trendUp(60, 100, 1);
      const result = detector.detectRegime(prices);
      expect(result).toHaveProperty('adx');
      expect(result).toHaveProperty('volatility');
      expect(result).toHaveProperty('trendStrength');
      expect(result).toHaveProperty('regime');
    });
  });

  describe('getStrategyRecommendation', () => {
    it('should recommend momentum strategies for trending-up', () => {
      const rec = detector.getStrategyRecommendation('trending-up');
      expect(rec.recommended).toContain('cross-market-arb');
      expect(rec.avoid).toContain('market-maker');
    });

    it('should recommend mean-reversion for ranging', () => {
      const rec = detector.getStrategyRecommendation('ranging');
      expect(rec.recommended).toContain('market-maker');
      expect(rec.recommended).toContain('grid-trading');
    });

    it('should recommend funding harvesting for volatile', () => {
      const rec = detector.getStrategyRecommendation('volatile');
      expect(rec.recommended).toContain('funding-rate-arb');
      expect(rec.avoid).toContain('market-maker');
    });

    it('should return empty recommendations for unknown', () => {
      const rec = detector.getStrategyRecommendation('unknown');
      expect(rec.recommended).toHaveLength(0);
    });

    it('should always include note', () => {
      for (const regime of ['trending-up', 'trending-down', 'ranging', 'volatile', 'unknown'] as const) {
        expect(detector.getStrategyRecommendation(regime).note).toBeTruthy();
      }
    });
  });
});
