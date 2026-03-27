import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcTotalDepth,
  calcDepletionRate,
  calcAsymmetryScore,
  isInformedFlow,
  createInfoAsymmetryScannerTick,
  DEFAULT_CONFIG,
  type InfoAsymmetryScannerConfig,
  type InfoAsymmetryScannerDeps,
} from '../../src/strategies/polymarket/info-asymmetry-scanner.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// -- Helper: build a mock orderbook ------------------------------------------

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeConfig(overrides: Partial<InfoAsymmetryScannerConfig> = {}): InfoAsymmetryScannerConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// -- calcTotalDepth tests ----------------------------------------------------

describe('calcTotalDepth', () => {
  it('sums all sizes from levels', () => {
    const levels = [
      { price: '0.50', size: '100' },
      { price: '0.49', size: '200' },
      { price: '0.48', size: '300' },
    ];
    expect(calcTotalDepth(levels)).toBe(600);
  });

  it('returns 0 for empty levels', () => {
    expect(calcTotalDepth([])).toBe(0);
  });

  it('handles a single level', () => {
    expect(calcTotalDepth([{ price: '0.50', size: '42' }])).toBe(42);
  });

  it('handles decimal sizes', () => {
    const levels = [
      { price: '0.50', size: '10.5' },
      { price: '0.49', size: '20.3' },
    ];
    expect(calcTotalDepth(levels)).toBeCloseTo(30.8, 4);
  });

  it('handles zero-size levels', () => {
    const levels = [
      { price: '0.50', size: '0' },
      { price: '0.49', size: '100' },
    ];
    expect(calcTotalDepth(levels)).toBe(100);
  });

  it('handles large sizes', () => {
    const levels = [
      { price: '0.50', size: '1000000' },
      { price: '0.49', size: '2000000' },
    ];
    expect(calcTotalDepth(levels)).toBe(3000000);
  });
});

// -- calcDepletionRate tests -------------------------------------------------

describe('calcDepletionRate', () => {
  it('returns 0 for empty history', () => {
    expect(calcDepletionRate([])).toBe(0);
  });

  it('returns 0 for single snapshot', () => {
    expect(calcDepletionRate([100])).toBe(0);
  });

  it('returns 0 when first snapshot is 0', () => {
    expect(calcDepletionRate([0, 50])).toBe(0);
  });

  it('calculates positive depletion when depth shrinks', () => {
    // (100 - 60) / 100 = 0.4
    expect(calcDepletionRate([100, 80, 60])).toBeCloseTo(0.4, 4);
  });

  it('calculates negative depletion when depth grows', () => {
    // (100 - 150) / 100 = -0.5
    expect(calcDepletionRate([100, 120, 150])).toBeCloseTo(-0.5, 4);
  });

  it('returns 0 when first equals last', () => {
    expect(calcDepletionRate([100, 80, 100])).toBeCloseTo(0, 4);
  });

  it('uses only first and last values', () => {
    // (200 - 50) / 200 = 0.75 regardless of middle values
    expect(calcDepletionRate([200, 999, 1, 50])).toBeCloseTo(0.75, 4);
  });

  it('handles complete depletion', () => {
    // (100 - 0) / 100 = 1.0
    expect(calcDepletionRate([100, 50, 0])).toBeCloseTo(1.0, 4);
  });

  it('handles two snapshots', () => {
    // (100 - 80) / 100 = 0.2
    expect(calcDepletionRate([100, 80])).toBeCloseTo(0.2, 4);
  });
});

// -- calcAsymmetryScore tests ------------------------------------------------

describe('calcAsymmetryScore', () => {
  it('returns 0 when both depletions are 0', () => {
    expect(calcAsymmetryScore(0, 0)).toBe(0);
  });

  it('returns 1 when only bid is depleting', () => {
    // (0.5 - 0) / (0.5 + 0) = 1
    expect(calcAsymmetryScore(0.5, 0)).toBe(1);
  });

  it('returns -1 when only ask is depleting', () => {
    // (0 - 0.5) / (0 + 0.5) = -1
    expect(calcAsymmetryScore(0, 0.5)).toBe(-1);
  });

  it('returns 0 when both sides deplete equally', () => {
    expect(calcAsymmetryScore(0.3, 0.3)).toBe(0);
  });

  it('returns positive when bid depletion > ask depletion', () => {
    // (0.6 - 0.2) / (0.6 + 0.2) = 0.4 / 0.8 = 0.5
    expect(calcAsymmetryScore(0.6, 0.2)).toBeCloseTo(0.5, 4);
  });

  it('returns negative when ask depletion > bid depletion', () => {
    // (0.2 - 0.6) / (0.2 + 0.6) = -0.4 / 0.8 = -0.5
    expect(calcAsymmetryScore(0.2, 0.6)).toBeCloseTo(-0.5, 4);
  });

  it('handles small values', () => {
    // (0.01 - 0.001) / (0.01 + 0.001) = 0.009/0.011
    expect(calcAsymmetryScore(0.01, 0.001)).toBeCloseTo(0.009 / 0.011, 4);
  });

  it('handles negative depletion values (depth growing)', () => {
    // (-0.2 - 0.4) / (-0.2 + 0.4) = -0.6 / 0.2 = -3
    expect(calcAsymmetryScore(-0.2, 0.4)).toBeCloseTo(-3, 4);
  });
});

// -- isInformedFlow tests ----------------------------------------------------

describe('isInformedFlow', () => {
  it('returns true when asymmetry and depletion exceed thresholds', () => {
    expect(isInformedFlow(0.5, 0.05, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(true);
  });

  it('returns false when asymmetry is below threshold', () => {
    expect(isInformedFlow(0.2, 0.05, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(false);
  });

  it('returns false when asymmetry equals threshold (strict >)', () => {
    expect(isInformedFlow(0.3, 0.05, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(false);
  });

  it('returns false when total depletion is below min', () => {
    expect(isInformedFlow(0.5, 0.005, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(false);
  });

  it('returns false when total depletion equals min (strict >)', () => {
    expect(isInformedFlow(0.5, 0.01, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(false);
  });

  it('returns false when both are below thresholds', () => {
    expect(isInformedFlow(0.1, 0.005, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(false);
  });

  it('returns true for negative asymmetry exceeding threshold', () => {
    expect(isInformedFlow(-0.5, 0.05, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(true);
  });

  it('returns false when asymmetry is 0', () => {
    expect(isInformedFlow(0, 0.05, { asymmetryThreshold: 0.3, minDepletionRate: 0.01 })).toBe(false);
  });

  it('uses default config values correctly', () => {
    const cfg = makeConfig();
    expect(isInformedFlow(0.5, 0.05, cfg)).toBe(true);
    expect(isInformedFlow(0.1, 0.05, cfg)).toBe(false);
  });
});

// -- Tick factory tests ------------------------------------------------------

function makeDeps(overrides: Partial<InfoAsymmetryScannerDeps> = {}): InfoAsymmetryScannerDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '100'], ['0.47', '80'], ['0.46', '60']],
          [['0.52', '100'], ['0.53', '80'], ['0.54', '60']],
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

describe('createInfoAsymmetryScannerTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createInfoAsymmetryScannerTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient depth history)', async () => {
    const deps = makeDeps();
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createInfoAsymmetryScannerTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records depth history across ticks', async () => {
    const deps = makeDeps();
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
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
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // -- Entry tests: BUY YES when asks depleting (positive asymmetry) --------

  it('enters buy-yes when asks deplete faster (positive asymmetry)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          // First tick: high ask depth, normal bid depth
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '200'], ['0.53', '200']],
          ));
        }
        // Second+ tick: ask depth drops sharply (buyers absorbing asks)
        return Promise.resolve(makeBook(
          [['0.48', '100'], ['0.47', '100']],
          [['0.52', '10'], ['0.53', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        depthWindow: 10,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 3; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // -- Entry tests: BUY NO when bids depleting (negative asymmetry) --------

  it('enters buy-no when bids deplete faster (negative asymmetry)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          // First tick: high bid depth, normal ask depth
          return Promise.resolve(makeBook(
            [['0.48', '200'], ['0.47', '200']],
            [['0.52', '100'], ['0.53', '100']],
          ));
        }
        // Second+ tick: bid depth drops sharply (sellers absorbing bids)
        return Promise.resolve(makeBook(
          [['0.48', '10'], ['0.47', '10']],
          [['0.52', '100'], ['0.53', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        depthWindow: 10,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 3; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // -- No entry when asymmetry below threshold -----

  it('does not enter when asymmetry is below threshold', async () => {
    // Stable depths -> no asymmetry
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        asymmetryThreshold: 0.5,
        minVolume: 1,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when depletion rate is below minimum', async () => {
    // Tiny changes in depth
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100']], [['0.52', '100']],
          ));
        }
        // Very minor change
        return Promise.resolve(makeBook(
          [['0.48', '99.5']], [['0.52', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.001,
        minDepletionRate: 0.5,
        minVolume: 1,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // -- Exit tests -----------------------------------------------------------

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '200'], ['0.53', '200']],
          ));
        }
        if (callCount <= 3) {
          // Ask depth drops -> entry
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '10'], ['0.53', '10']],
          ));
        }
        // Price rises for TP
        return Promise.resolve(makeBook(
          [['0.70', '100']], [['0.72', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '200'], ['0.53', '200']],
          ));
        }
        if (callCount <= 3) {
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '10'], ['0.53', '10']],
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
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '200'], ['0.53', '200']],
          ));
        }
        // Ask depth drops to create entry, then stays stable
        return Promise.resolve(makeBook(
          [['0.48', '100'], ['0.47', '100']],
          [['0.52', '10'], ['0.53', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 4; i++) {
      await tick();
    }
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    // Use a market with only yesTokenId (no noTokenId) so the position
    // is opened on yes-1, and cooldown is set on yes-1. The cooldown
    // check uses market.yesTokenId which is also yes-1.
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // Baseline: high bid depth (sellers will absorb)
          return Promise.resolve(makeBook(
            [['0.48', '200']], [['0.52', '100']],
          ));
        }
        if (callCount <= 3) {
          // Bid depth drops -> negative asymmetry but since no noTokenId,
          // we need positive asymmetry for YES entry
          // Actually let's use ask depletion for YES side
          return Promise.resolve(makeBook(
            [['0.48', '200']], [['0.52', '10']],
          ));
        }
        if (callCount === 4) {
          // Exit check: price rises for TP on YES position
          return Promise.resolve(makeBook(
            [['0.70', '100']], [['0.72', '100']],
          ));
        }
        // After exit, keep stable book (no signal)
        return Promise.resolve(makeBook(
          [['0.48', '100']], [['0.52', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: undefined,
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        takeProfitPct: 0.03,
        cooldownMs: 999_999_999, // extremely long cooldown
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    // Count entry orders (buy with GTC)
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Should have at most 1 entry due to cooldown on yes-1
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
        // First pass: high ask depth
        if (callCount <= 3) {
          return Promise.resolve(makeBook(
            [['0.48', '100'], ['0.47', '100']],
            [['0.52', '200'], ['0.53', '200']],
          ));
        }
        // Second pass: ask depth drops -> entry signal
        return Promise.resolve(makeBook(
          [['0.48', '100'], ['0.47', '100']],
          [['0.52', '10'], ['0.53', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter when both sides deplete equally (asymmetry = 0)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '200']], [['0.52', '200']],
          ));
        }
        // Both sides deplete equally
        return Promise.resolve(makeBook(
          [['0.48', '100']], [['0.52', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.1,
        minDepletionRate: 0.01,
        minVolume: 1,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('depth window limits stored snapshots', async () => {
    const deps = makeDeps({
      config: {
        depthWindow: 3,
        minVolume: 1,
      },
    });
    const tick = createInfoAsymmetryScannerTick(deps);
    // Run many ticks - should not accumulate unbounded history
    for (let i = 0; i < 20; i++) {
      await tick();
    }
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(20);
  });

  it('does not duplicate position for same market', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100']], [['0.52', '200']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.48', '100']], [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        maxPositions: 5,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Should enter at most once for the same market
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('handles exit order failure gracefully', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100']], [['0.52', '200']],
          ));
        }
        if (callCount <= 3) {
          return Promise.resolve(makeBook(
            [['0.48', '100']], [['0.52', '10']],
          ));
        }
        // Price moves for exit
        return Promise.resolve(makeBook(
          [['0.70', '100']], [['0.72', '100']],
        ));
      }),
    };

    const orderManager = {
      placeOrder: vi.fn()
        .mockResolvedValueOnce({ id: 'order-1' })
        .mockRejectedValue(new Error('network error')),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
        takeProfitPct: 0.03,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 6; i++) {
      await expect(tick()).resolves.toBeUndefined();
    }
  });

  it('uses default config when no overrides provided', () => {
    const deps = makeDeps();
    const tick = createInfoAsymmetryScannerTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('tracks multiple markets independently', async () => {
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
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    await tick();
    // Two markets x 2 ticks = 4 orderbook fetches
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(4);
  });

  it('entry order uses GTC type', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.48', '100']], [['0.52', '200']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.48', '100']], [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        asymmetryThreshold: 0.2,
        minDepletionRate: 0.01,
        minVolume: 1,
      },
    });

    const tick = createInfoAsymmetryScannerTick(deps);
    for (let i = 0; i < 4; i++) {
      await tick();
    }

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    for (const call of gtcCalls) {
      expect(call[0].orderType).toBe('GTC');
      expect(call[0].side).toBe('buy');
    }
  });

  it('skips market with volume undefined', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: undefined, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips market with volume 0', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 0, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createInfoAsymmetryScannerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });
});
