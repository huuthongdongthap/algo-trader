import { describe, it, expect, beforeEach } from 'vitest';
import {
  kellyFraction,
  isDrawdownExceeded,
  calculatePositionSize,
  calculateStopLoss,
  RiskManager,
} from '../../src/core/risk-manager.js';
import type { RiskLimits, Position } from '../../src/core/types.js';

describe('kellyFraction', () => {
  it('should return 0 for invalid win rate', () => {
    expect(kellyFraction(0, 100, 50)).toBe(0);
    expect(kellyFraction(1, 100, 50)).toBe(0);
  });

  it('should return 0 for zero avg loss', () => {
    expect(kellyFraction(0.5, 100, 0)).toBe(0);
  });

  it('should calculate kelly fraction correctly (50% win rate, 2:1 odds)', () => {
    // Kelly = (2 * 0.5 - 0.5) / 2 = 0.25 * 0.5 (half-kelly) = 0.125
    const result = kellyFraction(0.5, 100, 50);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(0.25); // Capped at 25%
  });

  it('should calculate kelly fraction with 60% win rate', () => {
    // Kelly = (1.5 * 0.6 - 0.4) / 1.5 = 0.5 * 0.5 (half-kelly)
    const result = kellyFraction(0.6, 150, 100);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(0.25);
  });

  it('should cap kelly fraction at 25% (half-kelly safety)', () => {
    // Create scenario where kelly would be very high
    const result = kellyFraction(0.9, 1000, 100);
    expect(result).toBeLessThanOrEqual(0.25);
  });

  it('should handle edge case with negative kelly (lossy strategy)', () => {
    // Low win rate, small avg win vs large avg loss
    const result = kellyFraction(0.3, 50, 200);
    expect(result).toBe(0); // Negative kelly clamped to 0
  });
});

describe('isDrawdownExceeded', () => {
  it('should return false when peak equity is 0', () => {
    expect(isDrawdownExceeded('1000', '0', 0.2)).toBe(false);
  });

  it('should return false when drawdown is within limit', () => {
    // Peak: 1000, Current: 850 → Drawdown: 15%
    expect(isDrawdownExceeded('850', '1000', 0.2)).toBe(false);
  });

  it('should return true when drawdown exceeds limit', () => {
    // Peak: 1000, Current: 750 → Drawdown: 25%
    expect(isDrawdownExceeded('750', '1000', 0.2)).toBe(true);
  });

  it('should return false when at peak equity', () => {
    expect(isDrawdownExceeded('1000', '1000', 0.2)).toBe(false);
  });

  it('should handle small drawdowns correctly', () => {
    // Peak: 10000, Current: 9900 → Drawdown: 1%
    expect(isDrawdownExceeded('9900', '10000', 0.05)).toBe(false);
  });

  it('should handle very strict drawdown limits', () => {
    // Peak: 1000, Current: 990 → Drawdown: 1%
    expect(isDrawdownExceeded('990', '1000', 0.009)).toBe(true);
  });
});

describe('calculatePositionSize', () => {
  it('should return 0 for zero or negative stop loss', () => {
    expect(calculatePositionSize('10000', 0.02, 0)).toBe('0');
    expect(calculatePositionSize('10000', 0.02, -0.01)).toBe('0');
  });

  it('should calculate position size correctly', () => {
    // Capital: 10000, Risk: 2%, StopLoss: 5%
    // Risk amount: 200, Position size: 200 / 0.05 = 4000
    const result = calculatePositionSize('10000', 0.02, 0.05);
    expect(result).toBe('4000.00');
  });

  it('should return decimal position size with proper precision', () => {
    // Capital: 1000, Risk: 1%, StopLoss: 2%
    // Risk amount: 10, Position size: 10 / 0.02 = 500
    const result = calculatePositionSize('1000', 0.01, 0.02);
    expect(result).toBe('500.00');
  });

  it('should handle small position sizes', () => {
    // Capital: 100, Risk: 0.5%, StopLoss: 10%
    // Risk amount: 0.5, Position size: 0.5 / 0.1 = 5
    const result = calculatePositionSize('100', 0.005, 0.1);
    expect(result).toBe('5.00');
  });

  it('should handle high capital and small risk', () => {
    // Capital: 1000000, Risk: 0.1%, StopLoss: 1%
    // Risk amount: 1000, Position size: 1000 / 0.01 = 100000
    const result = calculatePositionSize('1000000', 0.001, 0.01);
    expect(result).toBe('100000.00');
  });
});

describe('calculateStopLoss', () => {
  it('should calculate stop loss for long positions', () => {
    // Entry: 100, StopLoss: 10%
    // Stop: 100 * (1 - 0.1) = 90
    const result = calculateStopLoss('100', 'long', 0.1);
    expect(result).toBe('90.000000');
  });

  it('should calculate stop loss for short positions', () => {
    // Entry: 100, StopLoss: 10%
    // Stop: 100 * (1 + 0.1) = 110
    const result = calculateStopLoss('100', 'short', 0.1);
    expect(result).toBe('110.000000');
  });

  it('should handle small stop loss percentages', () => {
    // Entry: 50000, StopLoss: 0.5%
    // Stop: 50000 * (1 - 0.005) = 49750
    const result = calculateStopLoss('50000', 'long', 0.005);
    expect(result).toBe('49750.000000');
  });

  it('should handle large stop loss percentages', () => {
    // Entry: 1000, StopLoss: 50%
    // Stop: 1000 * (1 - 0.5) = 500
    const result = calculateStopLoss('1000', 'long', 0.5);
    expect(result).toBe('500.000000');
  });

  it('should handle decimal entry prices', () => {
    // Entry: 0.0001, StopLoss: 10%
    // Stop: 0.0001 * (1 - 0.1) = 0.00009
    const result = calculateStopLoss('0.0001', 'long', 0.1);
    expect(result).toBe('0.000090');
  });
});

describe('RiskManager class', () => {
  let riskManager: RiskManager;
  let defaultLimits: RiskLimits;

  beforeEach(() => {
    defaultLimits = {
      maxPositionSize: '10000',
      maxDrawdown: 0.2,
      maxOpenPositions: 5,
      stopLossPercent: 0.1,
      maxLeverage: 2,
    };
    riskManager = new RiskManager(defaultLimits);
  });

  describe('canOpenPosition', () => {
    it('should allow opening a position when under limits', () => {
      const result = riskManager.canOpenPosition('50000', [], '5000');
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject when max open positions reached', () => {
      const positions: Position[] = Array(5).fill({
        marketId: 'test',
        side: 'long',
        entryPrice: '100',
        size: '100',
        unrealizedPnl: '0',
        openedAt: Date.now(),
      });
      const result = riskManager.canOpenPosition('50000', positions, '5000');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Max open positions');
    });

    it('should reject when position size exceeds limit', () => {
      const result = riskManager.canOpenPosition('50000', [], '15000');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Position size exceeds max');
    });

    it('should track peak equity and allow position after new peak', () => {
      // First call with 50000 capital
      riskManager.canOpenPosition('50000', [], '1000');
      // Should have set peakEquity to 50000

      // Second call with 60000 capital (new peak)
      const result = riskManager.canOpenPosition('60000', [], '1000');
      expect(result.allowed).toBe(true);
    });

    it('should reject position when drawdown limit exceeded', () => {
      // First call to establish peak at 50000
      riskManager.canOpenPosition('50000', [], '1000');

      // Second call with significant drawdown (38000 = 24% drawdown, limit is 20%)
      const result = riskManager.canOpenPosition('38000', [], '1000');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Drawdown limit');
    });
  });

  describe('getRecommendedSize', () => {
    it('should return kelly-sized position', () => {
      const size = riskManager.getRecommendedSize('100000', 0.55, 1000, 800);
      expect(parseFloat(size)).toBeGreaterThan(0);
      expect(parseFloat(size)).toBeLessThanOrEqual(10000); // Capped at max position size
    });

    it('should cap at max position size', () => {
      const size = riskManager.getRecommendedSize('1000000', 0.9, 10000, 100);
      expect(parseFloat(size)).toBeLessThanOrEqual(10000);
    });

    it('should return 0 for invalid kelly inputs', () => {
      const size = riskManager.getRecommendedSize('100000', 0, 1000, 800);
      expect(parseFloat(size)).toBe(0);
    });
  });

  describe('createSnapshot', () => {
    it('should create pnl snapshot with correct structure', () => {
      const snapshot = riskManager.createSnapshot('50000', '1000', '500', 10, 6);
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.equity).toBe('50000');
      expect(snapshot.realizedPnl).toBe('1000');
      expect(snapshot.unrealizedPnl).toBe('500');
      expect(snapshot.tradeCount).toBe(10);
      expect(snapshot.winCount).toBe(6);
    });

    it('should calculate drawdown in snapshot', () => {
      // First snapshot at peak
      riskManager.createSnapshot('100000', '0', '0', 0, 0);
      // Second snapshot at drawdown
      const snapshot = riskManager.createSnapshot('80000', '0', '0', 1, 0);
      expect(snapshot.drawdown).toBe(0.2); // 20% drawdown
    });

    it('should update peak equity in snapshot', () => {
      const snap1 = riskManager.createSnapshot('50000', '0', '0', 0, 0);
      const snap2 = riskManager.createSnapshot('60000', '0', '0', 0, 0);
      expect(snap2.peakEquity).toBe('60000');
    });

    it('should return 0 drawdown when no peak set', () => {
      const snapshot = riskManager.createSnapshot('10000', '0', '0', 0, 0);
      expect(snapshot.drawdown).toBe(0);
    });
  });
});
