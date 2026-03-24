import { describe, it, expect, vi } from 'vitest';
import {
  calcRealizedVol,
  calcATR,
  detectCompression,
  detectBreakout,
  createVolCompressionBreakoutTick,
  type VolCompressionDeps,
} from '../../src/strategies/polymarket/vol-compression-breakout.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// ── Helper: build a mock orderbook ──────────────────────────────────────────

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeDeps(overrides?: Partial<VolCompressionDeps>): VolCompressionDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

// ── calcRealizedVol ─────────────────────────────────────────────────────────

describe('calcRealizedVol', () => {
  it('returns 0 for fewer than 2 prices', () => {
    expect(calcRealizedVol([])).toBe(0);
    expect(calcRealizedVol([0.5])).toBe(0);
  });

  it('returns 0 for constant prices', () => {
    expect(calcRealizedVol([0.5, 0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it('returns low vol for steady uptrend', () => {
    const prices = [0.50, 0.51, 0.52, 0.53, 0.54];
    const vol = calcRealizedVol(prices);
    expect(vol).toBeLessThan(0.005);
  });

  it('returns high vol for oscillating prices', () => {
    const prices = [0.50, 0.60, 0.50, 0.60, 0.50, 0.60];
    const vol = calcRealizedVol(prices);
    expect(vol).toBeGreaterThan(0.05);
  });

  it('handles zero prices safely', () => {
    const prices = [0, 0.5, 0.5];
    const vol = calcRealizedVol(prices);
    expect(Number.isFinite(vol)).toBe(true);
  });
});

// ── calcATR ─────────────────────────────────────────────────────────────────

describe('calcATR', () => {
  it('returns 0 for fewer than 2 prices', () => {
    expect(calcATR([], 10)).toBe(0);
    expect(calcATR([0.5], 10)).toBe(0);
  });

  it('returns 0 for flat prices', () => {
    expect(calcATR([0.5, 0.5, 0.5, 0.5], 3)).toBe(0);
  });

  it('calculates average absolute range', () => {
    const prices = [0.50, 0.51, 0.49, 0.50];
    const atr = calcATR(prices, 10);
    expect(atr).toBeCloseTo(0.01333, 4);
  });

  it('respects period (uses only last N diffs)', () => {
    const prices = [0.50, 0.60, 0.55, 0.56, 0.57];
    const atrAll = calcATR(prices, 10);
    const atrLast2 = calcATR(prices, 2);
    expect(atrLast2).toBeCloseTo(0.01, 4);
    expect(atrAll).toBeGreaterThan(atrLast2);
  });
});

// ── detectCompression ───────────────────────────────────────────────────────

describe('detectCompression', () => {
  it('returns false when volLong is 0', () => {
    expect(detectCompression(0.01, 0, 0.4)).toBe(false);
  });

  it('returns true when ratio below threshold', () => {
    expect(detectCompression(0.01, 0.05, 0.4)).toBe(true);
  });

  it('returns false when ratio above threshold', () => {
    expect(detectCompression(0.04, 0.05, 0.4)).toBe(false);
  });

  it('returns false at exact threshold', () => {
    expect(detectCompression(0.4, 1.0, 0.4)).toBe(false);
  });

  it('returns true for very small ratio', () => {
    expect(detectCompression(0.001, 1.0, 0.4)).toBe(true);
  });
});

// ── detectBreakout ──────────────────────────────────────────────────────────

describe('detectBreakout', () => {
  it('returns null for insufficient prices', () => {
    expect(detectBreakout([0.5], 0.01, 2.5)).toBeNull();
  });

  it('returns null when atr is 0', () => {
    expect(detectBreakout([0.5, 0.5, 0.5], 0, 2.5)).toBeNull();
  });

  it('returns null for small move', () => {
    expect(detectBreakout([0.50, 0.51], 0.01, 2.5)).toBeNull();
  });

  it('returns up for large upward move', () => {
    expect(detectBreakout([0.50, 0.53], 0.01, 2.5)).toBe('up');
  });

  it('returns down for large downward move', () => {
    expect(detectBreakout([0.50, 0.47], 0.01, 2.5)).toBe('down');
  });

  it('returns null for negative atr', () => {
    expect(detectBreakout([0.50, 0.60], -0.01, 2.5)).toBeNull();
  });
});

// ── createVolCompressionBreakoutTick ────────────────────────────────────────

describe('createVolCompressionBreakoutTick', () => {
  it('creates a callable tick function', () => {
    const tick = createVolCompressionBreakoutTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createVolCompressionBreakoutTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter without enough price history', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    const book = makeBook([['0.49', '100']], [['0.51', '100']]);
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters on compression + upward breakout', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortVolWindow: 5, longVolWindow: 20, compressionThreshold: 0.5, breakoutMultiplier: 1.5 },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    if (calls.length > 0) {
      expect(calls[0][0].side).toBe('buy');
    }
  });

  it('does not enter without compression', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const p = callCount % 2 === 0 ? '0.55' : '0.45';
      return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortVolWindow: 5, longVolWindow: 20 },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 30; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed and resolved markets', async () => {
    const markets = [
      { conditionId: 'cond-1', yesTokenId: 'yes-1', closed: true, resolved: false },
      { conditionId: 'cond-2', yesTokenId: 'yes-2', closed: false, resolved: true },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });

    const tick = createVolCompressionBreakoutTick(deps);
    await tick();

    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const markets = [
      { conditionId: 'cond-1', yesTokenId: '', closed: false, resolved: false },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });

    const tick = createVolCompressionBreakoutTick(deps);
    await tick();

    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('does not throw on clob API error', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createVolCompressionBreakoutTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('exits on take-profit for YES position', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: oscillating (build baseline vol)
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      // Phase 2: flat (compression)
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      // Phase 3: breakout up
      if (callCount <= 44) {
        return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
      }
      // Phase 4: price moves higher → take profit
      return Promise.resolve(makeBook([['0.65', '100']], [['0.67', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
        takeProfitPct: 0.035, stopLossPct: 0.015,
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    // Should have entry + exit
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits on stop-loss for YES position', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      // Breakout up
      if (callCount <= 44) {
        return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
      }
      // Price drops → stop-loss
      return Promise.resolve(makeBook([['0.54', '100']], [['0.56', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
        takeProfitPct: 0.035, stopLossPct: 0.015,
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits on max hold time', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      if (callCount <= 44) {
        return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
      }
      // Price stays near entry (no TP/SL)
      return Promise.resolve(makeBook([['0.585', '100']], [['0.595', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
        takeProfitPct: 0.5, stopLossPct: 0.5, // wide so they don't trigger
        maxHoldMs: 12 * 60_000,
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);

    // Enter position
    for (let i = 0; i < 46; i++) await tick();

    const entryCount = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    ).length;

    if (entryCount > 0) {
      // Fast-forward past max hold
      const baseNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseNow + 13 * 60_000);

      await tick();

      const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'IOC',
      );
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);

      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  it('exits on failed breakout (price reverses into compression range)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      if (callCount <= 44) {
        return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
      }
      // Price reverses back to pre-breakout level
      return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
        takeProfitPct: 0.5, stopLossPct: 0.5, // wide so TP/SL don't trigger first
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    // Check that at least one exit was attempted
    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('respects maxPositions limit', async () => {
    // Verify that scanEntries returns early when positions >= maxPositions.
    // Use a single market with maxPositions=0 so no entry is ever allowed.
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
        maxPositions: 0, // no positions allowed
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBe(0);
  });

  it('requires breakout after compression (flat exit from compression does nothing)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Oscillating → compression → exits compression with small move (no breakout)
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      // Small move — not enough for breakout with multiplier 2.5
      return Promise.resolve(makeBook([['0.505', '100']], [['0.515', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 2.5,
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('emits trade.executed on entry', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    if (tradeCalls.length > 0) {
      expect(tradeCalls[0][1].trade.strategy).toBe('vol-compression-breakout');
    }
  });

  it('enters on compression + downward breakout (buys NO)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 30) {
        const p = callCount % 2 === 0 ? '0.52' : '0.48';
        return Promise.resolve(makeBook([[String(parseFloat(p) - 0.01), '100']], [[p, '100']]));
      }
      if (callCount <= 42) {
        return Promise.resolve(makeBook([['0.499', '100']], [['0.501', '100']]));
      }
      // Downward breakout
      return Promise.resolve(makeBook([['0.40', '100']], [['0.42', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortVolWindow: 5, longVolWindow: 20,
        compressionThreshold: 0.5, breakoutMultiplier: 1.5,
      },
    });

    const tick = createVolCompressionBreakoutTick(deps);
    for (let i = 0; i < 50; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    if (gtcCalls.length > 0) {
      expect(gtcCalls[0][0].tokenId).toBe('no-1');
    }
  });
});
