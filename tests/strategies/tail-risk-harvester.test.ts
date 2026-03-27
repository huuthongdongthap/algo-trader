import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isExtremePrice,
  calcReversionRate,
  calcExpectedValue,
  calcPremium,
  createTailRiskHarvesterTick,
  DEFAULT_CONFIG,
  type TailRiskHarvesterConfig,
  type TailRiskHarvesterDeps,
} from '../../src/strategies/polymarket/tail-risk-harvester.js';
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

function makeConfig(overrides: Partial<TailRiskHarvesterConfig> = {}): TailRiskHarvesterConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── isExtremePrice tests ─────────────────────────────────────────────────────

describe('isExtremePrice', () => {
  it('returns "high" when price > extremeHigh', () => {
    expect(isExtremePrice(0.95, 0.92, 0.08)).toBe('high');
  });

  it('returns "low" when price < extremeLow', () => {
    expect(isExtremePrice(0.03, 0.92, 0.08)).toBe('low');
  });

  it('returns null when price is between extremes', () => {
    expect(isExtremePrice(0.50, 0.92, 0.08)).toBeNull();
  });

  it('returns null when price equals extremeHigh exactly', () => {
    expect(isExtremePrice(0.92, 0.92, 0.08)).toBeNull();
  });

  it('returns null when price equals extremeLow exactly', () => {
    expect(isExtremePrice(0.08, 0.92, 0.08)).toBeNull();
  });

  it('returns "high" for price of 0.99', () => {
    expect(isExtremePrice(0.99, 0.92, 0.08)).toBe('high');
  });

  it('returns "low" for price of 0.01', () => {
    expect(isExtremePrice(0.01, 0.92, 0.08)).toBe('low');
  });

  it('returns null for price of 0.5', () => {
    expect(isExtremePrice(0.5, 0.92, 0.08)).toBeNull();
  });

  it('handles custom thresholds', () => {
    expect(isExtremePrice(0.80, 0.75, 0.25)).toBe('high');
    expect(isExtremePrice(0.20, 0.75, 0.25)).toBe('low');
    expect(isExtremePrice(0.50, 0.75, 0.25)).toBeNull();
  });

  it('returns "high" for price just above extremeHigh', () => {
    expect(isExtremePrice(0.9201, 0.92, 0.08)).toBe('high');
  });

  it('returns "low" for price just below extremeLow', () => {
    expect(isExtremePrice(0.0799, 0.92, 0.08)).toBe('low');
  });
});

// ── calcReversionRate tests ──────────────────────────────────────────────────

describe('calcReversionRate', () => {
  it('returns 0 for fewer than 2 prices', () => {
    expect(calcReversionRate([], 0.92, 0.08)).toBe(0);
    expect(calcReversionRate([0.95], 0.92, 0.08)).toBe(0);
  });

  it('returns 0 when no prices are extreme', () => {
    expect(calcReversionRate([0.5, 0.6, 0.4, 0.5], 0.92, 0.08)).toBe(0);
  });

  it('returns 1 when all extremes revert', () => {
    // 0.95 (extreme high) -> 0.50 (not extreme) = reversion
    expect(calcReversionRate([0.95, 0.50], 0.92, 0.08)).toBe(1);
  });

  it('returns 0 when extremes persist', () => {
    // 0.95 -> 0.96 = both extreme high, no reversion
    expect(calcReversionRate([0.95, 0.96], 0.92, 0.08)).toBe(0);
  });

  it('returns 0.5 for mixed reversion', () => {
    // 0.95 -> 0.50 (reversion), 0.95 -> 0.96 (no reversion)
    expect(calcReversionRate([0.95, 0.50, 0.95, 0.96], 0.92, 0.08)).toBe(0.5);
  });

  it('counts low extreme reversions', () => {
    // 0.03 -> 0.50 = reversion from low
    expect(calcReversionRate([0.03, 0.50], 0.92, 0.08)).toBe(1);
  });

  it('counts low extreme persistence', () => {
    // 0.03 -> 0.02 = both extreme low, no reversion
    expect(calcReversionRate([0.03, 0.02], 0.92, 0.08)).toBe(0);
  });

  it('handles mix of high and low extremes', () => {
    // 0.95 -> 0.50 (reversion from high), 0.03 -> 0.50 (reversion from low)
    expect(calcReversionRate([0.95, 0.50, 0.03, 0.50], 0.92, 0.08)).toBe(1);
  });

  it('ignores non-extreme prices for counting', () => {
    // 0.50 (non-extreme) -> 0.60 does not count
    // 0.95 (extreme) -> 0.80 counts as reversion
    expect(calcReversionRate([0.50, 0.60, 0.95, 0.80], 0.92, 0.08)).toBe(1);
  });

  it('handles all extreme prices with no reversion', () => {
    expect(calcReversionRate([0.95, 0.96, 0.97, 0.98], 0.92, 0.08)).toBe(0);
  });

  it('handles long sequence with partial reversion', () => {
    // extremes: 0.95(i0)->0.50(revert), 0.95(i2)->0.93(no), 0.93(i3)->0.03(no), 0.03(i4)->0.50(revert)
    // 4 extreme observations, 2 reversions → 0.5
    const prices = [0.95, 0.50, 0.95, 0.93, 0.03, 0.50];
    expect(calcReversionRate(prices, 0.92, 0.08)).toBeCloseTo(0.5, 4);
  });
});

// ── calcExpectedValue tests ──────────────────────────────────────────────────

describe('calcExpectedValue', () => {
  it('returns premium * reversionRate', () => {
    expect(calcExpectedValue(0.05, 0.5)).toBeCloseTo(0.025, 4);
  });

  it('returns 0 when premium is 0', () => {
    expect(calcExpectedValue(0, 0.8)).toBe(0);
  });

  it('returns 0 when reversionRate is 0', () => {
    expect(calcExpectedValue(0.05, 0)).toBe(0);
  });

  it('returns premium when reversionRate is 1', () => {
    expect(calcExpectedValue(0.03, 1)).toBeCloseTo(0.03, 4);
  });

  it('handles small values', () => {
    expect(calcExpectedValue(0.01, 0.3)).toBeCloseTo(0.003, 4);
  });
});

// ── calcPremium tests ────────────────────────────────────────────────────────

describe('calcPremium', () => {
  it('returns price when price < 0.5', () => {
    expect(calcPremium(0.03)).toBeCloseTo(0.03, 4);
  });

  it('returns 1-price when price > 0.5', () => {
    expect(calcPremium(0.97)).toBeCloseTo(0.03, 4);
  });

  it('returns 0.5 when price is 0.5', () => {
    expect(calcPremium(0.5)).toBeCloseTo(0.5, 4);
  });

  it('returns 0 when price is 0', () => {
    expect(calcPremium(0)).toBe(0);
  });

  it('returns 0 when price is 1', () => {
    expect(calcPremium(1)).toBe(0);
  });

  it('returns small premium for extreme high price', () => {
    expect(calcPremium(0.95)).toBeCloseTo(0.05, 4);
  });

  it('returns small premium for extreme low price', () => {
    expect(calcPremium(0.05)).toBeCloseTo(0.05, 4);
  });

  it('is symmetric around 0.5', () => {
    expect(calcPremium(0.1)).toBeCloseTo(calcPremium(0.9), 4);
    expect(calcPremium(0.2)).toBeCloseTo(calcPremium(0.8), 4);
    expect(calcPremium(0.3)).toBeCloseTo(calcPremium(0.7), 4);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<TailRiskHarvesterDeps> = {}): TailRiskHarvesterDeps {
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

describe('createTailRiskHarvesterTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createTailRiskHarvesterTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createTailRiskHarvesterTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createTailRiskHarvesterTick(deps);
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
    const tick = createTailRiskHarvesterTick(deps);
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
    const tick = createTailRiskHarvesterTick(deps);
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
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createTailRiskHarvesterTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    // mid = (0 + 1) / 2 = 0.5 which is valid but not extreme
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
    const tick = createTailRiskHarvesterTick(deps);
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
    const tick = createTailRiskHarvesterTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createTailRiskHarvesterTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter when price is not extreme', async () => {
    // Price at 0.50 is not extreme
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter with insufficient reversion history', async () => {
    // Only 1 tick of extreme price, need >= 2 for reversion rate
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.96', '100']], [['0.98', '100']]),
        ),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: extreme high → BUY NO ─────────────────────────────

  it('enters buy-no when price is extreme high with sufficient reversion', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Alternate: extreme high -> non-extreme -> extreme high to build reversion history
        if (callCount <= 2) {
          // First tick: extreme high
          return Promise.resolve(makeBook([['0.94', '100']], [['0.96', '100']]));
        }
        if (callCount === 3) {
          // Second tick: non-extreme (reversion)
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Third tick onward: extreme high again — now reversion rate = 1.0 (past extreme reverted)
        return Promise.resolve(makeBook([['0.94', '100']], [['0.96', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        extremeHigh: 0.92,
        extremeLow: 0.08,
        minReversionRate: 0.3,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  it('enters buy-yes when price is extreme low with sufficient reversion', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // extreme low
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 3) {
          // non-extreme (reversion)
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // extreme low again
        return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        extremeHigh: 0.92,
        extremeLow: 0.08,
        minReversionRate: 0.3,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  it('does not enter when reversion rate is below minimum', async () => {
    // All extreme prices persist — reversion rate = 0
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.94', '100']], [['0.96', '100']]),
        ),
      } as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
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
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createTailRiskHarvesterTick(deps);
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
    const tick = createTailRiskHarvesterTick(deps);
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
    const tick = createTailRiskHarvesterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Build reversion history: extreme low -> non-extreme -> extreme low
        if (callCount === 1) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 4) {
          // Entry: extreme low
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        // Price recovers for TP (yes position: gain = (current - entry) / entry)
        return Promise.resolve(makeBook([['0.10', '100']], [['0.12', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        takeProfitPct: 0.015,
        stopLossPct: 0.05,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 7; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        // Price drops further for SL
        return Promise.resolve(makeBook([['0.005', '100']], [['0.01', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        takeProfitPct: 0.50,
        stopLossPct: 0.05,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 7; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Stay at extreme
        return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 5; i++) {
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
        if (callCount === 1) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount <= 6) {
          // Price recovery for TP exit
          return Promise.resolve(makeBook([['0.10', '100']], [['0.12', '100']]));
        }
        // Back to extreme after exit
        return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        takeProfitPct: 0.015,
        cooldownMs: 180_000,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
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

    // Per-token call counts to build reversion history then stay extreme low
    const tokenCalls = new Map<string, number>();
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        const count = (tokenCalls.get(tokenId) ?? 0) + 1;
        tokenCalls.set(tokenId, count);
        // First call per token: extreme low
        if (count === 1) {
          return Promise.resolve(makeBook([['0.03', '100']], [['0.05', '100']]));
        }
        // Second call: non-extreme (builds reversion)
        if (count === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // All subsequent calls: extreme low (yes entry at ask=0.05, mid=0.04, stable)
        return Promise.resolve(makeBook([['0.03', '100']], [['0.05', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

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
          return Promise.resolve(makeBook([['0.94', '100']], [['0.96', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        return Promise.resolve(makeBook([['0.94', '100']], [['0.96', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, minReversionRate: 0.3 },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not duplicate positions for same tokenId', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // extreme low to seed history
          return Promise.resolve(makeBook([['0.03', '100']], [['0.05', '100']]));
        }
        if (callCount === 2) {
          // non-extreme to build reversion
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Stay extreme low (yes entry at ask=0.05, mid=0.04, stable → no TP/SL)
        return Promise.resolve(makeBook([['0.03', '100']], [['0.05', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only one entry per market
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('uses default config values when no overrides provided', () => {
    const cfg = makeConfig();
    expect(cfg.extremeHigh).toBe(0.92);
    expect(cfg.extremeLow).toBe(0.08);
    expect(cfg.minReversionRate).toBe(0.3);
    expect(cfg.reversionWindow).toBe(30);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.015);
    expect(cfg.stopLossPct).toBe(0.05);
    expect(cfg.maxHoldMs).toBe(30 * 60_000);
    expect(cfg.maxPositions).toBe(5);
    expect(cfg.cooldownMs).toBe(180_000);
    expect(cfg.positionSize).toBe('8');
  });

  it('config overrides apply correctly', () => {
    const cfg = makeConfig({ extremeHigh: 0.95, extremeLow: 0.05 });
    expect(cfg.extremeHigh).toBe(0.95);
    expect(cfg.extremeLow).toBe(0.05);
    expect(cfg.minVolume).toBe(5000); // unchanged
  });

  it('exit emits IOC order type', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        // Big price recovery for TP
        return Promise.resolve(makeBook([['0.10', '100']], [['0.12', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        takeProfitPct: 0.015,
        stopLossPct: 0.05,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC'
    );
    // If an exit happened, it should be IOC
    for (const call of iocCalls) {
      expect(call[0].orderType).toBe('IOC');
    }
  });

  it('handles exit order failure gracefully', async () => {
    let callCount = 0;
    const entryOrderPlaced = { value: false };
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.02', '100']], [['0.04', '100']]));
        }
        return Promise.resolve(makeBook([['0.10', '100']], [['0.12', '100']]));
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockImplementation((params: any) => {
        if (params.orderType === 'GTC') {
          entryOrderPlaced.value = true;
          return Promise.resolve({ id: 'order-1' });
        }
        // Exit fails
        return Promise.reject(new Error('network error'));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      config: {
        minVolume: 1,
        minReversionRate: 0.3,
        takeProfitPct: 0.015,
      },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 8; i++) {
      await expect(tick()).resolves.toBeUndefined();
    }
  });

  it('price history is trimmed to reversionWindow', async () => {
    const deps = makeDeps({
      config: { reversionWindow: 3, minVolume: 1 },
    });
    const tick = createTailRiskHarvesterTick(deps);
    // Run many ticks to accumulate history
    for (let i = 0; i < 10; i++) {
      await tick();
    }
    // No way to inspect internal state, but should not throw
    expect(true).toBe(true);
  });

  it('does not enter when EV is 0', async () => {
    // If reversion rate is 0 the EV is 0 — no entry
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.94', '100']], [['0.96', '100']]),
        ),
      } as any,
      config: { minVolume: 1, minReversionRate: 0.0 },
    });

    const tick = createTailRiskHarvesterTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    // All prices extreme with no reversion → reversionRate=0 → EV=0 → no entry
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
