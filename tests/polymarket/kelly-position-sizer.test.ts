import { describe, it, expect } from 'vitest';
import { KellyPositionSizer } from '../../src/polymarket/kelly-position-sizer.js';
import type { WinTracker } from '../../src/polymarket/win-tracker.js';

/** Minimal mock WinTracker that returns configurable stats */
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

describe('KellyPositionSizer', () => {
  it('should use base size when insufficient trades', () => {
    const tracker = mockWinTracker(3, 2, 0.6);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const result = sizer.getSize('test');
    expect(result.method).toBe('base');
    expect(result.size).toBe(50); // default baseSize
    expect(result.kellyRaw).toBe(0);
  });

  it('should use kelly method when enough trades', () => {
    const trades = [
      ...Array(8).fill({ outcome: 'win', pnl: '20' }),
      ...Array(4).fill({ outcome: 'loss', pnl: '-10' }),
    ];
    const tracker = mockWinTracker(8, 4, 0.667, trades);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const result = sizer.getSize('test');
    expect(result.method).toBe('kelly');
    expect(result.winRate).toBeCloseTo(0.667);
    expect(result.avgWinLossRatio).toBe(2); // 20/10
    expect(result.size).toBeGreaterThan(0);
  });

  it('should clamp size to maxSize', () => {
    const trades = [
      ...Array(15).fill({ outcome: 'win', pnl: '100' }),
      ...Array(1).fill({ outcome: 'loss', pnl: '-1' }),
    ];
    const tracker = mockWinTracker(15, 1, 0.9375, trades);
    const sizer = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      maxSize: 200,
      baseSize: 50,
    });
    const result = sizer.getSize('test');
    expect(result.size).toBeLessThanOrEqual(200);
  });

  it('should clamp size to minSize', () => {
    // Very low win rate → kelly near 0 or negative
    const trades = [
      ...Array(2).fill({ outcome: 'win', pnl: '5' }),
      ...Array(10).fill({ outcome: 'loss', pnl: '-20' }),
    ];
    const tracker = mockWinTracker(2, 10, 0.167, trades);
    const sizer = new KellyPositionSizer(tracker, {
      minTradesForKelly: 10,
      minSize: 10,
    });
    const result = sizer.getSize('test');
    expect(result.size).toBeGreaterThanOrEqual(10);
  });

  it('should accept custom config overrides', () => {
    const tracker = mockWinTracker(0, 0, 0);
    const sizer = new KellyPositionSizer(tracker, {
      baseSize: 100,
      maxSize: 1000,
      minSize: 25,
      kellyFraction: 0.5,
      minTradesForKelly: 20,
    });
    const result = sizer.getSize('test');
    expect(result.size).toBe(100); // base size since 0 trades
  });

  it('should handle equal wins and losses', () => {
    const trades = [
      ...Array(6).fill({ outcome: 'win', pnl: '10' }),
      ...Array(6).fill({ outcome: 'loss', pnl: '-10' }),
    ];
    const tracker = mockWinTracker(6, 6, 0.5, trades);
    const sizer = new KellyPositionSizer(tracker, { minTradesForKelly: 10 });
    const result = sizer.getSize('test');
    expect(result.method).toBe('kelly');
    // b=1, p=0.5, q=0.5 → kelly = (1*0.5 - 0.5)/1 = 0 → adjusted = 0
    expect(result.kellyRaw).toBe(0);
  });
});
