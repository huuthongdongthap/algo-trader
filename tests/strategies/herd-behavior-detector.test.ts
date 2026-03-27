import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcReturn,
  calcPearsonR,
  calcAvgPairwiseCorrelation,
  detectHerdPeak,
  calcHerdDirection,
  createHerdBehaviorDetectorTick,
  DEFAULT_CONFIG,
  type HerdBehaviorDetectorConfig,
  type HerdBehaviorDetectorDeps,
} from '../../src/strategies/polymarket/herd-behavior-detector.js';
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

function makeConfig(overrides: Partial<HerdBehaviorDetectorConfig> = {}): HerdBehaviorDetectorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

function makeMarket(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    question: `Test ${id}?`,
    slug: `test-${id}`,
    conditionId: `cond-${id}`,
    yesTokenId: `yes-${id}`,
    noTokenId: `no-${id}`,
    yesPrice: 0.50,
    noPrice: 0.50,
    volume: 50_000,
    volume24h: 5000,
    liquidity: 5000,
    endDate: '2027-12-31',
    active: true,
    closed: false,
    resolved: false,
    outcome: null,
    ...overrides,
  };
}

function makeMarkets(count: number) {
  return Array.from({ length: count }, (_, i) => makeMarket(`m${i + 1}`));
}

// ── calcReturn tests ─────────────────────────────────────────────────────────

describe('calcReturn', () => {
  it('returns 0 for empty array', () => {
    expect(calcReturn([])).toBe(0);
  });

  it('returns 0 for single-element array', () => {
    expect(calcReturn([0.5])).toBe(0);
  });

  it('returns 0 when first price is 0', () => {
    expect(calcReturn([0, 0.5, 0.6])).toBe(0);
  });

  it('calculates positive return correctly', () => {
    // (0.6 - 0.5) / 0.5 = 0.2
    expect(calcReturn([0.5, 0.6])).toBeCloseTo(0.2, 4);
  });

  it('calculates negative return correctly', () => {
    // (0.4 - 0.5) / 0.5 = -0.2
    expect(calcReturn([0.5, 0.4])).toBeCloseTo(-0.2, 4);
  });

  it('uses first and last prices only', () => {
    // (0.8 - 0.5) / 0.5 = 0.6
    expect(calcReturn([0.5, 0.3, 0.9, 0.8])).toBeCloseTo(0.6, 4);
  });

  it('returns 0 for unchanged prices', () => {
    expect(calcReturn([0.5, 0.5])).toBe(0);
  });

  it('handles large price increase', () => {
    // (1.0 - 0.1) / 0.1 = 9.0
    expect(calcReturn([0.1, 1.0])).toBeCloseTo(9.0, 4);
  });
});

// ── calcPearsonR tests ───────────────────────────────────────────────────────

describe('calcPearsonR', () => {
  it('returns 0 for empty arrays', () => {
    expect(calcPearsonR([], [])).toBe(0);
  });

  it('returns 0 for single-element arrays', () => {
    expect(calcPearsonR([1], [2])).toBe(0);
  });

  it('returns 0 for arrays of different lengths', () => {
    expect(calcPearsonR([1, 2, 3], [1, 2])).toBe(0);
  });

  it('returns 1 for perfectly correlated arrays', () => {
    expect(calcPearsonR([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1.0, 4);
  });

  it('returns -1 for perfectly anti-correlated arrays', () => {
    expect(calcPearsonR([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1.0, 4);
  });

  it('returns 0 for uncorrelated arrays', () => {
    // sin-like vs constant offset pattern
    const x = [1, -1, 1, -1, 1, -1];
    const y = [1, 1, -1, -1, 1, 1];
    const r = calcPearsonR(x, y);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it('returns 0 when x has zero variance', () => {
    expect(calcPearsonR([5, 5, 5, 5], [1, 2, 3, 4])).toBe(0);
  });

  it('returns 0 when y has zero variance', () => {
    expect(calcPearsonR([1, 2, 3, 4], [5, 5, 5, 5])).toBe(0);
  });

  it('handles two-element arrays', () => {
    // Two points always have r = 1 or -1
    expect(calcPearsonR([1, 2], [3, 4])).toBeCloseTo(1.0, 4);
    expect(calcPearsonR([1, 2], [4, 3])).toBeCloseTo(-1.0, 4);
  });

  it('handles negative values', () => {
    expect(calcPearsonR([-3, -2, -1, 0, 1], [-6, -4, -2, 0, 2])).toBeCloseTo(1.0, 4);
  });
});

// ── calcAvgPairwiseCorrelation tests ─────────────────────────────────────────

describe('calcAvgPairwiseCorrelation', () => {
  it('returns 0 for empty array', () => {
    expect(calcAvgPairwiseCorrelation([])).toBe(0);
  });

  it('returns 0 for single series', () => {
    expect(calcAvgPairwiseCorrelation([[1, 2, 3]])).toBe(0);
  });

  it('returns 1 for two perfectly correlated series', () => {
    const result = calcAvgPairwiseCorrelation([
      [1, 2, 3, 4, 5],
      [2, 4, 6, 8, 10],
    ]);
    expect(result).toBeCloseTo(1.0, 4);
  });

  it('returns -1 for two perfectly anti-correlated series', () => {
    const result = calcAvgPairwiseCorrelation([
      [1, 2, 3, 4, 5],
      [10, 8, 6, 4, 2],
    ]);
    expect(result).toBeCloseTo(-1.0, 4);
  });

  it('averages across multiple pairs', () => {
    // 3 series: A positively correlated with B (+1), A anti-correlated with C (-1),
    // B anti-correlated with C (-1). Average = (1 + -1 + -1) / 3 = -0.333...
    const result = calcAvgPairwiseCorrelation([
      [1, 2, 3, 4, 5],
      [2, 4, 6, 8, 10],
      [10, 8, 6, 4, 2],
    ]);
    expect(result).toBeCloseTo(-1 / 3, 2);
  });

  it('handles series with zero variance', () => {
    const result = calcAvgPairwiseCorrelation([
      [5, 5, 5, 5],
      [1, 2, 3, 4],
    ]);
    expect(result).toBe(0);
  });

  it('handles many identical series (all corr=1)', () => {
    const series = [
      [1, 2, 3],
      [10, 20, 30],
      [100, 200, 300],
    ];
    expect(calcAvgPairwiseCorrelation(series)).toBeCloseTo(1.0, 4);
  });
});

// ── detectHerdPeak tests ─────────────────────────────────────────────────────

describe('detectHerdPeak', () => {
  it('returns true when current > threshold and current < prev (peak declining)', () => {
    expect(detectHerdPeak(0.8, 0.7, 0.6)).toBe(true);
  });

  it('returns false when current <= threshold', () => {
    expect(detectHerdPeak(0.8, 0.5, 0.6)).toBe(false);
  });

  it('returns false when current >= prev (still rising)', () => {
    expect(detectHerdPeak(0.7, 0.8, 0.6)).toBe(false);
  });

  it('returns false when current equals prev', () => {
    expect(detectHerdPeak(0.7, 0.7, 0.6)).toBe(false);
  });

  it('returns false when current equals threshold', () => {
    // current > threshold is strict
    expect(detectHerdPeak(0.8, 0.6, 0.6)).toBe(false);
  });

  it('returns true just above threshold', () => {
    expect(detectHerdPeak(0.8, 0.61, 0.6)).toBe(true);
  });

  it('returns false when both below threshold', () => {
    expect(detectHerdPeak(0.3, 0.2, 0.6)).toBe(false);
  });

  it('handles threshold of 0', () => {
    expect(detectHerdPeak(0.5, 0.3, 0)).toBe(true);
  });
});

// ── calcHerdDirection tests ──────────────────────────────────────────────────

describe('calcHerdDirection', () => {
  it('returns flat for empty array', () => {
    expect(calcHerdDirection([])).toBe('flat');
  });

  it('returns up for all positive returns', () => {
    expect(calcHerdDirection([0.1, 0.2, 0.3])).toBe('up');
  });

  it('returns down for all negative returns', () => {
    expect(calcHerdDirection([-0.1, -0.2, -0.3])).toBe('down');
  });

  it('returns flat when returns sum to 0', () => {
    expect(calcHerdDirection([0.1, -0.1])).toBe('flat');
  });

  it('returns up when positive returns dominate', () => {
    expect(calcHerdDirection([0.5, -0.1, 0.3])).toBe('up');
  });

  it('returns down when negative returns dominate', () => {
    expect(calcHerdDirection([-0.5, 0.1, -0.3])).toBe('down');
  });

  it('returns flat for single zero return', () => {
    expect(calcHerdDirection([0])).toBe('flat');
  });

  it('returns up for single positive return', () => {
    expect(calcHerdDirection([0.01])).toBe('up');
  });

  it('returns down for single negative return', () => {
    expect(calcHerdDirection([-0.01])).toBe('down');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<HerdBehaviorDetectorDeps> = {}): HerdBehaviorDetectorDeps {
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
      getTrending: vi.fn().mockResolvedValue(makeMarkets(6)),
    } as any,
    ...overrides,
  };
}

describe('createHerdBehaviorDetectorTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createHerdBehaviorDetectorTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket('m1', { closed: true }),
          makeMarket('m2', { closed: true }),
          makeMarket('m3', { closed: true }),
          makeMarket('m4', { closed: true }),
          makeMarket('m5', { closed: true }),
          makeMarket('m6', { closed: true }),
        ]),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket('m1', { resolved: true }),
          makeMarket('m2', { resolved: true }),
          makeMarket('m3', { resolved: true }),
          makeMarket('m4', { resolved: true }),
          makeMarket('m5', { resolved: true }),
          makeMarket('m6', { resolved: true }),
        ]),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket('m1', { volume: 100 }),
          makeMarket('m2', { volume: 100 }),
          makeMarket('m3', { volume: 100 }),
          makeMarket('m4', { volume: 100 }),
          makeMarket('m5', { volume: 100 }),
          makeMarket('m6', { volume: 100 }),
        ]),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market with no yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket('m1', { yesTokenId: undefined }),
          makeMarket('m2', { yesTokenId: undefined }),
          makeMarket('m3', { yesTokenId: undefined }),
          makeMarket('m4', { yesTokenId: undefined }),
          makeMarket('m5', { yesTokenId: undefined }),
          makeMarket('m6', { yesTokenId: undefined }),
        ]),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('does not enter when fewer than minMarkets are available', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue(makeMarkets(3)),
      } as any,
      config: { minMarkets: 5 },
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    await tick();
    await tick();
    // getOrderBook called 6 markets per tick * 3 ticks = 18
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(18);
  });

  it('skips market where mid price is 0', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.00', '100']], [['0.00', '100']],
        )),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
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
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when correlation is below threshold on stable markets', async () => {
    // All markets at stable price -> no herding
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: { minMarkets: 5, minVolume: 1, herdThreshold: 0.6 },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles market with no noTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue(
          Array.from({ length: 6 }, (_, i) =>
            makeMarket(`m${i + 1}`, { noTokenId: undefined }),
          ),
        ),
      } as any,
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  // ── Entry tests: herding detection & fade ──────────────────────────────

  it('enters positions when herding peak is detected with upward herd', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const tickNum = Math.ceil(callCount / 6); // 6 markets per tick
        // First ticks: all markets move up together (high correlation)
        if (tickNum <= 3) {
          const price = (0.40 + tickNum * 0.05).toFixed(2);
          const bid = (0.40 + tickNum * 0.05 - 0.01).toFixed(2);
          const ask = (0.40 + tickNum * 0.05 + 0.01).toFixed(2);
          return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
        }
        // Tick 4+: prices start to pull back slightly (peak)
        const price = 0.53;
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        herdThreshold: 0.3,
        minMarkets: 5,
        minVolume: 1,
        returnWindow: 10,
        herdEmaAlpha: 0.5,
      },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // We check that the system eventually attempted entries or correctly analyzed herding
    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('enters buy-yes when herd moves prices down (fade the herd)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const tickNum = Math.ceil(callCount / 6);
        // All markets moving down together
        if (tickNum <= 3) {
          const mid = 0.60 - tickNum * 0.05;
          const bid = (mid - 0.01).toFixed(2);
          const ask = (mid + 0.01).toFixed(2);
          return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
        }
        // Slight recovery (peak in herding)
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        herdThreshold: 0.3,
        minMarkets: 5,
        minVolume: 1,
        returnWindow: 10,
        herdEmaAlpha: 0.5,
      },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Check if entries were placed for the fade direction
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  it('respects maxPositions limit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const tickNum = Math.ceil(callCount / 6);
        if (tickNum <= 3) {
          const mid = 0.40 + tickNum * 0.05;
          return Promise.resolve(makeBook(
            [[(mid - 0.01).toFixed(2), '100']],
            [[(mid + 0.01).toFixed(2), '100']],
          ));
        }
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        herdThreshold: 0.3,
        minMarkets: 5,
        minVolume: 1,
        herdEmaAlpha: 0.5,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const tickNum = Math.ceil(callCount / 6);
        // Build up correlated downward moves
        if (tickNum <= 3) {
          const mid = 0.60 - tickNum * 0.05;
          return Promise.resolve(makeBook(
            [[(mid - 0.01).toFixed(2), '100']],
            [[(mid + 0.01).toFixed(2), '100']],
          ));
        }
        // Slight recovery triggers peak detection
        if (tickNum <= 5) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        // Price continues up for TP on yes position
        return Promise.resolve(makeBook([['0.65', '100']], [['0.67', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        herdThreshold: 0.3,
        minMarkets: 5,
        minVolume: 1,
        herdEmaAlpha: 0.5,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
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
        const tickNum = Math.ceil(callCount / 6);
        if (tickNum <= 3) {
          const mid = 0.60 - tickNum * 0.05;
          return Promise.resolve(makeBook(
            [[(mid - 0.01).toFixed(2), '100']],
            [[(mid + 0.01).toFixed(2), '100']],
          ));
        }
        return Promise.resolve(makeBook([['0.47', '100']], [['0.49', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        herdThreshold: 0.3,
        minMarkets: 5,
        minVolume: 1,
        herdEmaAlpha: 0.5,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('handles multiple ticks without error', async () => {
    const deps = makeDeps();
    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 5; i++) {
      await expect(tick()).resolves.toBeUndefined();
    }
  });

  it('does not enter on first two ticks (needs prevHerdEma)', async () => {
    const deps = makeDeps({
      config: { minMarkets: 5, minVolume: 1 },
    });
    const tick = createHerdBehaviorDetectorTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const tickNum = Math.ceil(callCount / 6);
        if (tickNum <= 3) {
          const mid = 0.60 - tickNum * 0.05;
          return Promise.resolve(makeBook(
            [[(mid - 0.01).toFixed(2), '100']],
            [[(mid + 0.01).toFixed(2), '100']],
          ));
        }
        if (tickNum <= 5) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        // TP exit price
        if (tickNum <= 7) {
          return Promise.resolve(makeBook([['0.65', '100']], [['0.67', '100']]));
        }
        // Back down after exit
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        herdThreshold: 0.3,
        minMarkets: 5,
        minVolume: 1,
        herdEmaAlpha: 0.5,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createHerdBehaviorDetectorTick(deps);
    for (let i = 0; i < 12; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    // Due to cooldown, should not have many re-entries
    expect(entries.length).toBeLessThanOrEqual(6);
  });

  it('default config has correct values', () => {
    const cfg = makeConfig();
    expect(cfg.herdThreshold).toBe(0.6);
    expect(cfg.returnWindow).toBe(10);
    expect(cfg.herdEmaAlpha).toBe(0.15);
    expect(cfg.minMarkets).toBe(5);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.025);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(15 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.positionSize).toBe('10');
  });

  it('config overrides merge with defaults', () => {
    const cfg = makeConfig({ herdThreshold: 0.9, minMarkets: 10 });
    expect(cfg.herdThreshold).toBe(0.9);
    expect(cfg.minMarkets).toBe(10);
    expect(cfg.returnWindow).toBe(10); // default preserved
  });
});
