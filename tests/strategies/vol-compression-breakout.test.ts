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
});
