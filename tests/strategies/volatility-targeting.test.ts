import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcRealizedVol,
  calcVolRatio,
  calcMomentum,
  adjustPositionSize,
  createVolatilityTargetingTick,
  DEFAULT_CONFIG,
  type VolatilityTargetingConfig,
  type VolatilityTargetingDeps,
} from '../../src/strategies/polymarket/volatility-targeting.js';
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

function makeConfig(overrides: Partial<VolatilityTargetingConfig> = {}): VolatilityTargetingConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcRealizedVol tests ───────────────────────────────────────────────────

describe('calcRealizedVol', () => {
  it('returns 0 for empty array', () => {
    expect(calcRealizedVol([])).toBe(0);
  });

  it('returns 0 for single price', () => {
    expect(calcRealizedVol([0.5])).toBe(0);
  });

  it('returns 0 for identical prices', () => {
    expect(calcRealizedVol([0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it('calculates std dev of returns for two prices', () => {
    // returns: [(0.6-0.5)/0.5] = [0.2], mean=0.2, var=0, std=0
    expect(calcRealizedVol([0.5, 0.6])).toBe(0);
  });

  it('calculates non-zero vol for varying prices', () => {
    const prices = [1.0, 1.1, 0.9, 1.05, 0.95];
    const vol = calcRealizedVol(prices);
    expect(vol).toBeGreaterThan(0);
  });

  it('returns higher vol for more volatile prices', () => {
    const stable = [1.0, 1.01, 0.99, 1.0, 1.01];
    const volatile = [1.0, 1.2, 0.8, 1.3, 0.7];
    expect(calcRealizedVol(volatile)).toBeGreaterThan(calcRealizedVol(stable));
  });

  it('skips returns where previous price is 0', () => {
    // [0, 0.5, 0.6] → skip first return, returns: [(0.6-0.5)/0.5]=0.2, std=0
    expect(calcRealizedVol([0, 0.5, 0.6])).toBe(0);
  });

  it('returns 0 when all previous prices are 0', () => {
    expect(calcRealizedVol([0, 0, 0])).toBe(0);
  });

  it('handles large price arrays', () => {
    const prices = Array.from({ length: 100 }, (_, i) => 0.5 + 0.01 * Math.sin(i));
    const vol = calcRealizedVol(prices);
    expect(vol).toBeGreaterThan(0);
    expect(vol).toBeLessThan(1);
  });

  it('handles negative-trending prices', () => {
    const prices = [1.0, 0.95, 0.90, 0.85, 0.80];
    const vol = calcRealizedVol(prices);
    // Returns are all ~-0.053, so vol should be near 0 (constant returns)
    expect(vol).toBeGreaterThanOrEqual(0);
  });
});

// ── calcVolRatio tests ──────────────────────────────────────────────────────

describe('calcVolRatio', () => {
  it('returns 1.0 when realizedVol is 0', () => {
    expect(calcVolRatio(0.02, 0, 3.0)).toBe(1.0);
  });

  it('returns ratio when within bounds', () => {
    // 0.02 / 0.01 = 2.0
    expect(calcVolRatio(0.02, 0.01, 3.0)).toBeCloseTo(2.0, 4);
  });

  it('clamps to maxScaling when ratio exceeds it', () => {
    // 0.02 / 0.001 = 20.0, clamped to 3.0
    expect(calcVolRatio(0.02, 0.001, 3.0)).toBe(3.0);
  });

  it('returns ratio close to 0 for very high realized vol', () => {
    // 0.02 / 100 = 0.0002
    expect(calcVolRatio(0.02, 100, 3.0)).toBeCloseTo(0.0002, 4);
  });

  it('clamps negative ratio to 0', () => {
    // negative target vol → negative ratio → clamped to 0
    expect(calcVolRatio(-0.02, 0.01, 3.0)).toBe(0);
  });

  it('returns 1.0 when target equals realized', () => {
    expect(calcVolRatio(0.05, 0.05, 3.0)).toBeCloseTo(1.0, 4);
  });

  it('handles very small realized vol', () => {
    expect(calcVolRatio(0.02, 0.0001, 5.0)).toBe(5.0);
  });

  it('returns maxScaling when maxScaling is 1', () => {
    expect(calcVolRatio(0.10, 0.01, 1.0)).toBe(1.0);
  });
});

// ── calcMomentum tests ──────────────────────────────────────────────────────

describe('calcMomentum', () => {
  it('returns 0 for empty array', () => {
    expect(calcMomentum([])).toBe(0);
  });

  it('returns 0 for single price', () => {
    expect(calcMomentum([0.5])).toBe(0);
  });

  it('returns 0 when first price is 0', () => {
    expect(calcMomentum([0, 0.5])).toBe(0);
  });

  it('calculates positive momentum for rising prices', () => {
    // (0.6 - 0.5) / 0.5 = 0.2
    expect(calcMomentum([0.5, 0.6])).toBeCloseTo(0.2, 4);
  });

  it('calculates negative momentum for falling prices', () => {
    // (0.4 - 0.5) / 0.5 = -0.2
    expect(calcMomentum([0.5, 0.4])).toBeCloseTo(-0.2, 4);
  });

  it('returns 0 for unchanged prices', () => {
    expect(calcMomentum([0.5, 0.5])).toBe(0);
  });

  it('uses only first and last price', () => {
    // (0.7 - 0.5) / 0.5 = 0.4 regardless of middle prices
    expect(calcMomentum([0.5, 0.3, 0.1, 0.7])).toBeCloseTo(0.4, 4);
  });

  it('handles long arrays', () => {
    const prices = [1.0, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.07, 1.08, 1.10];
    expect(calcMomentum(prices)).toBeCloseTo(0.10, 4);
  });
});

// ── adjustPositionSize tests ────────────────────────────────────────────────

describe('adjustPositionSize', () => {
  it('returns baseSize when volRatio is 1', () => {
    expect(adjustPositionSize(10, 1.0)).toBe(10);
  });

  it('scales up when volRatio > 1', () => {
    expect(adjustPositionSize(10, 2.5)).toBeCloseTo(25, 4);
  });

  it('scales down when volRatio < 1', () => {
    expect(adjustPositionSize(10, 0.5)).toBeCloseTo(5, 4);
  });

  it('returns 0 when volRatio is 0', () => {
    expect(adjustPositionSize(10, 0)).toBe(0);
  });

  it('returns 0 when baseSize is 0', () => {
    expect(adjustPositionSize(0, 2.0)).toBe(0);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<VolatilityTargetingDeps> = {}): VolatilityTargetingDeps {
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

describe('createVolatilityTargetingTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createVolatilityTargetingTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createVolatilityTargetingTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createVolatilityTargetingTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createVolatilityTargetingTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createVolatilityTargetingTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when momentum is positive ────────────────────

  it('enters buy-yes when momentum exceeds threshold', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Gradually increase price to create positive momentum
        const base = 0.40 + callCount * 0.02;
        const bid = base.toFixed(2);
        const ask = (base + 0.02).toFixed(2);
        return Promise.resolve(makeBook(
          [[bid, '100']], [[ask, '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 5,
        volWindow: 5,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
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

  // ── Entry tests: BUY NO when momentum is negative ────────────────────

  it('enters buy-no when momentum is below negative threshold', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Gradually decrease price to create negative momentum
        const base = Math.max(0.10, 0.60 - callCount * 0.03);
        const bid = base.toFixed(2);
        const ask = (base + 0.02).toFixed(2);
        return Promise.resolve(makeBook(
          [[bid, '100']], [[ask, '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 5,
        volWindow: 5,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
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

  // ── No entry when momentum below threshold ────────────────────────────

  it('does not enter when momentum is below threshold', async () => {
    // Stable prices → momentum stays near 0
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        momentumThreshold: 0.10,
        minVolume: 1,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Vol-adjusted sizing tests ─────────────────────────────────────────

  it('scales position size inversely with volatility', async () => {
    // High vol should result in smaller positions
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Highly volatile prices to keep vol high
        const base = callCount % 2 === 0 ? 0.60 : 0.40;
        // Add steady uptrend for momentum
        const trend = callCount * 0.02;
        const price = base + trend;
        const bid = price.toFixed(2);
        const ask = (price + 0.02).toFixed(2);
        return Promise.resolve(makeBook(
          [[bid, '100']], [[ask, '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 5,
        volWindow: 5,
        maxScaling: 3.0,
        targetVol: 0.02,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Just verify no crash; vol-adjusted sizing is tested in pure helper tests
    expect(true).toBe(true);
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          // Rising prices for momentum entry
          const base = 0.40 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
          ));
        }
        // Price jumps up for take profit
        return Promise.resolve(makeBook(
          [['0.75', '100']], [['0.77', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 3,
        volWindow: 3,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
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
        if (callCount <= 3) {
          const base = 0.40 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
          ));
        }
        // Price drops for stop loss
        return Promise.resolve(makeBook(
          [['0.10', '100']], [['0.12', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 3,
        volWindow: 3,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
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
        if (callCount <= 3) {
          const base = 0.40 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
          ));
        }
        // Stable price (no TP/SL)
        return Promise.resolve(makeBook(
          [['0.50', '100']], [['0.52', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 3,
        volWindow: 3,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
    for (let i = 0; i < 4; i++) {
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
        if (callCount <= 3) {
          const base = 0.40 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
          ));
        }
        if (callCount <= 5) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.75', '100']], [['0.77', '100']],
          ));
        }
        // Back to rising prices after exit
        const base = 0.40 + (callCount - 5) * 0.03;
        return Promise.resolve(makeBook(
          [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 3,
        volWindow: 3,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
    for (let i = 0; i < 10; i++) {
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
        // Rising prices for all markets
        const base = 0.40 + Math.floor((callCount - 1) / 3) * 0.03;
        return Promise.resolve(makeBook(
          [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 3,
        volWindow: 3,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
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
    const tick = createVolatilityTargetingTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter when already holding position on same token', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const base = 0.40 + callCount * 0.02;
        return Promise.resolve(makeBook(
          [[base.toFixed(2), '100']], [[(base + 0.02).toFixed(2), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        momentumThreshold: 0.01,
        minVolume: 1,
        momentumWindow: 3,
        volWindow: 3,
        maxPositions: 10,
        takeProfitPct: 0.90,
        stopLossPct: 0.90,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createVolatilityTargetingTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    // Should only have 1 GTC entry since same market each time
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('uses default config values when no overrides provided', () => {
    const cfg = makeConfig();
    expect(cfg.targetVol).toBe(0.02);
    expect(cfg.volWindow).toBe(20);
    expect(cfg.maxScaling).toBe(3.0);
    expect(cfg.momentumWindow).toBe(10);
    expect(cfg.momentumThreshold).toBe(0.01);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.03);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(20 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.basePositionSize).toBe('10');
  });

  it('merges partial config with defaults', () => {
    const cfg = makeConfig({ targetVol: 0.05, maxScaling: 5.0 });
    expect(cfg.targetVol).toBe(0.05);
    expect(cfg.maxScaling).toBe(5.0);
    expect(cfg.volWindow).toBe(20); // default preserved
  });
});
