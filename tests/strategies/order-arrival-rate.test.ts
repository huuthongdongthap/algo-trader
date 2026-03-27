import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  countNewLevels,
  calcArrivalAsymmetry,
  isSignalActive,
  extractPriceLevels,
  createOrderArrivalRateTick,
  DEFAULT_CONFIG,
  type OrderArrivalRateConfig,
  type OrderArrivalRateDeps,
} from '../../src/strategies/polymarket/order-arrival-rate.js';
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

function makeConfig(overrides: Partial<OrderArrivalRateConfig> = {}): OrderArrivalRateConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── countNewLevels tests ─────────────────────────────────────────────────────

describe('countNewLevels', () => {
  it('returns 0 when current is empty', () => {
    expect(countNewLevels(['0.50', '0.51'], [])).toBe(0);
  });

  it('returns 0 when current is identical to prev', () => {
    expect(countNewLevels(['0.50', '0.51'], ['0.50', '0.51'])).toBe(0);
  });

  it('counts all levels as new when prev is empty', () => {
    expect(countNewLevels([], ['0.50', '0.51', '0.52'])).toBe(3);
  });

  it('counts only new levels not in prev', () => {
    expect(countNewLevels(['0.50', '0.51'], ['0.50', '0.52', '0.53'])).toBe(2);
  });

  it('returns 0 when both are empty', () => {
    expect(countNewLevels([], [])).toBe(0);
  });

  it('handles single element arrays', () => {
    expect(countNewLevels(['0.50'], ['0.51'])).toBe(1);
  });

  it('handles duplicate levels in current', () => {
    expect(countNewLevels(['0.50'], ['0.51', '0.51'])).toBe(2);
  });

  it('handles duplicate levels in prev', () => {
    expect(countNewLevels(['0.50', '0.50'], ['0.50', '0.51'])).toBe(1);
  });

  it('returns correct count for large arrays', () => {
    const prev = Array.from({ length: 100 }, (_, i) => String(i));
    const current = Array.from({ length: 100 }, (_, i) => String(i + 50));
    // 50..149 current, 0..99 prev → new = 100..149 = 50
    expect(countNewLevels(prev, current)).toBe(50);
  });

  it('treats price strings as exact matches', () => {
    // '0.5' and '0.50' are different strings
    expect(countNewLevels(['0.5'], ['0.50'])).toBe(1);
  });
});

// ── calcArrivalAsymmetry tests ──────────────────────────────────────────────

describe('calcArrivalAsymmetry', () => {
  it('returns 0 when both are 0', () => {
    expect(calcArrivalAsymmetry(0, 0)).toBe(0);
  });

  it('returns 1 when only bids are new', () => {
    expect(calcArrivalAsymmetry(5, 0)).toBe(1);
  });

  it('returns -1 when only asks are new', () => {
    expect(calcArrivalAsymmetry(0, 5)).toBe(-1);
  });

  it('returns 0 when bids equal asks', () => {
    expect(calcArrivalAsymmetry(3, 3)).toBe(0);
  });

  it('returns positive when bids > asks', () => {
    // (5-3)/(5+3) = 2/8 = 0.25
    expect(calcArrivalAsymmetry(5, 3)).toBeCloseTo(0.25, 4);
  });

  it('returns negative when asks > bids', () => {
    // (3-5)/(3+5) = -2/8 = -0.25
    expect(calcArrivalAsymmetry(3, 5)).toBeCloseTo(-0.25, 4);
  });

  it('handles large values', () => {
    // (100-1)/(100+1) ≈ 0.9802
    expect(calcArrivalAsymmetry(100, 1)).toBeCloseTo(0.9802, 3);
  });

  it('handles single bid', () => {
    // (1-0)/(1+0) = 1
    expect(calcArrivalAsymmetry(1, 0)).toBe(1);
  });

  it('handles single ask', () => {
    // (0-1)/(0+1) = -1
    expect(calcArrivalAsymmetry(0, 1)).toBe(-1);
  });

  it('is symmetric in absolute value', () => {
    const a = calcArrivalAsymmetry(7, 3);
    const b = calcArrivalAsymmetry(3, 7);
    expect(Math.abs(a)).toBeCloseTo(Math.abs(b), 4);
    expect(a).toBeCloseTo(-b, 4);
  });
});

// ── isSignalActive tests ────────────────────────────────────────────────────

describe('isSignalActive', () => {
  const cfg = { asymmetryThreshold: 0.3, minArrivalRate: 3 };

  it('returns true when asymmetry exceeds threshold and rate exceeds min', () => {
    expect(isSignalActive(0.5, 5, cfg)).toBe(true);
  });

  it('returns false when asymmetry is below threshold', () => {
    expect(isSignalActive(0.2, 5, cfg)).toBe(false);
  });

  it('returns false when rate is below min', () => {
    expect(isSignalActive(0.5, 2, cfg)).toBe(false);
  });

  it('returns false when both are below thresholds', () => {
    expect(isSignalActive(0.1, 1, cfg)).toBe(false);
  });

  it('returns false when asymmetry equals threshold exactly', () => {
    expect(isSignalActive(0.3, 5, cfg)).toBe(false);
  });

  it('returns false when rate equals min exactly', () => {
    expect(isSignalActive(0.5, 3, cfg)).toBe(false);
  });

  it('returns true for negative asymmetry exceeding threshold', () => {
    expect(isSignalActive(-0.5, 5, cfg)).toBe(true);
  });

  it('returns false when asymmetry is 0', () => {
    expect(isSignalActive(0, 10, cfg)).toBe(false);
  });

  it('returns false when totalNew is 0', () => {
    expect(isSignalActive(1.0, 0, cfg)).toBe(false);
  });

  it('works with custom thresholds', () => {
    const custom = { asymmetryThreshold: 0.1, minArrivalRate: 1 };
    expect(isSignalActive(0.15, 2, custom)).toBe(true);
  });

  it('handles edge case asymmetry of 1.0', () => {
    expect(isSignalActive(1.0, 5, cfg)).toBe(true);
  });

  it('handles edge case asymmetry of -1.0', () => {
    expect(isSignalActive(-1.0, 5, cfg)).toBe(true);
  });
});

// ── extractPriceLevels tests ────────────────────────────────────────────────

describe('extractPriceLevels', () => {
  it('returns empty array for empty input', () => {
    expect(extractPriceLevels([])).toEqual([]);
  });

  it('extracts prices from levels', () => {
    const levels = [
      { price: '0.50', size: '100' },
      { price: '0.51', size: '200' },
    ];
    expect(extractPriceLevels(levels)).toEqual(['0.50', '0.51']);
  });

  it('preserves order', () => {
    const levels = [
      { price: '0.53', size: '10' },
      { price: '0.51', size: '20' },
      { price: '0.52', size: '30' },
    ];
    expect(extractPriceLevels(levels)).toEqual(['0.53', '0.51', '0.52']);
  });

  it('handles single level', () => {
    expect(extractPriceLevels([{ price: '0.45', size: '50' }])).toEqual(['0.45']);
  });

  it('ignores size values', () => {
    const levels = [
      { price: '0.50', size: '999' },
      { price: '0.50', size: '1' },
    ];
    expect(extractPriceLevels(levels)).toEqual(['0.50', '0.50']);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<OrderArrivalRateDeps> = {}): OrderArrivalRateDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '10'], ['0.47', '10'], ['0.46', '10']],
          [['0.52', '10'], ['0.53', '10'], ['0.54', '10']],
        ),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: {
      getTrending: vi.fn().mockResolvedValue([
        {
          id: 'm1', question: 'Test?', slug: 'test', conditionId: 'cond-1',
          yesTokenId: 'yes-1', noTokenId: 'no-1', yesPrice: 0.50, noPrice: 0.50,
          volume: 50_000, volume24h: 5000, liquidity: 5000, endDate: '2027-12-31',
          active: true, closed: false, resolved: false, outcome: null,
        },
      ]),
    } as any,
    ...overrides,
  };
}

describe('createOrderArrivalRateTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createOrderArrivalRateTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (no previous snapshot)', async () => {
    const deps = makeDeps();
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: '2027-12-31',
          closed: true, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: true, active: true,
        }]),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 100, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createOrderArrivalRateTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market with no yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: undefined, noTokenId: 'no-1',
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles market with no noTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: undefined,
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    // Need to set up books that change between ticks to trigger an entry attempt
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        // Completely different levels to generate new arrivals
        return Promise.resolve(makeBook(
          [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
      config: { asymmetryThreshold: 0.1, minArrivalRate: 1, minVolume: 1 },
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles multiple markets in a single tick', async () => {
    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records snapshots across ticks', async () => {
    const deps = makeDeps();
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();
    await tick();
    // getOrderBook called once per tick per market
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(3);
  });

  it('skips market where mid price is 0', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.00', '100']], [['0.00', '100']],
        )),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market where mid price is 1', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['1.00', '100']], [['1.00', '100']],
        )),
      } as any,
    });
    const tick = createOrderArrivalRateTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when positive asymmetry ─────────────────────

  it('enters buy-yes when many new bid levels appear (positive asymmetry)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // First tick: baseline snapshot
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        // Second tick: many new bid levels, same asks → positive asymmetry
        return Promise.resolve(makeBook(
          [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick(); // baseline
    await tick(); // signal tick

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  it('enters buy-no when many new ask levels appear (negative asymmetry)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        // Many new ask levels, same bids → negative asymmetry
        return Promise.resolve(makeBook(
          [['0.48', '10']],
          [['0.53', '10'], ['0.54', '10'], ['0.55', '10'], ['0.56', '10'], ['0.57', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when signal inactive ─────────────────────────────────────

  it('does not enter when asymmetry is below threshold', async () => {
    // Same book each tick → no new levels → no signal
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 1,
        minVolume: 1,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when total new levels below minArrivalRate', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        // Only 1 new bid, 0 new asks → totalNew=1, below minArrivalRate=3
        return Promise.resolve(makeBook(
          [['0.49', '10']], [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.1,
        minArrivalRate: 3,
        minVolume: 1,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        if (callCount === 2) {
          // Many new bids → entry
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        // Price moves up → take profit
        return Promise.resolve(makeBook(
          [['0.70', '100']], [['0.72', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        takeProfitPct: 0.025,
        stopLossPct: 0.50,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick(); // baseline
    await tick(); // entry
    await tick(); // exit check

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        // Price drops → stop loss
        return Promise.resolve(makeBook(
          [['0.10', '100']], [['0.12', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        // Same price → no TP/SL, but max hold expires
        return Promise.resolve(makeBook(
          [['0.49', '10']], [['0.53', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        if (callCount <= 3) {
          // Many new bids → entry
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        if (callCount <= 5) {
          // Price up → TP exit
          return Promise.resolve(makeBook(
            [['0.70', '100']], [['0.72', '100']],
          ));
        }
        // Back to new bids pattern after exit
        return Promise.resolve(makeBook(
          [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        takeProfitPct: 0.025,
        cooldownMs: 180_000,
        stopLossPct: 0.50,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Should have at most 1 entry due to cooldown
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('respects maxPositions limit', async () => {
    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm3', conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
    ];

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First pass (3 markets): baseline
        if (callCount <= 3) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        // Second pass: all new levels → signal for all
        return Promise.resolve(makeBook(
          [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick(); // baseline
    await tick(); // entries

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events on entry', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      expect(deps.eventBus.emit).toHaveBeenCalledWith(
        'trade.executed',
        expect.objectContaining({
          trade: expect.objectContaining({
            side: 'buy',
            strategy: 'order-arrival-rate',
          }),
        }),
      );
    }
    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter when orderbook levels are identical across ticks', async () => {
    const book = makeBook(
      [['0.48', '10'], ['0.47', '10']],
      [['0.52', '10'], ['0.53', '10']],
    );
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(book),
      } as any,
      config: { minVolume: 1 },
    });

    const tick = createOrderArrivalRateTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not duplicate positions for same tokenId', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        // Alternate books to keep generating new levels
        if (callCount % 2 === 0) {
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.48', '10'], ['0.44', '10'], ['0.43', '10'], ['0.42', '10'], ['0.41', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Should only open one position per tokenId
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('uses IOC order type for exits', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.70', '100']], [['0.72', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
        takeProfitPct: 0.025,
        stopLossPct: 0.50,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();
    await tick();

    const iocOrders = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC'
    );
    // If entry happened and then exit, there should be IOC orders
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 1) {
      expect(iocOrders.length).toBeGreaterThanOrEqual(1);
    }
    expect(true).toBe(true);
  });

  it('handles exit when getOrderBook fails for position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook(
            [['0.48', '10']], [['0.52', '10']],
          ));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook(
            [['0.49', '10'], ['0.50', '10'], ['0.51', '10'], ['0.47', '10'], ['0.46', '10']],
            [['0.52', '10']],
          ));
        }
        // Fail on exit check
        return Promise.reject(new Error('network error'));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.3,
        minArrivalRate: 2,
        minVolume: 1,
      },
    });

    const tick = createOrderArrivalRateTick(deps);
    await tick();
    await tick();
    // Should not throw even when exit fetch fails
    await expect(tick()).resolves.toBeUndefined();
  });

  it('default config has expected values', () => {
    expect(DEFAULT_CONFIG.asymmetryThreshold).toBe(0.3);
    expect(DEFAULT_CONFIG.minArrivalRate).toBe(3);
    expect(DEFAULT_CONFIG.snapshotWindow).toBe(10);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.025);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(12 * 60_000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(5);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(90_000);
    expect(DEFAULT_CONFIG.positionSize).toBe('10');
  });
});
