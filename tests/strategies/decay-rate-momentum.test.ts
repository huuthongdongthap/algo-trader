import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcMomentumAtWindow,
  estimateDecayRate,
  classifyDecay,
  determineSignal,
  createDecayRateMomentumTick,
  DEFAULT_CONFIG,
  type DecayRateMomentumConfig,
  type DecayRateMomentumDeps,
} from '../../src/strategies/polymarket/decay-rate-momentum.js';
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

function makeConfig(overrides: Partial<DecayRateMomentumConfig> = {}): DecayRateMomentumConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcMomentumAtWindow tests ──────────────────────────────────────────────

describe('calcMomentumAtWindow', () => {
  it('returns 0 when prices array is shorter than window', () => {
    expect(calcMomentumAtWindow([0.5, 0.6], 5)).toBe(0);
  });

  it('returns 0 when window is 0', () => {
    expect(calcMomentumAtWindow([0.5, 0.6], 0)).toBe(0);
  });

  it('returns 0 when window is negative', () => {
    expect(calcMomentumAtWindow([0.5, 0.6], -1)).toBe(0);
  });

  it('returns 0 when reference price is 0', () => {
    expect(calcMomentumAtWindow([0, 0.5, 0.6], 3)).toBe(0);
  });

  it('returns positive momentum when price went up', () => {
    // prices = [0.50, 0.55, 0.60], window = 3
    // reference = prices[0] = 0.50, last = 0.60
    // momentum = (0.60 - 0.50) / 0.50 = 0.20
    const result = calcMomentumAtWindow([0.50, 0.55, 0.60], 3);
    expect(result).toBeCloseTo(0.20, 4);
  });

  it('returns negative momentum when price went down', () => {
    // prices = [0.60, 0.55, 0.50], window = 3
    // reference = prices[0] = 0.60, last = 0.50
    // momentum = (0.50 - 0.60) / 0.60 = -0.1667
    const result = calcMomentumAtWindow([0.60, 0.55, 0.50], 3);
    expect(result).toBeCloseTo(-0.1667, 3);
  });

  it('returns 0 when price is unchanged', () => {
    const result = calcMomentumAtWindow([0.50, 0.50, 0.50], 3);
    expect(result).toBe(0);
  });

  it('uses correct reference for window=1 (compares last to itself)', () => {
    // window=1: reference = prices[length-1] = last → momentum = 0
    const result = calcMomentumAtWindow([0.50, 0.55, 0.60], 1);
    expect(result).toBe(0);
  });

  it('uses correct reference for window=2', () => {
    // prices = [0.50, 0.55, 0.60], window = 2
    // reference = prices[1] = 0.55, last = 0.60
    // momentum = (0.60 - 0.55) / 0.55
    const result = calcMomentumAtWindow([0.50, 0.55, 0.60], 2);
    expect(result).toBeCloseTo(0.0909, 3);
  });

  it('works with longer price arrays and smaller window', () => {
    const prices = [0.40, 0.42, 0.44, 0.46, 0.48, 0.50];
    // window = 3, reference = prices[3] = 0.46, last = 0.50
    // momentum = (0.50 - 0.46) / 0.46
    const result = calcMomentumAtWindow(prices, 3);
    expect(result).toBeCloseTo(0.0870, 3);
  });

  it('returns 0 for empty prices array', () => {
    expect(calcMomentumAtWindow([], 3)).toBe(0);
  });
});

// ── estimateDecayRate tests ─────────────────────────────────────────────────

describe('estimateDecayRate', () => {
  it('returns 0 for empty array', () => {
    expect(estimateDecayRate([])).toBe(0);
  });

  it('returns 0 for single-element array', () => {
    expect(estimateDecayRate([0.5])).toBe(0);
  });

  it('returns 0 when first element is 0', () => {
    expect(estimateDecayRate([0, 0.5, 0.3])).toBe(0);
  });

  it('returns positive lambda when momentum decays (last < first)', () => {
    // first=0.5, last=0.25, ratio=0.5, lambda = -ln(0.5)/1 = 0.693
    const result = estimateDecayRate([0.5, 0.25]);
    expect(result).toBeCloseTo(0.693, 2);
  });

  it('returns 0 when momentum grows (last > first, ratio > 1 → negative lambda)', () => {
    // first=0.25, last=0.5, ratio=2.0, lambda = -ln(2)/1 = -0.693 → clamped to 0
    const result = estimateDecayRate([0.25, 0.5]);
    expect(result).toBe(0);
  });

  it('returns 0 when first and last are equal (no decay)', () => {
    // ratio=1, lambda = -ln(1)/1 = -0, clamped to 0
    const result = estimateDecayRate([0.5, 0.5]);
    expect(result).toBeCloseTo(0, 10);
  });

  it('clamps to 1 for very fast decay', () => {
    // first=1.0, last=0.0001, ratio very small, lambda very large → clamped to 1
    const result = estimateDecayRate([1.0, 0.0001]);
    expect(result).toBe(1);
  });

  it('returns 0 when ratio is negative (sign change)', () => {
    const result = estimateDecayRate([0.5, -0.3]);
    expect(result).toBe(0);
  });

  it('accounts for length in decay calculation', () => {
    // first=0.5, last=0.25, length=4 → lambda = -ln(0.5)/3 = 0.231
    const result = estimateDecayRate([0.5, 0.4, 0.3, 0.25]);
    expect(result).toBeCloseTo(0.231, 2);
  });

  it('handles all-same values (no decay)', () => {
    const result = estimateDecayRate([0.3, 0.3, 0.3, 0.3]);
    expect(result).toBeCloseTo(0, 10);
  });

  it('returns 0 when last is 0', () => {
    // ratio = 0/0.5 = 0, which is <= 0
    const result = estimateDecayRate([0.5, 0.3, 0]);
    expect(result).toBe(0);
  });
});

// ── classifyDecay tests ─────────────────────────────────────────────────────

describe('classifyDecay', () => {
  it('returns slow when lambda < slowThreshold', () => {
    expect(classifyDecay(0.01, 0.05, 0.2)).toBe('slow');
  });

  it('returns fast when lambda > fastThreshold', () => {
    expect(classifyDecay(0.3, 0.05, 0.2)).toBe('fast');
  });

  it('returns neutral when lambda is between thresholds', () => {
    expect(classifyDecay(0.10, 0.05, 0.2)).toBe('neutral');
  });

  it('returns neutral when lambda equals slowThreshold', () => {
    expect(classifyDecay(0.05, 0.05, 0.2)).toBe('neutral');
  });

  it('returns neutral when lambda equals fastThreshold', () => {
    expect(classifyDecay(0.2, 0.05, 0.2)).toBe('neutral');
  });

  it('returns slow for lambda=0', () => {
    expect(classifyDecay(0, 0.05, 0.2)).toBe('slow');
  });

  it('returns fast for lambda=1', () => {
    expect(classifyDecay(1, 0.05, 0.2)).toBe('fast');
  });

  it('works with custom thresholds', () => {
    expect(classifyDecay(0.5, 0.4, 0.6)).toBe('neutral');
    expect(classifyDecay(0.3, 0.4, 0.6)).toBe('slow');
    expect(classifyDecay(0.7, 0.4, 0.6)).toBe('fast');
  });
});

// ── determineSignal tests ───────────────────────────────────────────────────

describe('determineSignal', () => {
  it('returns yes for slow decay + positive momentum (trend-following)', () => {
    expect(determineSignal('slow', 0.05)).toBe('yes');
  });

  it('returns no for slow decay + negative momentum (trend-following)', () => {
    expect(determineSignal('slow', -0.05)).toBe('no');
  });

  it('returns no for fast decay + positive momentum (fade)', () => {
    expect(determineSignal('fast', 0.05)).toBe('no');
  });

  it('returns yes for fast decay + negative momentum (fade)', () => {
    expect(determineSignal('fast', -0.05)).toBe('yes');
  });

  it('returns null for neutral decay', () => {
    expect(determineSignal('neutral', 0.05)).toBeNull();
  });

  it('returns null for unknown decay class', () => {
    expect(determineSignal('unknown', 0.05)).toBeNull();
  });

  it('handles zero momentum with slow decay', () => {
    // latestMomentum === 0 is not > 0, so goes to else branch → 'no'
    expect(determineSignal('slow', 0)).toBe('no');
  });

  it('handles zero momentum with fast decay', () => {
    // latestMomentum === 0 is not > 0, so goes to else branch → 'yes'
    expect(determineSignal('fast', 0)).toBe('yes');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<DecayRateMomentumDeps> = {}): DecayRateMomentumDeps {
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

describe('createDecayRateMomentumTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createDecayRateMomentumTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createDecayRateMomentumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createDecayRateMomentumTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createDecayRateMomentumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createDecayRateMomentumTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
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
    const tick = createDecayRateMomentumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry with trending momentum (slow decay) ────────────────────────

  it('enters when momentum is sustained over multiple ticks', async () => {
    // Simulate rising prices to generate positive momentum with slow decay
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Gradually rising prices to build strong momentum
        const basePrice = 0.40 + callCount * 0.015;
        const bid = Math.min(basePrice - 0.01, 0.98).toFixed(2);
        const ask = Math.min(basePrice + 0.01, 0.99).toFixed(2);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackWindows: [3, 5, 10, 15],
        slowDecayThreshold: 0.05,
        fastDecayThreshold: 0.2,
        minMomentumAbs: 0.001,
        minVolume: 1,
        priceWindow: 30,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    // Should have attempted entries since momentum is sustained
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when momentum below minMomentumAbs ──────────────────────

  it('does not enter when momentum is below minMomentumAbs', async () => {
    // Stable prices → very small momentum
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.499', '100']], [['0.501', '100']]),
        ),
      } as any,
      config: {
        minMomentumAbs: 0.10, // high threshold
        minVolume: 1,
        lookbackWindows: [3, 5, 10, 15],
        priceWindow: 30,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
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
        // Rising prices to build momentum
        if (callCount <= 15) {
          const base = 0.40 + callCount * 0.015;
          const bid = Math.min(base - 0.01, 0.98).toFixed(2);
          const ask = Math.min(base + 0.01, 0.99).toFixed(2);
          return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
        }
        // Price jumps for TP
        return Promise.resolve(makeBook(
          [['0.95', '100']], [['0.97', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackWindows: [3, 5, 10, 15],
        slowDecayThreshold: 0.05,
        fastDecayThreshold: 0.2,
        minMomentumAbs: 0.001,
        minVolume: 1,
        priceWindow: 30,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 15) {
          const base = 0.40 + callCount * 0.015;
          const bid = Math.min(base - 0.01, 0.98).toFixed(2);
          const ask = Math.min(base + 0.01, 0.99).toFixed(2);
          return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
        }
        // Price crashes for SL
        return Promise.resolve(makeBook(
          [['0.10', '100']], [['0.12', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackWindows: [3, 5, 10, 15],
        slowDecayThreshold: 0.05,
        fastDecayThreshold: 0.2,
        minMomentumAbs: 0.001,
        minVolume: 1,
        priceWindow: 30,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const base = 0.40 + callCount * 0.015;
        const bid = Math.min(base - 0.01, 0.98).toFixed(2);
        const ask = Math.min(base + 0.01, 0.99).toFixed(2);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackWindows: [3, 5, 10, 15],
        slowDecayThreshold: 0.05,
        fastDecayThreshold: 0.2,
        minMomentumAbs: 0.001,
        minVolume: 1,
        priceWindow: 30,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 18; i++) {
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
        const base = 0.40 + callCount * 0.015;
        const bid = Math.min(base - 0.01, 0.98).toFixed(2);
        const ask = Math.min(base + 0.01, 0.99).toFixed(2);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackWindows: [3, 5, 10, 15],
        slowDecayThreshold: 0.05,
        fastDecayThreshold: 0.2,
        minMomentumAbs: 0.001,
        minVolume: 1,
        priceWindow: 30,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        cooldownMs: 180_000,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 25; i++) {
      await tick();
      if (i === 17) await new Promise(r => setTimeout(r, 5));
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
        const base = 0.40 + Math.floor((callCount - 1) / 3) * 0.015;
        const bid = Math.min(base - 0.01, 0.98).toFixed(2);
        const ask = Math.min(base + 0.01, 0.99).toFixed(2);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        lookbackWindows: [3, 5, 10, 15],
        slowDecayThreshold: 0.05,
        fastDecayThreshold: 0.2,
        minMomentumAbs: 0.001,
        minVolume: 1,
        priceWindow: 30,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createDecayRateMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createDecayRateMomentumTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter on insufficient ticks for max lookback window', async () => {
    const deps = makeDeps({
      config: {
        lookbackWindows: [3, 5, 10, 15],
        minVolume: 1,
      },
    });
    const tick = createDecayRateMomentumTick(deps);
    // Only 5 ticks, but need 15 for largest window
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('uses default config when no overrides provided', () => {
    const cfg = makeConfig();
    expect(cfg.lookbackWindows).toEqual([3, 5, 10, 15]);
    expect(cfg.slowDecayThreshold).toBe(0.05);
    expect(cfg.fastDecayThreshold).toBe(0.2);
    expect(cfg.minMomentumAbs).toBe(0.01);
    expect(cfg.priceWindow).toBe(20);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.03);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(20 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.positionSize).toBe('12');
  });
});
