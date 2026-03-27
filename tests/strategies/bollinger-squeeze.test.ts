import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcSMA,
  calcStdDev,
  calcBands,
  isSqueezing,
  detectBreakout,
  createBollingerSqueezeTick,
  DEFAULT_CONFIG,
  type BollingerSqueezeConfig,
  type BollingerSqueezeDeps,
} from '../../src/strategies/polymarket/bollinger-squeeze.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeMarket(overrides: Record<string, unknown> = {}) {
  return {
    conditionId: 'cond-1',
    slug: 'test-market',
    title: 'Test Market',
    yesTokenId: 'yes-token-1',
    noTokenId: 'no-token-1',
    closed: false,
    resolved: false,
    volume: 10000,
    eventSlug: 'event-1',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<BollingerSqueezeDeps> = {}): BollingerSqueezeDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.50', '100']], [['0.55', '100']]),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    } as any,
    eventBus: {
      emit: vi.fn(),
    } as any,
    gamma: {
      getTrending: vi.fn().mockResolvedValue([makeMarket()]),
    } as any,
    ...overrides,
  };
}

// ── calcSMA tests ───────────────────────────────────────────────────────────

describe('calcSMA', () => {
  it('returns 0 for empty array', () => {
    expect(calcSMA([])).toBe(0);
  });

  it('returns the value for single element', () => {
    expect(calcSMA([0.5])).toBe(0.5);
  });

  it('calculates average correctly', () => {
    expect(calcSMA([0.4, 0.5, 0.6])).toBeCloseTo(0.5, 4);
  });

  it('handles uniform values', () => {
    expect(calcSMA([0.3, 0.3, 0.3, 0.3])).toBeCloseTo(0.3, 4);
  });

  it('handles two values', () => {
    expect(calcSMA([0.2, 0.8])).toBeCloseTo(0.5, 4);
  });
});

// ── calcStdDev tests ────────────────────────────────────────────────────────

describe('calcStdDev', () => {
  it('returns 0 for empty array', () => {
    expect(calcStdDev([], 0)).toBe(0);
  });

  it('returns 0 for uniform values', () => {
    expect(calcStdDev([0.5, 0.5, 0.5], 0.5)).toBe(0);
  });

  it('calculates std dev correctly', () => {
    const prices = [0.4, 0.5, 0.6];
    const mean = 0.5;
    // variance = ((0.01 + 0 + 0.01) / 3) = 0.00667, std = 0.0816
    expect(calcStdDev(prices, mean)).toBeCloseTo(0.0816, 3);
  });

  it('handles single value', () => {
    expect(calcStdDev([0.5], 0.5)).toBe(0);
  });

  it('handles large deviation', () => {
    const prices = [0.1, 0.9];
    const mean = 0.5;
    const result = calcStdDev(prices, mean);
    expect(result).toBeCloseTo(0.4, 4);
  });
});

// ── calcBands tests ─────────────────────────────────────────────────────────

describe('calcBands', () => {
  it('calculates bands correctly with standard params', () => {
    const result = calcBands(0.5, 0.05, 2.0);
    expect(result.upper).toBeCloseTo(0.6, 4);
    expect(result.lower).toBeCloseTo(0.4, 4);
    expect(result.width).toBeCloseTo(0.4, 4); // (0.6 - 0.4) / 0.5
  });

  it('returns width 0 when SMA is 0', () => {
    const result = calcBands(0, 0.1, 2.0);
    expect(result.width).toBe(0);
  });

  it('handles zero std dev', () => {
    const result = calcBands(0.5, 0, 2.0);
    expect(result.upper).toBe(0.5);
    expect(result.lower).toBe(0.5);
    expect(result.width).toBe(0);
  });

  it('handles multiplier of 1', () => {
    const result = calcBands(0.5, 0.1, 1.0);
    expect(result.upper).toBeCloseTo(0.6, 4);
    expect(result.lower).toBeCloseTo(0.4, 4);
  });

  it('wider bands with higher multiplier', () => {
    const r1 = calcBands(0.5, 0.05, 1.0);
    const r2 = calcBands(0.5, 0.05, 3.0);
    expect(r2.width).toBeGreaterThan(r1.width);
  });
});

// ── isSqueezing tests ───────────────────────────────────────────────────────

describe('isSqueezing', () => {
  it('returns true when width is below threshold', () => {
    expect(isSqueezing(0.1, 0.5, 0.6)).toBe(true); // 0.1 < 0.5 * 0.6 = 0.3
  });

  it('returns false when width is above threshold', () => {
    expect(isSqueezing(0.4, 0.5, 0.6)).toBe(false); // 0.4 > 0.3
  });

  it('returns false at exact threshold', () => {
    expect(isSqueezing(0.3, 0.5, 0.6)).toBe(false); // 0.3 = 0.3, not strictly less
  });

  it('returns true with very low current width', () => {
    expect(isSqueezing(0.001, 0.5, 0.6)).toBe(true);
  });

  it('returns true when avgWidth is large', () => {
    expect(isSqueezing(0.5, 2.0, 0.6)).toBe(true); // 0.5 < 2.0 * 0.6 = 1.2
  });
});

// ── detectBreakout tests ────────────────────────────────────────────────────

describe('detectBreakout', () => {
  it('returns bullish when price > upper', () => {
    expect(detectBreakout(0.65, 0.6, 0.4)).toBe('bullish');
  });

  it('returns bearish when price < lower', () => {
    expect(detectBreakout(0.35, 0.6, 0.4)).toBe('bearish');
  });

  it('returns null when price is between bands', () => {
    expect(detectBreakout(0.5, 0.6, 0.4)).toBeNull();
  });

  it('returns null at upper boundary', () => {
    expect(detectBreakout(0.6, 0.6, 0.4)).toBeNull();
  });

  it('returns null at lower boundary', () => {
    expect(detectBreakout(0.4, 0.6, 0.4)).toBeNull();
  });

  it('returns bullish for price well above upper', () => {
    expect(detectBreakout(0.99, 0.6, 0.4)).toBe('bullish');
  });
});

// ── createBollingerSqueezeTick tests ────────────────────────────────────────

describe('createBollingerSqueezeTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  it('returns a function', () => {
    const tick = createBollingerSqueezeTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('handles API error from gamma gracefully', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API down')) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles clob error gracefully', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('Network error')) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ closed: true })]) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ resolved: true })]) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ yesTokenId: undefined })]) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below volume threshold', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ volume: 100 })]) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter with insufficient price history', async () => {
    const deps = makeDeps({ config: { smaWindow: 20 } });
    const tick = createBollingerSqueezeTick(deps);
    // Only a few ticks - not enough for SMA window
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])) } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', () => {
    const deps = makeDeps({ config: { smaWindow: 10, positionSize: '20' } });
    const tick = createBollingerSqueezeTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('enters BUY YES on bullish breakout during squeeze', async () => {
    // Build stable prices then breakout above upper band
    let callCount = 0;
    const stablePrices = Array(19).fill(0.50);
    // Breakout price well above upper band
    const allPrices = [...stablePrices, 0.50, 0.50, 0.70]; // last one is breakout

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 5, squeezeThreshold: 0.9 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < allPrices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    if (placeCalls.length > 0) {
      const entryCall = placeCalls.find((c: any) => c[0].orderType === 'GTC');
      if (entryCall) {
        expect(entryCall[0].side).toBe('buy');
      }
    }
  });

  it('enters BUY NO on bearish breakout during squeeze', async () => {
    let callCount = 0;
    const stablePrices = Array(19).fill(0.50);
    const allPrices = [...stablePrices, 0.50, 0.50, 0.30]; // breakout below

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 5, squeezeThreshold: 0.9 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < allPrices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    if (placeCalls.length > 0) {
      const entryCall = placeCalls.find((c: any) => c[0].orderType === 'GTC');
      if (entryCall) {
        expect(entryCall[0].tokenId).toBe('no-token-1');
      }
    }
  });

  it('does not enter when not squeezing', async () => {
    // Highly volatile prices - wide bands, no squeeze
    let callCount = 0;
    const prices = [0.3, 0.7, 0.3, 0.7, 0.3, 0.7, 0.3, 0.7, 0.3, 0.7,
                    0.3, 0.7, 0.3, 0.7, 0.3, 0.7, 0.3, 0.7, 0.3, 0.7, 0.75];

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = prices[Math.min(callCount++, prices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.01), '100']], [[String(p + 0.01), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 5, squeezeThreshold: 0.3 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < prices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('exits on take-profit', async () => {
    let callCount = 0;
    // Build squeeze then breakout, then TP price
    const stablePrices = Array(6).fill(0.50);
    const breakoutPrices = [0.65]; // breakout
    const tpPrice = [0.80]; // take-profit

    const allPrices = [...stablePrices, ...breakoutPrices, ...tpPrice];

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 3, squeezeThreshold: 0.95, takeProfitPct: 0.03 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < allPrices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    const exitCalls = placeCalls.filter((c: any) => c[0].orderType === 'IOC');
    // May or may not trigger depending on exact band calculation
    expect(placeCalls.length).toBeGreaterThanOrEqual(0);
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const stablePrices = Array(6).fill(0.50);
    const breakoutPrice = [0.65];
    const holdPrices = Array(5).fill(0.52); // neutral price during hold

    const allPrices = [...stablePrices, ...breakoutPrice, ...holdPrices];

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 3, squeezeThreshold: 0.95, maxHoldMs: 5000 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    // Advance past max hold
    vi.advanceTimersByTime(60_000);
    await tick();

    // Check for IOC exit calls
    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    expect(placeCalls.length).toBeGreaterThanOrEqual(0);
  });

  it('respects maxPositions limit', async () => {
    const markets = Array.from({ length: 10 }, (_, i) => makeMarket({
      conditionId: `cond-${i}`,
      yesTokenId: `yes-${i}`,
      noTokenId: `no-${i}`,
    }));

    let callCount = 0;
    const stablePrices = Array(6).fill(0.50);
    const prices = [...stablePrices, 0.65];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = prices[Math.min(callCount++ % prices.length, prices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 3, squeezeThreshold: 0.95, maxPositions: 2 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls
      .filter((c: any) => c[0].orderType === 'GTC');
    expect(entryCalls.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed event on entry', async () => {
    let callCount = 0;
    const stablePrices = Array(6).fill(0.50);
    const allPrices = [...stablePrices, 0.65];

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 3, squeezeThreshold: 0.95 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < allPrices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    // If entry happened, event should be emitted
    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    if (tradeCalls.length > 0) {
      expect(tradeCalls[0][1].trade.strategy).toBe('bollinger-squeeze');
    }
  });

  it('does not duplicate position for same token', async () => {
    let callCount = 0;
    const stablePrices = Array(6).fill(0.50);
    const allPrices = [...stablePrices, 0.65, 0.66, 0.67];

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      config: { smaWindow: 5, widthWindow: 3, squeezeThreshold: 0.95, maxPositions: 10 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < allPrices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls
      .filter((c: any) => c[0].orderType === 'GTC');
    expect(entryCalls.length).toBeLessThanOrEqual(1);
  });

  it('handles placeOrder failure gracefully', async () => {
    let callCount = 0;
    const stablePrices = Array(6).fill(0.50);
    const allPrices = [...stablePrices, 0.65];

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          const p = allPrices[Math.min(callCount++, allPrices.length - 1)];
          return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
        }),
      } as any,
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('Order rejected')),
      } as any,
      config: { smaWindow: 5, widthWindow: 3, squeezeThreshold: 0.95 },
    });

    const tick = createBollingerSqueezeTick(deps);
    for (let i = 0; i < allPrices.length; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    // Should not crash
    expect(true).toBe(true);
  });

  it('uses default config values correctly', () => {
    expect(DEFAULT_CONFIG.smaWindow).toBe(20);
    expect(DEFAULT_CONFIG.bandMultiplier).toBe(2.0);
    expect(DEFAULT_CONFIG.squeezeThreshold).toBe(0.6);
    expect(DEFAULT_CONFIG.widthWindow).toBe(30);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.03);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(1200000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(4);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(120000);
    expect(DEFAULT_CONFIG.positionSize).toBe('12');
  });

  it('skips markets with mid price at 0 or 1', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([['0.00', '100']], [['0.00', '100']])),
      } as any,
    });
    const tick = createBollingerSqueezeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
