import { describe, it, expect, beforeEach } from 'vitest';
import { KellyPositionSizer } from '../../src/polymarket/kelly-position-sizer.js';
import type { WinTracker } from '../../src/polymarket/win-tracker.js';
import {
  kellyFraction,
  RiskManager,
} from '../../src/core/risk-manager.js';
import type { RiskLimits } from '../../src/core/types.js';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function mockWinTracker(
  wins: number,
  losses: number,
  rollingWinRate: number,
  trades: Array<{ outcome: string; pnl: string | null }> = [],
): WinTracker {
  return {
    getWinRate: () => ({
      totalTrades: wins + losses,
      wins,
      losses,
      pending: 0,
      winRate: wins / (wins + losses || 1),
      rollingWinRate,
    }),
    getTradeHistory: () =>
      trades.map((t, i) => ({
        orderId: `o-${i}`,
        strategy: 'test',
        market: 'MKT-1',
        side: 'buy',
        price: '0.50',
        size: '100',
        pnl: t.pnl,
        outcome: t.outcome as any,
        timestamp: Date.now(),
      })),
  } as unknown as WinTracker;
}

function defaultLimits(overrides: Partial<RiskLimits> = {}): RiskLimits {
  return {
    maxPositionSize: '1000',
    maxDrawdown: 0.20,
    maxOpenPositions: 5,
    stopLossPercent: 0.10,
    maxLeverage: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Half-Kelly math via kellyFraction()
//    Formula in risk-manager.ts: kelly = (b*p - q) / b  then * 0.5, capped 0.25
// ---------------------------------------------------------------------------

describe('kellyFraction – half-Kelly calculation', () => {
  it('50% win rate, 2:1 odds -> half-Kelly = 0.125', () => {
    // b=2, p=0.5, q=0.5 -> raw = (2*0.5-0.5)/2 = 0.25 -> *0.5 = 0.125
    const f = kellyFraction(0.5, 100, 50);
    expect(f).toBeCloseTo(0.125, 4);
  });

  it('60% win rate, 1.5:1 odds', () => {
    // b=1.5, p=0.6, q=0.4 -> raw = (1.5*0.6-0.4)/1.5 = 0.3333 -> *0.5 = 0.1667
    const f = kellyFraction(0.6, 150, 100);
    expect(f).toBeCloseTo(0.1667, 3);
  });

  it('70% win rate, 1:1 odds', () => {
    // b=1, p=0.7, q=0.3 -> raw = (0.7-0.3)/1 = 0.4 -> *0.5 = 0.2
    const f = kellyFraction(0.7, 100, 100);
    expect(f).toBeCloseTo(0.2, 4);
  });

  it('90% win rate, 10:1 odds -> capped at 0.25', () => {
    // raw kelly would be very high; half-Kelly capped at 0.25
    const f = kellyFraction(0.9, 1000, 100);
    expect(f).toBe(0.25);
  });

  it('40% win rate, 1:1 odds -> negative kelly clamped to 0', () => {
    // b=1, p=0.4, q=0.6 -> raw = (0.4-0.6)/1 = -0.2 -> clamped 0
    const f = kellyFraction(0.4, 100, 100);
    expect(f).toBe(0);
  });

  it('50% win rate, 1:1 odds -> raw = 0 -> returns 0', () => {
    const f = kellyFraction(0.5, 100, 100);
    expect(f).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Edge cases for kellyFraction
// ---------------------------------------------------------------------------

describe('kellyFraction – edge cases', () => {
  it('edge = 0 (winRate = 0) -> returns 0', () => {
    expect(kellyFraction(0, 100, 50)).toBe(0);
  });

  it('edge < 0 (winRate very low) -> returns 0', () => {
    expect(kellyFraction(0.1, 50, 200)).toBe(0);
  });

  it('edge > 50% (winRate = 1) -> returns 0 (boundary guard)', () => {
    // winRate >= 1 is rejected by the guard clause
    expect(kellyFraction(1, 100, 50)).toBe(0);
  });

  it('avgLoss = 0 -> returns 0', () => {
    expect(kellyFraction(0.6, 100, 0)).toBe(0);
  });

  it('winRate just above 0 -> small positive or 0', () => {
    const f = kellyFraction(0.01, 100, 100);
    expect(f).toBe(0); // raw kelly negative at 1% win rate with 1:1
  });

  it('winRate = 0.99 -> capped at 0.25', () => {
    const f = kellyFraction(0.99, 100, 50);
    expect(f).toBeLessThanOrEqual(0.25);
    expect(f).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 3. KellyPositionSizer.getSize() with mocked WinTracker
// ---------------------------------------------------------------------------

describe('KellyPositionSizer.getSize()', () => {
  it('returns base method when trade count < minTradesForKelly', () => {
    const tracker = mockWinTracker(3, 2, 0.6);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const r = sizer.getSize('test');
    expect(r.method).toBe('base');
    expect(r.size).toBe(50);
    expect(r.kellyRaw).toBe(0);
    expect(r.kellyAdjusted).toBe(0);
  });

  it('returns kelly method when enough resolved trades', () => {
    const trades = [
      ...Array(8).fill({ outcome: 'win', pnl: '20' }),
      ...Array(4).fill({ outcome: 'loss', pnl: '-10' }),
    ];
    const tracker = mockWinTracker(8, 4, 0.667, trades);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const r = sizer.getSize('test');
    expect(r.method).toBe('kelly');
    expect(r.avgWinLossRatio).toBe(2);
    expect(r.kellyRaw).toBeGreaterThan(0);
    expect(r.size).toBeGreaterThan(0);
  });

  it('clamps size to maxSize (position cap)', () => {
    const trades = [
      ...Array(15).fill({ outcome: 'win', pnl: '500' }),
      ...Array(1).fill({ outcome: 'loss', pnl: '-1' }),
    ];
    const tracker = mockWinTracker(15, 1, 0.9375, trades);
    const sizer = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      maxSize: 200,
      baseSize: 50,
    });
    const r = sizer.getSize('test');
    expect(r.size).toBeLessThanOrEqual(200);
  });

  it('clamps size to minSize for losing strategies', () => {
    const trades = [
      ...Array(2).fill({ outcome: 'win', pnl: '5' }),
      ...Array(10).fill({ outcome: 'loss', pnl: '-20' }),
    ];
    const tracker = mockWinTracker(2, 10, 0.167, trades);
    const sizer = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      minSize: 10,
    });
    const r = sizer.getSize('test');
    expect(r.size).toBeGreaterThanOrEqual(10);
  });

  it('handles 50/50 win rate with equal pnl -> kelly = 0, size = baseSize', () => {
    const trades = [
      ...Array(6).fill({ outcome: 'win', pnl: '10' }),
      ...Array(6).fill({ outcome: 'loss', pnl: '-10' }),
    ];
    const tracker = mockWinTracker(6, 6, 0.5, trades);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const r = sizer.getSize('test');
    expect(r.kellyRaw).toBe(0);
    expect(r.kellyAdjusted).toBe(0);
    expect(r.size).toBe(50); // baseSize * (1 + 0) = baseSize
  });

  it('handles all-win history', () => {
    const trades = Array(12).fill({ outcome: 'win', pnl: '50' });
    const tracker = mockWinTracker(12, 0, 1.0, trades);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const r = sizer.getSize('test');
    expect(r.method).toBe('kelly');
    // avgLoss defaults to 1 when no losses -> b = 50/1 = 50
    // raw kelly = (50*1 - 0)/50 = 1.0
    expect(r.kellyRaw).toBe(1);
    expect(r.size).toBeGreaterThan(0);
  });

  it('handles all-loss history -> kellyAdjusted = 0', () => {
    const trades = Array(12).fill({ outcome: 'loss', pnl: '-30' });
    const tracker = mockWinTracker(0, 12, 0.0, trades);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const r = sizer.getSize('test');
    // p=0 -> raw = (b*0 - 1)/b = -1/b < 0 -> clamped to 0
    expect(r.kellyAdjusted).toBe(0);
  });

  it('respects custom kellyFraction config', () => {
    const trades = [
      ...Array(8).fill({ outcome: 'win', pnl: '20' }),
      ...Array(4).fill({ outcome: 'loss', pnl: '-10' }),
    ];
    const tracker = mockWinTracker(8, 4, 0.667, trades);
    const half = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      kellyFraction: 0.5,
    });
    const quarter = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      kellyFraction: 0.25,
    });
    const rHalf = half.getSize('test');
    const rQuarter = quarter.getSize('test');
    // Half-Kelly adjusted should be roughly 2x the quarter-Kelly adjusted
    expect(rHalf.kellyAdjusted).toBeGreaterThan(rQuarter.kellyAdjusted);
  });
});

// ---------------------------------------------------------------------------
// 4. Position cap at 10% of capital
//    NOTE: KellyPositionSizer caps via absolute maxSize, not % of capital.
//    RiskManager.canOpenPosition() uses maxPositionSize (also absolute).
//    Neither enforces a 10%-of-capital rule directly.
//    The test below validates that maxPositionSize = 10% * capital achieves
//    the desired cap when configured that way.
// ---------------------------------------------------------------------------

describe('Position cap at 10% of capital (via RiskManager)', () => {
  it('rejects position exceeding maxPositionSize', () => {
    const capital = '10000';
    const tenPercent = (parseFloat(capital) * 0.10).toFixed(2); // 1000
    const rm = new RiskManager(defaultLimits({ maxPositionSize: tenPercent }));
    const result = rm.canOpenPosition(capital, [], '1500');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('exceeds max');
  });

  it('allows position within 10% cap', () => {
    const capital = '10000';
    const rm = new RiskManager(defaultLimits({ maxPositionSize: '1000' }));
    const result = rm.canOpenPosition(capital, [], '800');
    expect(result.allowed).toBe(true);
  });

  it('allows position exactly at 10% cap', () => {
    const capital = '10000';
    const rm = new RiskManager(defaultLimits({ maxPositionSize: '1000' }));
    const result = rm.canOpenPosition(capital, [], '1000');
    expect(result.allowed).toBe(true);
  });

  it('KellyPositionSizer maxSize enforces absolute cap', () => {
    const trades = Array(15).fill({ outcome: 'win', pnl: '1000' });
    const tracker = mockWinTracker(15, 0, 1.0, trades);
    const maxSize = 1000; // equivalent to 10% of $10,000 capital
    const sizer = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      maxSize,
      baseSize: 100,
    });
    const r = sizer.getSize('test');
    expect(r.size).toBeLessThanOrEqual(maxSize);
  });
});

// ---------------------------------------------------------------------------
// 5. Daily loss limit (5% of capital)
//    NOT IMPLEMENTED in RiskManager. The RiskManager has drawdown-based limits
//    (maxDrawdown) but no daily P&L tracking or daily loss limit.
// ---------------------------------------------------------------------------

describe('Daily loss limit – 5% of capital (NOT YET IMPLEMENTED)', () => {
  it('maxDrawdown limit blocks trades when drawdown exceeded', () => {
    // This tests the closest existing mechanism: drawdown-based blocking.
    // A proper daily loss limit (5% intraday) does not exist in RiskManager.
    const rm = new RiskManager(defaultLimits({ maxDrawdown: 0.05 }));

    // Simulate: peak equity was 10000, current is 9400 (6% drawdown > 5%)
    // First call sets peak equity
    rm.canOpenPosition('10000', [], '100');
    // Now equity dropped to 9400
    const result = rm.canOpenPosition('9400', [], '100');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Drawdown limit');
  });

  it('allows trade when drawdown is within limit', () => {
    const rm = new RiskManager(defaultLimits({ maxDrawdown: 0.05 }));
    rm.canOpenPosition('10000', [], '100'); // sets peak
    const result = rm.canOpenPosition('9600', [], '100'); // 4% drawdown < 5%
    expect(result.allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. Circuit breaker on 3 consecutive losses
//    NOT IMPLEMENTED in RiskManager for trade-level circuit breaking.
//    The CircuitBreaker in the codebase (src/resilience/) is for HTTP calls,
//    not for blocking trading after consecutive losses.
// ---------------------------------------------------------------------------

describe('Circuit breaker on consecutive losses', () => {
  it('RiskManager blocks on max open positions', () => {
    const rm = new RiskManager(defaultLimits({ maxOpenPositions: 3 }));
    const positions = [
      { id: '1' }, { id: '2' }, { id: '3' },
    ] as any;
    const result = rm.canOpenPosition('10000', positions, '100');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Max open positions');
  });

  it('trips circuit breaker after 3 consecutive losses', () => {
    const rm = new RiskManager(defaultLimits());
    rm.recordTradeResult(false);
    rm.recordTradeResult(false);
    expect(rm.isCircuitBreakerActive()).toBe(false);
    rm.recordTradeResult(false); // 3rd loss
    expect(rm.isCircuitBreakerActive()).toBe(true);
  });

  it('resets consecutive losses on win', () => {
    const rm = new RiskManager(defaultLimits());
    rm.recordTradeResult(false);
    rm.recordTradeResult(false);
    rm.recordTradeResult(true); // resets
    rm.recordTradeResult(false);
    expect(rm.isCircuitBreakerActive()).toBe(false);
  });

  it('checkTrade blocks when circuit breaker is active', () => {
    const rm = new RiskManager(defaultLimits());
    rm.recordTradeResult(false);
    rm.recordTradeResult(false);
    rm.recordTradeResult(false);
    const result = rm.checkTrade('10000', [], '100');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Circuit breaker');
  });

  it('manual reset clears circuit breaker', () => {
    const rm = new RiskManager(defaultLimits());
    rm.recordTradeResult(false);
    rm.recordTradeResult(false);
    rm.recordTradeResult(false);
    expect(rm.isCircuitBreakerActive()).toBe(true);
    rm.resetCircuitBreaker();
    expect(rm.isCircuitBreakerActive()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. RiskManager.checkTrade() called before every execution
//    NOTE: No checkTrade() method exists. The equivalent is canOpenPosition().
// ---------------------------------------------------------------------------

describe('RiskManager.canOpenPosition() – pre-trade validation', () => {
  it('rejects when max open positions reached', () => {
    const rm = new RiskManager(defaultLimits({ maxOpenPositions: 2 }));
    const positions = [{ id: '1' }, { id: '2' }] as any;
    const result = rm.canOpenPosition('10000', positions, '100');
    expect(result.allowed).toBe(false);
  });

  it('rejects when proposed size exceeds max', () => {
    const rm = new RiskManager(defaultLimits({ maxPositionSize: '500' }));
    const result = rm.canOpenPosition('10000', [], '600');
    expect(result.allowed).toBe(false);
  });

  it('rejects when drawdown limit breached', () => {
    const rm = new RiskManager(defaultLimits({ maxDrawdown: 0.10 }));
    rm.canOpenPosition('10000', [], '100'); // sets peak
    const result = rm.canOpenPosition('8900', [], '100'); // 11% drawdown
    expect(result.allowed).toBe(false);
  });

  it('allows valid trade that passes all checks', () => {
    const rm = new RiskManager(defaultLimits());
    const result = rm.canOpenPosition('10000', [], '500');
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it('checkTrade() validates all checks combined', () => {
    const rm = new RiskManager(defaultLimits());
    const result = rm.checkTrade('10000', [], '500');
    expect(result.allowed).toBe(true);
    expect(typeof rm.checkTrade).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// 8. RiskManager.getRecommendedSize() – Kelly via RiskManager
// ---------------------------------------------------------------------------

describe('RiskManager.getRecommendedSize()', () => {
  it('returns half-Kelly sized position', () => {
    const rm = new RiskManager(defaultLimits({ maxPositionSize: '10000' }));
    const size = rm.getRecommendedSize('10000', 0.6, 150, 100);
    // kelly = 0.1667, capital*kelly = 1666.67, capped at maxPositionSize
    const expected = 10000 * kellyFraction(0.6, 150, 100);
    expect(parseFloat(size)).toBeCloseTo(expected, 0);
  });

  it('caps recommended size at maxPositionSize', () => {
    const rm = new RiskManager(defaultLimits({ maxPositionSize: '200' }));
    const size = rm.getRecommendedSize('100000', 0.8, 200, 100);
    expect(parseFloat(size)).toBeLessThanOrEqual(200);
  });

  it('returns 0 for losing strategy', () => {
    const rm = new RiskManager(defaultLimits());
    const size = rm.getRecommendedSize('10000', 0.2, 50, 200);
    expect(parseFloat(size)).toBe(0);
  });
});
