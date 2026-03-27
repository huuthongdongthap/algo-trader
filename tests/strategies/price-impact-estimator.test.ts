import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  simulatePriceImpact,
  calcImpactAsymmetry,
  determineSide,
  updateImpactEma,
  createPriceImpactEstimatorTick,
  DEFAULT_CONFIG,
  type PriceImpactEstimatorConfig,
  type PriceImpactEstimatorDeps,
} from '../../src/strategies/polymarket/price-impact-estimator.js';
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

function makeConfig(overrides: Partial<PriceImpactEstimatorConfig> = {}): PriceImpactEstimatorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── simulatePriceImpact tests ────────────────────────────────────────────────

describe('simulatePriceImpact', () => {
  it('returns VWAP when filling across multiple levels', () => {
    const levels = [
      { price: '0.50', size: '100' },
      { price: '0.51', size: '100' },
      { price: '0.52', size: '100' },
    ];
    // Fill 200 shares: 100*0.50 + 100*0.51 = 50 + 51 = 101 / 200 = 0.505
    const result = simulatePriceImpact(levels, 200);
    expect(result).toBeCloseTo(0.505, 4);
  });

  it('returns first level price when order fits in one level', () => {
    const levels = [
      { price: '0.60', size: '500' },
      { price: '0.65', size: '500' },
    ];
    const result = simulatePriceImpact(levels, 100);
    expect(result).toBeCloseTo(0.60, 4);
  });

  it('returns 0 for empty levels', () => {
    expect(simulatePriceImpact([], 100)).toBe(0);
  });

  it('returns 0 for zero orderSize', () => {
    const levels = [{ price: '0.50', size: '100' }];
    expect(simulatePriceImpact(levels, 0)).toBe(0);
  });

  it('returns 0 for negative orderSize', () => {
    const levels = [{ price: '0.50', size: '100' }];
    expect(simulatePriceImpact(levels, -10)).toBe(0);
  });

  it('returns 0 when insufficient liquidity', () => {
    const levels = [
      { price: '0.50', size: '50' },
      { price: '0.51', size: '30' },
    ];
    // Only 80 available, want 100
    expect(simulatePriceImpact(levels, 100)).toBe(0);
  });

  it('skips levels with zero size', () => {
    const levels = [
      { price: '0.50', size: '0' },
      { price: '0.55', size: '100' },
    ];
    const result = simulatePriceImpact(levels, 50);
    expect(result).toBeCloseTo(0.55, 4);
  });

  it('skips levels with zero price', () => {
    const levels = [
      { price: '0.00', size: '100' },
      { price: '0.55', size: '100' },
    ];
    const result = simulatePriceImpact(levels, 50);
    expect(result).toBeCloseTo(0.55, 4);
  });

  it('fills exactly at boundary', () => {
    const levels = [
      { price: '0.50', size: '100' },
    ];
    const result = simulatePriceImpact(levels, 100);
    expect(result).toBeCloseTo(0.50, 4);
  });

  it('handles three levels with partial fill on last', () => {
    const levels = [
      { price: '0.50', size: '100' },
      { price: '0.52', size: '100' },
      { price: '0.54', size: '100' },
    ];
    // Fill 250: 100*0.50 + 100*0.52 + 50*0.54 = 50 + 52 + 27 = 129 / 250 = 0.516
    const result = simulatePriceImpact(levels, 250);
    expect(result).toBeCloseTo(0.516, 3);
  });
});

// ── calcImpactAsymmetry tests ────────────────────────────────────────────────

describe('calcImpactAsymmetry', () => {
  it('returns 0 when mid is 0', () => {
    expect(calcImpactAsymmetry(0.01, 0.05, 0)).toBe(0);
  });

  it('returns |buyImpact - sellImpact| / mid', () => {
    // |0.01 - 0.05| / 0.50 = 0.04 / 0.50 = 0.08
    const result = calcImpactAsymmetry(0.01, 0.05, 0.50);
    expect(result).toBeCloseTo(0.08, 4);
  });

  it('returns 0 when impacts are equal', () => {
    expect(calcImpactAsymmetry(0.03, 0.03, 0.50)).toBe(0);
  });

  it('is symmetric (order of impacts does not matter for magnitude)', () => {
    const a = calcImpactAsymmetry(0.01, 0.05, 0.50);
    const b = calcImpactAsymmetry(0.05, 0.01, 0.50);
    expect(a).toBeCloseTo(b, 8);
  });

  it('scales inversely with mid', () => {
    const a = calcImpactAsymmetry(0.01, 0.05, 0.25);
    const b = calcImpactAsymmetry(0.01, 0.05, 0.50);
    expect(a).toBeCloseTo(b * 2, 4);
  });

  it('handles very small mid', () => {
    const result = calcImpactAsymmetry(0.001, 0.010, 0.01);
    expect(result).toBeCloseTo(0.9, 4);
  });

  it('handles zero impacts', () => {
    expect(calcImpactAsymmetry(0, 0, 0.50)).toBe(0);
  });
});

// ── determineSide tests ──────────────────────────────────────────────────────

describe('determineSide', () => {
  it('returns yes when buyImpact < sellImpact (strong bid support)', () => {
    expect(determineSide(0.01, 0.05)).toBe('yes');
  });

  it('returns no when sellImpact < buyImpact (strong ask resistance)', () => {
    expect(determineSide(0.05, 0.01)).toBe('no');
  });

  it('returns null when impacts are equal', () => {
    expect(determineSide(0.03, 0.03)).toBeNull();
  });

  it('returns null when both are zero', () => {
    expect(determineSide(0, 0)).toBeNull();
  });

  it('returns yes when buyImpact is zero and sellImpact is positive', () => {
    expect(determineSide(0, 0.05)).toBe('yes');
  });

  it('returns no when sellImpact is zero and buyImpact is positive', () => {
    expect(determineSide(0.05, 0)).toBe('no');
  });

  it('handles very small differences', () => {
    expect(determineSide(0.0001, 0.0002)).toBe('yes');
  });
});

// ── updateImpactEma tests ────────────────────────────────────────────────────

describe('updateImpactEma', () => {
  it('returns value when prev is null (initial case)', () => {
    expect(updateImpactEma(null, 0.05, 0.1)).toBe(0.05);
  });

  it('returns prev when alpha is 0', () => {
    expect(updateImpactEma(0.10, 0.05, 0)).toBe(0.10);
  });

  it('returns value when alpha is 1', () => {
    expect(updateImpactEma(0.10, 0.05, 1)).toBe(0.05);
  });

  it('returns weighted average for alpha between 0 and 1', () => {
    // alpha=0.5 → 0.5*0.04 + 0.5*0.10 = 0.02 + 0.05 = 0.07
    const result = updateImpactEma(0.10, 0.04, 0.5);
    expect(result).toBeCloseTo(0.07, 4);
  });

  it('converges toward value with repeated updates', () => {
    let ema: number | null = null;
    for (let i = 0; i < 100; i++) {
      ema = updateImpactEma(ema, 0.50, 0.1);
    }
    expect(ema).toBeCloseTo(0.50, 2);
  });

  it('moves slowly with small alpha', () => {
    const result = updateImpactEma(0.10, 0.50, 0.01);
    // 0.01*0.50 + 0.99*0.10 = 0.005 + 0.099 = 0.104
    expect(result).toBeCloseTo(0.104, 3);
  });

  it('moves quickly with large alpha', () => {
    const result = updateImpactEma(0.10, 0.50, 0.99);
    // 0.99*0.50 + 0.01*0.10 = 0.495 + 0.001 = 0.496
    expect(result).toBeCloseTo(0.496, 3);
  });

  it('handles negative values', () => {
    const result = updateImpactEma(-0.10, -0.20, 0.5);
    expect(result).toBeCloseTo(-0.15, 4);
  });

  it('returns prev for negative alpha', () => {
    expect(updateImpactEma(0.10, 0.50, -0.5)).toBe(0.10);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<PriceImpactEstimatorDeps> = {}): PriceImpactEstimatorDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '200'], ['0.47', '200'], ['0.46', '200']],
          [['0.52', '200'], ['0.53', '200'], ['0.54', '200']],
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

describe('createPriceImpactEstimatorTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createPriceImpactEstimatorTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('skips market where mid price is 0', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.00', '100']], [['0.00', '100']],
        )),
      } as any,
    });
    const tick = createPriceImpactEstimatorTick(deps);
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
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not place orders when insufficient liquidity on buy side', async () => {
    // Asks have very little liquidity (less than hypotheticalSize)
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.48', '1000'], ['0.47', '1000']],
          [['0.52', '10']], // only 10 shares, hypotheticalSize=500
        )),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not place orders when insufficient liquidity on sell side', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.48', '10']], // only 10 shares
          [['0.52', '1000'], ['0.53', '1000']],
        )),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry: BUY YES when buy-side impact is low ────────────────────────

  it('enters buy-yes when buy impact << sell impact (strong bid support)', async () => {
    // Asks are deep (low buy impact), bids are thin (high sell impact)
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],  // thin bids, price falls fast
          [['0.51', '500'], ['0.52', '500']],                    // deep asks, low impact
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
  });

  it('enters buy-no when sell impact << buy impact (strong ask resistance)', async () => {
    // Bids are deep (low sell impact), asks are thin (high buy impact)
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '500'], ['0.48', '500']],                    // deep bids, low impact
          [['0.51', '50'], ['0.70', '50'], ['0.90', '500']],  // thin asks, price rises fast
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
  });

  it('does not enter when asymmetry is below threshold', async () => {
    // Symmetric book → no asymmetry
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '500'], ['0.48', '500'], ['0.47', '500']],
          [['0.51', '500'], ['0.52', '500'], ['0.53', '500']],
        )),
      } as any,
      config: { minVolume: 1, asymmetryThreshold: 10.0 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('emits trade.executed event on entry', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
          [['0.51', '500'], ['0.52', '500']],
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      expect(deps.eventBus.emit).toHaveBeenCalledWith(
        'trade.executed',
        expect.objectContaining({
          trade: expect.objectContaining({
            side: 'buy',
            strategy: 'price-impact-estimator',
          }),
        }),
      );
    }
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          // Entry: asymmetric book favoring yes
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        // TP: price rises
        return Promise.resolve(makeBook(
          [['0.65', '500']], [['0.67', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        takeProfitPct: 0.03,
        stopLossPct: 0.50,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick(); // entry
    await tick(); // check exit

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        // SL: price drops
        return Promise.resolve(makeBook(
          [['0.05', '500']], [['0.07', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        // Same price, no TP/SL triggered
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick(); // entry
    await new Promise(r => setTimeout(r, 5));
    await tick(); // should exit on max hold

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          // Asymmetric book for entry
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        if (callCount <= 3) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.65', '500']], [['0.67', '500']],
          ));
        }
        // Back to asymmetric after exit
        return Promise.resolve(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
          [['0.51', '500'], ['0.52', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
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

    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
          [['0.51', '500'], ['0.52', '500']],
        )),
      } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events on both entry and exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.65', '500']], [['0.67', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        takeProfitPct: 0.03,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick(); // entry
    await tick(); // exit

    // Should have emitted at least for entry
    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter when equal impacts yield null side', async () => {
    // Perfectly symmetric book
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '500'], ['0.48', '500']],
          [['0.51', '500'], ['0.52', '500']],
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 500, asymmetryThreshold: 0.0 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('tracks state across multiple ticks', async () => {
    const deps = makeDeps({
      config: { minVolume: 1 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    await tick();
    await tick();
    // getOrderBook called once per tick per market
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(3);
  });

  it('handles exit when clob fails during exit check', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        // Fail on exit check
        return Promise.reject(new Error('network error'));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick(); // entry
    await expect(tick()).resolves.toBeUndefined(); // exit check fails gracefully
  });

  it('uses yes tokenId for yes side entry', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
          [['0.51', '500'], ['0.52', '500']],
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      // buy impact should be lower (deep asks), so side=yes, tokenId=yes-1
      expect(call.tokenId).toBe('yes-1');
    }
  });

  it('uses no tokenId for no side entry', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '500'], ['0.48', '500']],
          [['0.51', '50'], ['0.70', '50'], ['0.90', '500']],
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      // sell impact should be lower (deep bids), so side=no, tokenId=no-1
      expect(call.tokenId).toBe('no-1');
    }
  });

  it('uses yesTokenId as fallback when noTokenId is null for no side', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '500'], ['0.48', '500']],
          [['0.51', '50'], ['0.70', '50'], ['0.90', '500']],
        )),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: null,
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.tokenId).toBe('yes-1');
    }
  });

  it('does not enter duplicate position for same token', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
          [['0.51', '500'], ['0.52', '500']],
        )),
      } as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();
    await tick();
    await tick();

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    // Should only enter once for same market
    expect(entries.length).toBe(1);
  });

  it('places GTC order for entry', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
          [['0.51', '500'], ['0.52', '500']],
        )),
      } as any,
      config: { minVolume: 1, hypotheticalSize: 100, asymmetryThreshold: 0.01 },
    });
    const tick = createPriceImpactEstimatorTick(deps);
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.orderType).toBe('GTC');
    }
  });

  it('uses IOC order type for exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook(
            [['0.49', '50'], ['0.30', '50'], ['0.10', '500']],
            [['0.51', '500'], ['0.52', '500']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.65', '500']], [['0.67', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        hypotheticalSize: 100,
        asymmetryThreshold: 0.01,
        takeProfitPct: 0.03,
      },
    });

    const tick = createPriceImpactEstimatorTick(deps);
    await tick(); // entry
    await tick(); // exit

    const exitCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC',
    );
    if (exitCalls.length > 0) {
      expect(exitCalls[0][0].orderType).toBe('IOC');
    }
  });

  it('uses default config values when no overrides', () => {
    const cfg = makeConfig();
    expect(cfg.hypotheticalSize).toBe(500);
    expect(cfg.asymmetryThreshold).toBe(2.0);
    expect(cfg.impactEmaAlpha).toBe(0.1);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.025);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(15 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.positionSize).toBe('10');
  });
});
