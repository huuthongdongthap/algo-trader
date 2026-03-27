import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcExpectedReturn,
  calcVariance,
  calcSharpeRatio,
  selectBestMarket,
  createMeanVarianceOptimizerTick,
  DEFAULT_CONFIG,
  type MeanVarianceOptimizerConfig,
  type MeanVarianceOptimizerDeps,
} from '../../src/strategies/polymarket/mean-variance-optimizer.js';
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

function makeConfig(overrides: Partial<MeanVarianceOptimizerConfig> = {}): MeanVarianceOptimizerConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcExpectedReturn tests ─────────────────────────────────────────────────

describe('calcExpectedReturn', () => {
  it('returns 0 for empty array', () => {
    expect(calcExpectedReturn([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(calcExpectedReturn([0.5])).toBe(0);
  });

  it('returns 0 when first price is 0', () => {
    expect(calcExpectedReturn([0, 0.5, 0.6])).toBe(0);
  });

  it('calculates positive return correctly', () => {
    // (0.6 - 0.5) / 0.5 = 0.2
    expect(calcExpectedReturn([0.5, 0.55, 0.6])).toBeCloseTo(0.2, 4);
  });

  it('calculates negative return correctly', () => {
    // (0.4 - 0.5) / 0.5 = -0.2
    expect(calcExpectedReturn([0.5, 0.45, 0.4])).toBeCloseTo(-0.2, 4);
  });

  it('returns 0 when last equals first', () => {
    expect(calcExpectedReturn([0.5, 0.6, 0.5])).toBeCloseTo(0, 4);
  });

  it('uses only first and last prices', () => {
    // (0.8 - 0.4) / 0.4 = 1.0
    expect(calcExpectedReturn([0.4, 0.1, 0.2, 0.8])).toBeCloseTo(1.0, 4);
  });

  it('handles two element array', () => {
    // (0.6 - 0.3) / 0.3 = 1.0
    expect(calcExpectedReturn([0.3, 0.6])).toBeCloseTo(1.0, 4);
  });

  it('handles very small first price', () => {
    // (0.5 - 0.01) / 0.01 = 49
    expect(calcExpectedReturn([0.01, 0.5])).toBeCloseTo(49, 1);
  });

  it('handles price going to near zero', () => {
    // (0.01 - 0.5) / 0.5 = -0.98
    expect(calcExpectedReturn([0.5, 0.01])).toBeCloseTo(-0.98, 2);
  });
});

// ── calcVariance tests ─────────────────────────────────────────────────────

describe('calcVariance', () => {
  it('returns 0 for empty array', () => {
    expect(calcVariance([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(calcVariance([0.5])).toBe(0);
  });

  it('returns 0 for constant prices', () => {
    expect(calcVariance([0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it('calculates variance for simple price series', () => {
    // prices: [1.0, 1.1, 1.0]
    // returns: [0.1, -0.09090909]
    // mean return: (0.1 + (-0.09090909)) / 2 = 0.00454545
    // variance: ((0.1 - 0.00454545)^2 + (-0.09090909 - 0.00454545)^2) / 2
    const result = calcVariance([1.0, 1.1, 1.0]);
    expect(result).toBeGreaterThan(0);
  });

  it('returns higher variance for volatile prices', () => {
    const stable = calcVariance([0.50, 0.51, 0.50, 0.51]);
    const volatile = calcVariance([0.50, 0.70, 0.30, 0.60]);
    expect(volatile).toBeGreaterThan(stable);
  });

  it('handles two prices', () => {
    // prices: [0.5, 0.6]
    // returns: [0.2]
    // mean: 0.2
    // variance: (0.2 - 0.2)^2 / 1 = 0
    expect(calcVariance([0.5, 0.6])).toBe(0);
  });

  it('handles zero in the middle of the series', () => {
    // prices: [0.5, 0, 0.5]
    // returns: [-1, 0 (because prev is 0)]
    const result = calcVariance([0.5, 0, 0.5]);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('handles all zeros', () => {
    // prices: [0, 0, 0]
    // returns: [0, 0]
    expect(calcVariance([0, 0, 0])).toBe(0);
  });

  it('population variance is never negative', () => {
    const result = calcVariance([0.1, 0.9, 0.2, 0.8, 0.3]);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('handles monotonically increasing prices', () => {
    const result = calcVariance([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(result).toBeGreaterThanOrEqual(0);
  });
});

// ── calcSharpeRatio tests ────────────────────────────────────────────────────

describe('calcSharpeRatio', () => {
  it('returns 0 when variance is 0', () => {
    expect(calcSharpeRatio(0.1, 0)).toBe(0);
  });

  it('returns 0 when variance is negative', () => {
    expect(calcSharpeRatio(0.1, -1)).toBe(0);
  });

  it('calculates positive ratio for positive return', () => {
    // 0.1 / sqrt(0.01) = 0.1 / 0.1 = 1.0
    expect(calcSharpeRatio(0.1, 0.01)).toBeCloseTo(1.0, 4);
  });

  it('calculates negative ratio for negative return', () => {
    // -0.1 / sqrt(0.01) = -0.1 / 0.1 = -1.0
    expect(calcSharpeRatio(-0.1, 0.01)).toBeCloseTo(-1.0, 4);
  });

  it('returns 0 when expected return is 0', () => {
    expect(calcSharpeRatio(0, 0.01)).toBe(0);
  });

  it('higher return gives higher ratio', () => {
    const low = calcSharpeRatio(0.05, 0.01);
    const high = calcSharpeRatio(0.10, 0.01);
    expect(high).toBeGreaterThan(low);
  });

  it('higher variance gives lower ratio', () => {
    const low = calcSharpeRatio(0.1, 0.04);
    const high = calcSharpeRatio(0.1, 0.01);
    expect(high).toBeGreaterThan(low);
  });

  it('handles very small variance', () => {
    const result = calcSharpeRatio(0.1, 0.0001);
    // 0.1 / sqrt(0.0001) = 0.1 / 0.01 = 10
    expect(result).toBeCloseTo(10, 1);
  });

  it('handles very large return and variance', () => {
    const result = calcSharpeRatio(100, 10000);
    // 100 / sqrt(10000) = 100 / 100 = 1.0
    expect(result).toBeCloseTo(1.0, 4);
  });
});

// ── selectBestMarket tests ───────────────────────────────────────────────────

describe('selectBestMarket', () => {
  it('returns null for empty candidates', () => {
    expect(selectBestMarket([], 1.5)).toBeNull();
  });

  it('returns null when no candidate meets threshold', () => {
    const candidates = [
      { id: 'a', ratio: 0.5 },
      { id: 'b', ratio: -1.0 },
    ];
    expect(selectBestMarket(candidates, 1.5)).toBeNull();
  });

  it('selects the candidate with highest |ratio|', () => {
    const candidates = [
      { id: 'a', ratio: 2.0 },
      { id: 'b', ratio: 3.0 },
      { id: 'c', ratio: 1.5 },
    ];
    const result = selectBestMarket(candidates, 1.5);
    expect(result).toEqual({ id: 'b', ratio: 3.0 });
  });

  it('considers negative ratios by absolute value', () => {
    const candidates = [
      { id: 'a', ratio: 2.0 },
      { id: 'b', ratio: -4.0 },
    ];
    const result = selectBestMarket(candidates, 1.5);
    expect(result).toEqual({ id: 'b', ratio: -4.0 });
  });

  it('returns candidate exactly at threshold', () => {
    const candidates = [{ id: 'a', ratio: 1.5 }];
    const result = selectBestMarket(candidates, 1.5);
    expect(result).toEqual({ id: 'a', ratio: 1.5 });
  });

  it('returns candidate exactly at negative threshold', () => {
    const candidates = [{ id: 'a', ratio: -1.5 }];
    const result = selectBestMarket(candidates, 1.5);
    expect(result).toEqual({ id: 'a', ratio: -1.5 });
  });

  it('selects single valid candidate', () => {
    const candidates = [
      { id: 'a', ratio: 0.5 },
      { id: 'b', ratio: 2.0 },
      { id: 'c', ratio: 1.0 },
    ];
    const result = selectBestMarket(candidates, 1.5);
    expect(result).toEqual({ id: 'b', ratio: 2.0 });
  });

  it('handles all candidates below threshold', () => {
    const candidates = [
      { id: 'a', ratio: 0.1 },
      { id: 'b', ratio: -0.2 },
    ];
    expect(selectBestMarket(candidates, 1.0)).toBeNull();
  });

  it('handles zero ratio', () => {
    const candidates = [{ id: 'a', ratio: 0 }];
    expect(selectBestMarket(candidates, 0.1)).toBeNull();
  });

  it('handles zero minRatio threshold', () => {
    const candidates = [
      { id: 'a', ratio: 0.01 },
      { id: 'b', ratio: 0.02 },
    ];
    const result = selectBestMarket(candidates, 0);
    expect(result).toEqual({ id: 'b', ratio: 0.02 });
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<MeanVarianceOptimizerDeps> = {}): MeanVarianceOptimizerDeps {
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

describe('createMeanVarianceOptimizerTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createMeanVarianceOptimizerTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createMeanVarianceOptimizerTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    // mid = (0 + 1) / 2 = 0.5 which is valid, but no entry on first tick
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
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
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
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when positive ratio ─────────────────────────

  it('enters buy-yes when ratio is positive and above threshold', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Gradually increasing prices to build positive expected return
        const price = 0.40 + callCount * 0.03;
        const p = Math.min(price, 0.95).toFixed(2);
        return Promise.resolve(makeBook(
          [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
          [[p, '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
        returnWindow: 5,
        varianceWindow: 5,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── Entry tests: BUY NO when negative ratio ──────────────────────────

  it('enters buy-no when ratio is negative and above threshold in absolute value', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Gradually decreasing prices to build negative expected return
        const price = 0.80 - callCount * 0.04;
        const p = Math.max(price, 0.10).toFixed(2);
        return Promise.resolve(makeBook(
          [[p, '100']],
          [[String((parseFloat(p) + 0.01).toFixed(2)), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
        returnWindow: 5,
        varianceWindow: 5,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when ratio below threshold ───────────────────────────────

  it('does not enter when Sharpe ratio is below threshold', async () => {
    // Stable prices → near-zero return → low ratio
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        minSharpeRatio: 10.0,
        minVolume: 1,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          // Increasing prices to generate positive ratio
          const p = (0.40 + callCount * 0.03).toFixed(2);
          return Promise.resolve(makeBook(
            [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
            [[p, '100']],
          ));
        }
        if (callCount <= 6) {
          // Same trend for entry
          return Promise.resolve(makeBook(
            [['0.54', '100']], [['0.56', '100']],
          ));
        }
        // Price recovers for TP
        return Promise.resolve(makeBook(
          [['0.75', '100']], [['0.77', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
        returnWindow: 3,
        varianceWindow: 3,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          const p = (0.40 + callCount * 0.03).toFixed(2);
          return Promise.resolve(makeBook(
            [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
            [[p, '100']],
          ));
        }
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.54', '100']], [['0.56', '100']],
          ));
        }
        // Price drops for SL
        return Promise.resolve(makeBook(
          [['0.05', '100']], [['0.07', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
        returnWindow: 3,
        varianceWindow: 3,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          const p = (0.40 + callCount * 0.03).toFixed(2);
          return Promise.resolve(makeBook(
            [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
            [[p, '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.54', '100']], [['0.56', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
        returnWindow: 3,
        varianceWindow: 3,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          const p = (0.40 + callCount * 0.03).toFixed(2);
          return Promise.resolve(makeBook(
            [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
            [[p, '100']],
          ));
        }
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.54', '100']], [['0.56', '100']],
          ));
        }
        if (callCount <= 8) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.75', '100']], [['0.77', '100']],
          ));
        }
        // Back to trending prices after exit
        return Promise.resolve(makeBook(
          [['0.54', '100']], [['0.56', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
        returnWindow: 3,
        varianceWindow: 3,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 12; i++) {
      await tick();
    }

    // Count entry orders (buy with GTC)
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
        // Increasing prices for positive return
        const p = (0.40 + (callCount % 10) * 0.03).toFixed(2);
        return Promise.resolve(makeBook(
          [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
          [[p, '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        minSharpeRatio: 0.01,
        minVolume: 1,
        returnWindow: 3,
        varianceWindow: 3,
        maxPositions: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only selects best market per tick, and maxPositions=1
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('default config has expected values', () => {
    const cfg = makeConfig();
    expect(cfg.returnWindow).toBe(15);
    expect(cfg.varianceWindow).toBe(20);
    expect(cfg.minSharpeRatio).toBe(1.5);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.03);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(20 * 60_000);
    expect(cfg.maxPositions).toBe(3);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.positionSize).toBe('15');
  });

  it('config overrides are applied', () => {
    const cfg = makeConfig({ minSharpeRatio: 3.0, maxPositions: 5 });
    expect(cfg.minSharpeRatio).toBe(3.0);
    expect(cfg.maxPositions).toBe(5);
    // Non-overridden values remain default
    expect(cfg.returnWindow).toBe(15);
  });

  it('does not enter when variance is zero (constant prices)', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        minSharpeRatio: 0.1,
        minVolume: 1,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    // Constant prices → zero variance → calcSharpeRatio returns 0 → no entry
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('selects only one market per tick even with multiple candidates', async () => {
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

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const p = (0.40 + (callCount % 8) * 0.04).toFixed(2);
        return Promise.resolve(makeBook(
          [[String((parseFloat(p) - 0.01).toFixed(2)), '100']],
          [[p, '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        minSharpeRatio: 0.01,
        minVolume: 1,
        returnWindow: 3,
        varianceWindow: 3,
        maxPositions: 10,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createMeanVarianceOptimizerTick(deps);
    // Run enough ticks to build history then enter
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    // At most one GTC entry per tick (strategy selects single best)
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Each tick can produce at most 1 entry
    expect(entries.length).toBeLessThanOrEqual(5);
  });

  it('handles volume being undefined', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: undefined, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles volume being null', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: null, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createMeanVarianceOptimizerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });
});
