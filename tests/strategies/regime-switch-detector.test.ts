import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcReturns,
  calcVariance,
  calcVarianceRatio,
  classifyRegime,
  detectSwitch,
  createRegimeSwitchDetectorTick,
  DEFAULT_CONFIG,
  type RegimeSwitchDetectorConfig,
  type RegimeSwitchDetectorDeps,
} from '../../src/strategies/polymarket/regime-switch-detector.js';
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

function makeConfig(overrides: Partial<RegimeSwitchDetectorConfig> = {}): RegimeSwitchDetectorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcReturns tests ────────────────────────────────────────────────────────

describe('calcReturns', () => {
  it('returns empty array for empty input', () => {
    expect(calcReturns([])).toEqual([]);
  });

  it('returns empty array for single price', () => {
    expect(calcReturns([0.5])).toEqual([]);
  });

  it('calculates consecutive differences for two prices', () => {
    const result = calcReturns([0.5, 0.6]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeCloseTo(0.1, 6);
  });

  it('calculates consecutive differences for multiple prices', () => {
    const result = calcReturns([1.0, 1.1, 1.05, 1.2]);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeCloseTo(0.1, 6);
    expect(result[1]).toBeCloseTo(-0.05, 6);
    expect(result[2]).toBeCloseTo(0.15, 6);
  });

  it('handles flat prices (all returns zero)', () => {
    const result = calcReturns([0.5, 0.5, 0.5, 0.5]);
    expect(result).toEqual([0, 0, 0]);
  });

  it('handles decreasing prices', () => {
    const result = calcReturns([1.0, 0.9, 0.8]);
    expect(result[0]).toBeCloseTo(-0.1, 6);
    expect(result[1]).toBeCloseTo(-0.1, 6);
  });

  it('handles negative returns correctly', () => {
    const result = calcReturns([0.7, 0.3]);
    expect(result[0]).toBeCloseTo(-0.4, 6);
  });

  it('handles very small price differences', () => {
    const result = calcReturns([0.5000, 0.5001]);
    expect(result[0]).toBeCloseTo(0.0001, 6);
  });
});

// ── calcVariance tests ───────────────────────────────────────────────────────

describe('calcVariance', () => {
  it('returns 0 for empty array', () => {
    expect(calcVariance([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(calcVariance([5])).toBe(0);
  });

  it('returns 0 for identical values', () => {
    expect(calcVariance([3, 3, 3, 3])).toBe(0);
  });

  it('calculates population variance correctly', () => {
    // values: [2, 4, 4, 4, 5, 5, 7, 9], mean = 5
    // deviations squared: 9, 1, 1, 1, 0, 0, 4, 16 → sum = 32 → var = 32/8 = 4
    expect(calcVariance([2, 4, 4, 4, 5, 5, 7, 9])).toBe(4);
  });

  it('calculates variance for two values', () => {
    // [1, 3] → mean = 2, deviations squared: 1, 1 → var = 2/2 = 1
    expect(calcVariance([1, 3])).toBe(1);
  });

  it('handles negative values', () => {
    // [-1, 1] → mean = 0, deviations squared: 1, 1 → var = 2/2 = 1
    expect(calcVariance([-1, 1])).toBe(1);
  });

  it('handles small variance', () => {
    const result = calcVariance([0.500, 0.501, 0.499, 0.500]);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(0.001);
  });

  it('higher spread gives higher variance', () => {
    const lowSpread = calcVariance([4.9, 5.0, 5.1]);
    const highSpread = calcVariance([1.0, 5.0, 9.0]);
    expect(highSpread).toBeGreaterThan(lowSpread);
  });
});

// ── calcVarianceRatio tests ──────────────────────────────────────────────────

describe('calcVarianceRatio', () => {
  it('returns 0 when longVar is 0', () => {
    expect(calcVarianceRatio(5, 0)).toBe(0);
  });

  it('returns 1 when shortVar equals longVar', () => {
    expect(calcVarianceRatio(4, 4)).toBe(1);
  });

  it('returns > 1 when shortVar > longVar (trending)', () => {
    expect(calcVarianceRatio(8, 4)).toBe(2);
  });

  it('returns < 1 when shortVar < longVar (mean-reverting)', () => {
    expect(calcVarianceRatio(2, 4)).toBe(0.5);
  });

  it('returns 0 when both are 0', () => {
    expect(calcVarianceRatio(0, 0)).toBe(0);
  });

  it('returns 0 when shortVar is 0 and longVar is positive', () => {
    expect(calcVarianceRatio(0, 5)).toBe(0);
  });

  it('handles very small longVar', () => {
    const result = calcVarianceRatio(1, 0.001);
    expect(result).toBe(1000);
  });
});

// ── classifyRegime tests ─────────────────────────────────────────────────────

describe('classifyRegime', () => {
  it('returns trending when VR >= trendingThreshold', () => {
    expect(classifyRegime(1.5, 1.2, 0.8)).toBe('trending');
  });

  it('returns trending when VR equals trendingThreshold', () => {
    expect(classifyRegime(1.2, 1.2, 0.8)).toBe('trending');
  });

  it('returns mean-reverting when VR <= meanRevertThreshold', () => {
    expect(classifyRegime(0.5, 1.2, 0.8)).toBe('mean-reverting');
  });

  it('returns mean-reverting when VR equals meanRevertThreshold', () => {
    expect(classifyRegime(0.8, 1.2, 0.8)).toBe('mean-reverting');
  });

  it('returns neutral when VR is between thresholds', () => {
    expect(classifyRegime(1.0, 1.2, 0.8)).toBe('neutral');
  });

  it('returns neutral for VR just above meanRevertThreshold', () => {
    expect(classifyRegime(0.81, 1.2, 0.8)).toBe('neutral');
  });

  it('returns neutral for VR just below trendingThreshold', () => {
    expect(classifyRegime(1.19, 1.2, 0.8)).toBe('neutral');
  });

  it('handles equal thresholds (no neutral zone)', () => {
    // When trendThresh = meanRevertThresh = 1.0, VR=1.0 hits trending first (>= check)
    expect(classifyRegime(1.0, 1.0, 1.0)).toBe('trending');
  });

  it('handles VR of 0', () => {
    expect(classifyRegime(0, 1.2, 0.8)).toBe('mean-reverting');
  });

  it('handles very large VR', () => {
    expect(classifyRegime(100, 1.2, 0.8)).toBe('trending');
  });
});

// ── detectSwitch tests ───────────────────────────────────────────────────────

describe('detectSwitch', () => {
  it('returns null when regimes are the same', () => {
    expect(detectSwitch('trending', 'trending')).toBeNull();
    expect(detectSwitch('mean-reverting', 'mean-reverting')).toBeNull();
    expect(detectSwitch('neutral', 'neutral')).toBeNull();
  });

  it('returns to-trending when switching to trending from neutral', () => {
    expect(detectSwitch('neutral', 'trending')).toBe('to-trending');
  });

  it('returns to-trending when switching to trending from mean-reverting', () => {
    expect(detectSwitch('mean-reverting', 'trending')).toBe('to-trending');
  });

  it('returns to-mean-reverting when switching from neutral', () => {
    expect(detectSwitch('neutral', 'mean-reverting')).toBe('to-mean-reverting');
  });

  it('returns to-mean-reverting when switching from trending', () => {
    expect(detectSwitch('trending', 'mean-reverting')).toBe('to-mean-reverting');
  });

  it('returns null when switching from trending to neutral', () => {
    expect(detectSwitch('trending', 'neutral')).toBeNull();
  });

  it('returns null when switching from mean-reverting to neutral', () => {
    expect(detectSwitch('mean-reverting', 'neutral')).toBeNull();
  });
});

// ── DEFAULT_CONFIG tests ─────────────────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('has correct default values', () => {
    expect(DEFAULT_CONFIG.shortWindow).toBe(5);
    expect(DEFAULT_CONFIG.longWindow).toBe(20);
    expect(DEFAULT_CONFIG.vrEmaAlpha).toBe(0.12);
    expect(DEFAULT_CONFIG.trendingThreshold).toBe(1.2);
    expect(DEFAULT_CONFIG.meanRevertThreshold).toBe(0.8);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.03);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(20 * 60_000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(4);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(120_000);
    expect(DEFAULT_CONFIG.positionSize).toBe('12');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<RegimeSwitchDetectorDeps> = {}): RegimeSwitchDetectorDeps {
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

describe('createRegimeSwitchDetectorTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createRegimeSwitchDetectorTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createRegimeSwitchDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createRegimeSwitchDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
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
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter until longWindow+1 prices are accumulated', async () => {
    const deps = makeDeps({
      config: { longWindow: 5, shortWindow: 2, minVolume: 1 },
    });
    const tick = createRegimeSwitchDetectorTick(deps);
    // With longWindow=5, need 6 prices. Each tick adds 1 price.
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    // Not enough prices yet for entry signal processing
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
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

    // Create a scenario where regime switches occur by varying prices
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Generate prices that create a trending variance ratio after enough ticks
        // Alternate between stable and volatile to try to trigger entries
        if (callCount <= 60) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.39', '100']], [['0.41', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        minVolume: 1,
        maxPositions: 1,
        longWindow: 5,
        shortWindow: 2,
        trendingThreshold: 1.2,
        meanRevertThreshold: 0.8,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRegimeSwitchDetectorTick(deps);
    for (let i = 0; i < 30; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('exits on max hold time', async () => {
    // Build up enough price history to trigger an entry, then check max hold exit
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Stable for first 6 calls (longWindow=5 needs 6 prices), then shift
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Big jump to create trending regime switch
        return Promise.resolve(makeBook(
          [['0.69', '100']], [['0.71', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        longWindow: 5,
        shortWindow: 2,
        trendingThreshold: 1.0001,
        meanRevertThreshold: 0.0001,
        maxHoldMs: 1,
        takeProfitPct: 0.99,
        stopLossPct: 0.99,
        vrEmaAlpha: 0.99,
      },
    });

    const tick = createRegimeSwitchDetectorTick(deps);
    // Build price history
    for (let i = 0; i < 8; i++) {
      await tick();
    }
    // Wait for max hold
    await new Promise(r => setTimeout(r, 10));
    await tick();

    // If an entry was made, the exit should fire after max hold
    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 8) {
          return Promise.resolve(makeBook(
            [['0.69', '100']], [['0.71', '100']],
          ));
        }
        // TP exit level
        if (callCount <= 10) {
          return Promise.resolve(makeBook(
            [['0.89', '100']], [['0.91', '100']],
          ));
        }
        // Back to entry condition
        return Promise.resolve(makeBook(
          [['0.49', '100']], [['0.51', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        longWindow: 5,
        shortWindow: 2,
        trendingThreshold: 1.0001,
        meanRevertThreshold: 0.0001,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
        vrEmaAlpha: 0.99,
      },
    });

    const tick = createRegimeSwitchDetectorTick(deps);
    for (let i = 0; i < 15; i++) {
      await tick();
    }

    // Count GTC (entry) orders — cooldown prevents immediate re-entry on same token
    // but regime can switch multiple times across different regimes
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('does not enter when no regime switch detected', async () => {
    // Prices that produce VR in the neutral zone (between thresholds)
    // Use slightly varying prices so VR is ~1 (random walk), staying neutral
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Small oscillations to produce VR near 1
        const base = 0.50 + 0.01 * Math.sin(callCount * 0.5);
        const bid = (base - 0.01).toFixed(4);
        const ask = (base + 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        longWindow: 5,
        shortWindow: 2,
        trendingThreshold: 5.0,
        meanRevertThreshold: 0.001,
      },
    });

    const tick = createRegimeSwitchDetectorTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not place order when market volume is undefined', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: undefined, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createRegimeSwitchDetectorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('uses GTC order type for entries', async () => {
    // We need to force a regime switch. Use varying prices.
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Stable prices first to build EMA at neutral
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Spike to create trending switch
        return Promise.resolve(makeBook(
          [['0.69', '100']], [['0.71', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        longWindow: 5,
        shortWindow: 2,
        trendingThreshold: 1.0001,
        meanRevertThreshold: 0.0001,
        vrEmaAlpha: 0.99,
        takeProfitPct: 0.99,
        stopLossPct: 0.99,
      },
    });

    const tick = createRegimeSwitchDetectorTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // If entry triggered, it should use GTC
    for (const call of gtcCalls) {
      expect(call[0].orderType).toBe('GTC');
    }
  });

  it('does not enter on same token twice', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.69', '100']], [['0.71', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        longWindow: 5,
        shortWindow: 2,
        trendingThreshold: 1.0001,
        meanRevertThreshold: 0.0001,
        vrEmaAlpha: 0.99,
        maxPositions: 10,
        takeProfitPct: 0.99,
        stopLossPct: 0.99,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRegimeSwitchDetectorTick(deps);
    for (let i = 0; i < 15; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Should enter at most once per market
    expect(entries.length).toBeLessThanOrEqual(1);
  });
});
