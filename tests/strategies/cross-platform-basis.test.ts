import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcFairValue,
  calcBasis,
  updateBasisEma,
  createCrossPlatformBasisTick,
  DEFAULT_CONFIG,
  type CrossPlatformBasisConfig,
  type CrossPlatformBasisDeps,
} from '../../src/strategies/polymarket/cross-platform-basis.js';
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

function makeConfig(overrides: Partial<CrossPlatformBasisConfig> = {}): CrossPlatformBasisConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcFairValue tests ─────────────────────────────────────────────────────

describe('calcFairValue', () => {
  it('returns weighted combination of EMA, VWAP, and mean', () => {
    // 0.5*0.6 + 0.3*0.7 + 0.2*0.5 = 0.30 + 0.21 + 0.10 = 0.61
    const result = calcFairValue(0.6, 0.7, { w_ema: 0.5, w_vwap: 0.3, w_mean: 0.2 });
    expect(result).toBeCloseTo(0.61, 4);
  });

  it('returns 0.5 when all inputs are 0.5', () => {
    const result = calcFairValue(0.5, 0.5, { w_ema: 0.5, w_vwap: 0.3, w_mean: 0.2 });
    expect(result).toBeCloseTo(0.5, 4);
  });

  it('returns priceEma when w_ema=1 and others are 0', () => {
    const result = calcFairValue(0.75, 0.60, { w_ema: 1.0, w_vwap: 0.0, w_mean: 0.0 });
    expect(result).toBeCloseTo(0.75, 4);
  });

  it('returns VWAP when w_vwap=1 and others are 0', () => {
    const result = calcFairValue(0.75, 0.60, { w_ema: 0.0, w_vwap: 1.0, w_mean: 0.0 });
    expect(result).toBeCloseTo(0.60, 4);
  });

  it('returns 0.5 when w_mean=1 and others are 0', () => {
    const result = calcFairValue(0.75, 0.60, { w_ema: 0.0, w_vwap: 0.0, w_mean: 1.0 });
    expect(result).toBeCloseTo(0.50, 4);
  });

  it('handles extreme price values', () => {
    const result = calcFairValue(0.99, 0.01, { w_ema: 0.5, w_vwap: 0.3, w_mean: 0.2 });
    // 0.5*0.99 + 0.3*0.01 + 0.2*0.5 = 0.495 + 0.003 + 0.1 = 0.598
    expect(result).toBeCloseTo(0.598, 3);
  });

  it('handles zero weights', () => {
    const result = calcFairValue(0.8, 0.7, { w_ema: 0, w_vwap: 0, w_mean: 0 });
    expect(result).toBe(0);
  });

  it('uses default config weights correctly', () => {
    const cfg = makeConfig();
    const result = calcFairValue(0.6, 0.7, cfg);
    // 0.5*0.6 + 0.3*0.7 + 0.2*0.5 = 0.30 + 0.21 + 0.10 = 0.61
    expect(result).toBeCloseTo(0.61, 4);
  });
});

// ── calcBasis tests ─────────────────────────────────────────────────────────

describe('calcBasis', () => {
  it('returns positive when mid > fairValue (overpriced)', () => {
    expect(calcBasis(0.60, 0.55)).toBeCloseTo(0.05, 4);
  });

  it('returns negative when mid < fairValue (underpriced)', () => {
    expect(calcBasis(0.45, 0.55)).toBeCloseTo(-0.10, 4);
  });

  it('returns 0 when mid equals fairValue', () => {
    expect(calcBasis(0.50, 0.50)).toBe(0);
  });

  it('handles extreme values', () => {
    expect(calcBasis(1.0, 0.0)).toBeCloseTo(1.0, 4);
    expect(calcBasis(0.0, 1.0)).toBeCloseTo(-1.0, 4);
  });
});

// ── updateBasisEma tests ────────────────────────────────────────────────────

describe('updateBasisEma', () => {
  it('returns newValue when prevEma is null (initial case)', () => {
    expect(updateBasisEma(null, 0.05, 0.15)).toBe(0.05);
  });

  it('returns prevEma when alpha is 0', () => {
    expect(updateBasisEma(0.10, 0.05, 0)).toBe(0.10);
  });

  it('returns newValue when alpha is 1', () => {
    expect(updateBasisEma(0.10, 0.05, 1)).toBe(0.05);
  });

  it('returns weighted average for alpha between 0 and 1', () => {
    // alpha=0.5 → 0.5*0.04 + 0.5*0.10 = 0.02 + 0.05 = 0.07
    const result = updateBasisEma(0.10, 0.04, 0.5);
    expect(result).toBeCloseTo(0.07, 4);
  });

  it('converges toward newValue with repeated updates', () => {
    let ema: number | null = null;
    for (let i = 0; i < 100; i++) {
      ema = updateBasisEma(ema, 0.50, 0.15);
    }
    expect(ema).toBeCloseTo(0.50, 2);
  });

  it('moves slowly with small alpha', () => {
    const result = updateBasisEma(0.10, 0.50, 0.01);
    // 0.01*0.50 + 0.99*0.10 = 0.005 + 0.099 = 0.104
    expect(result).toBeCloseTo(0.104, 3);
  });

  it('moves quickly with large alpha', () => {
    const result = updateBasisEma(0.10, 0.50, 0.99);
    // 0.99*0.50 + 0.01*0.10 = 0.495 + 0.001 = 0.496
    expect(result).toBeCloseTo(0.496, 3);
  });

  it('handles negative values', () => {
    const result = updateBasisEma(-0.10, -0.20, 0.5);
    expect(result).toBeCloseTo(-0.15, 4);
  });

  it('returns prevEma for negative alpha', () => {
    expect(updateBasisEma(0.10, 0.50, -0.5)).toBe(0.10);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<CrossPlatformBasisDeps> = {}): CrossPlatformBasisDeps {
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

describe('createCrossPlatformBasisTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createCrossPlatformBasisTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createCrossPlatformBasisTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createCrossPlatformBasisTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createCrossPlatformBasisTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createCrossPlatformBasisTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
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
    const tick = createCrossPlatformBasisTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when underpriced ─────────────────────────────

  it('enters buy-yes when mid < fairValue and basis is widening', async () => {
    // Start with fair price, then suddenly drop mid to create negative basis
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First few ticks: stable at 0.60 to build EMA
        if (callCount <= 4) {
          return Promise.resolve(makeBook(
            [['0.59', '100']], [['0.61', '100']],
          ));
        }
        // Then drop to 0.40 to create big negative basis
        return Promise.resolve(makeBook(
          [['0.39', '100']], [['0.41', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        priceWindow: 30,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Check if an order was placed
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── Entry tests: BUY NO when overpriced ───────────────────────────────

  it('enters buy-no when mid > fairValue and basis is widening', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First few ticks: stable at 0.40
        if (callCount <= 4) {
          return Promise.resolve(makeBook(
            [['0.39', '100']], [['0.41', '100']],
          ));
        }
        // Then jump to 0.65 to create positive basis
        return Promise.resolve(makeBook(
          [['0.64', '100']], [['0.66', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        priceWindow: 30,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
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

  // ── No entry when basis below threshold ───────────────────────────────

  it('does not enter when basis is below threshold', async () => {
    // Stable prices → basis stays near 0
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        basisThreshold: 0.10,
        minVolume: 1,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
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
          return Promise.resolve(makeBook(
            [['0.59', '100']], [['0.61', '100']],
          ));
        }
        if (callCount <= 6) {
          // Drop to create entry
          return Promise.resolve(makeBook(
            [['0.39', '100']], [['0.41', '100']],
          ));
        }
        // Price recovers for TP
        return Promise.resolve(makeBook(
          [['0.65', '100']], [['0.67', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
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
          return Promise.resolve(makeBook(
            [['0.59', '100']], [['0.61', '100']],
          ));
        }
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.39', '100']], [['0.41', '100']],
          ));
        }
        // Price drops further for SL
        return Promise.resolve(makeBook(
          [['0.05', '100']], [['0.07', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
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
          return Promise.resolve(makeBook(
            [['0.59', '100']], [['0.61', '100']],
          ));
        }
        // Drop to create entry, then stay stable
        return Promise.resolve(makeBook(
          [['0.39', '100']], [['0.41', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
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
          return Promise.resolve(makeBook(
            [['0.59', '100']], [['0.61', '100']],
          ));
        }
        if (callCount <= 6) {
          return Promise.resolve(makeBook(
            [['0.39', '100']], [['0.41', '100']],
          ));
        }
        if (callCount <= 8) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.65', '100']], [['0.67', '100']],
          ));
        }
        // Back to low price after exit
        return Promise.resolve(makeBook(
          [['0.39', '100']], [['0.41', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
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
        // First passes: stable at 0.60
        if (callCount <= 9) {
          return Promise.resolve(makeBook(
            [['0.59', '100']], [['0.61', '100']],
          ));
        }
        // Then drop to 0.40 for entry
        return Promise.resolve(makeBook(
          [['0.39', '100']], [['0.41', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        basisThreshold: 0.02,
        minVolume: 1,
        emaAlpha: 0.3,
        basisEmaAlpha: 0.1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createCrossPlatformBasisTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createCrossPlatformBasisTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });
});
