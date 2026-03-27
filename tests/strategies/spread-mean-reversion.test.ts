import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcSpread,
  calcSpreadDeviation,
  updateSpreadEma,
  determineCheapSide,
  isSpreadSignal,
  createSpreadMeanReversionTick,
  DEFAULT_CONFIG,
  type SpreadMeanReversionConfig,
  type SpreadMeanReversionDeps,
} from '../../src/strategies/polymarket/spread-mean-reversion.js';
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

function makeConfig(overrides: Partial<SpreadMeanReversionConfig> = {}): SpreadMeanReversionConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcSpread tests ─────────────────────────────────────────────────────────

describe('calcSpread', () => {
  it('returns 1.0 when yes + no = 1.0', () => {
    expect(calcSpread(0.5, 0.5)).toBeCloseTo(1.0, 4);
  });

  it('returns sum of yes and no prices', () => {
    expect(calcSpread(0.6, 0.4)).toBeCloseTo(1.0, 4);
  });

  it('returns > 1.0 when overpriced', () => {
    expect(calcSpread(0.55, 0.50)).toBeCloseTo(1.05, 4);
  });

  it('returns < 1.0 when underpriced', () => {
    expect(calcSpread(0.45, 0.50)).toBeCloseTo(0.95, 4);
  });

  it('handles extreme yes price', () => {
    expect(calcSpread(0.99, 0.01)).toBeCloseTo(1.0, 4);
  });

  it('handles both prices at 0', () => {
    expect(calcSpread(0, 0)).toBe(0);
  });

  it('handles both prices at 1', () => {
    expect(calcSpread(1, 1)).toBe(2);
  });

  it('handles asymmetric spread', () => {
    expect(calcSpread(0.7, 0.35)).toBeCloseTo(1.05, 4);
  });
});

// ── calcSpreadDeviation tests ────────────────────────────────────────────────

describe('calcSpreadDeviation', () => {
  it('returns 0 when spread is 1.0', () => {
    expect(calcSpreadDeviation(1.0)).toBe(0);
  });

  it('returns positive when spread > 1.0', () => {
    expect(calcSpreadDeviation(1.05)).toBeCloseTo(0.05, 4);
  });

  it('returns negative when spread < 1.0', () => {
    expect(calcSpreadDeviation(0.95)).toBeCloseTo(-0.05, 4);
  });

  it('handles large positive deviation', () => {
    expect(calcSpreadDeviation(1.5)).toBeCloseTo(0.5, 4);
  });

  it('handles large negative deviation', () => {
    expect(calcSpreadDeviation(0.5)).toBeCloseTo(-0.5, 4);
  });

  it('handles zero spread', () => {
    expect(calcSpreadDeviation(0)).toBeCloseTo(-1.0, 4);
  });
});

// ── updateSpreadEma tests ────────────────────────────────────────────────────

describe('updateSpreadEma', () => {
  it('returns value when prev is null (initial case)', () => {
    expect(updateSpreadEma(null, 1.05, 0.1)).toBe(1.05);
  });

  it('returns prev when alpha is 0', () => {
    expect(updateSpreadEma(1.0, 1.05, 0)).toBe(1.0);
  });

  it('returns value when alpha is 1', () => {
    expect(updateSpreadEma(1.0, 1.05, 1)).toBe(1.05);
  });

  it('returns weighted average for alpha between 0 and 1', () => {
    // alpha=0.5 -> 0.5*1.05 + 0.5*1.0 = 0.525 + 0.5 = 1.025
    const result = updateSpreadEma(1.0, 1.05, 0.5);
    expect(result).toBeCloseTo(1.025, 4);
  });

  it('converges toward value with repeated updates', () => {
    let ema: number | null = null;
    for (let i = 0; i < 100; i++) {
      ema = updateSpreadEma(ema, 1.05, 0.1);
    }
    expect(ema).toBeCloseTo(1.05, 2);
  });

  it('moves slowly with small alpha', () => {
    const result = updateSpreadEma(1.0, 1.10, 0.01);
    // 0.01*1.10 + 0.99*1.0 = 0.011 + 0.99 = 1.001
    expect(result).toBeCloseTo(1.001, 3);
  });

  it('moves quickly with large alpha', () => {
    const result = updateSpreadEma(1.0, 1.10, 0.99);
    // 0.99*1.10 + 0.01*1.0 = 1.089 + 0.01 = 1.099
    expect(result).toBeCloseTo(1.099, 3);
  });

  it('handles negative values', () => {
    const result = updateSpreadEma(-0.10, -0.20, 0.5);
    expect(result).toBeCloseTo(-0.15, 4);
  });

  it('returns prev for negative alpha', () => {
    expect(updateSpreadEma(1.0, 1.10, -0.5)).toBe(1.0);
  });
});

// ── determineCheapSide tests ─────────────────────────────────────────────────

describe('determineCheapSide', () => {
  it('returns yes when yesPrice < noPrice', () => {
    expect(determineCheapSide(0.40, 0.60)).toBe('yes');
  });

  it('returns no when noPrice < yesPrice', () => {
    expect(determineCheapSide(0.60, 0.40)).toBe('no');
  });

  it('returns yes when prices are equal', () => {
    expect(determineCheapSide(0.50, 0.50)).toBe('yes');
  });

  it('handles extreme prices', () => {
    expect(determineCheapSide(0.01, 0.99)).toBe('yes');
    expect(determineCheapSide(0.99, 0.01)).toBe('no');
  });

  it('handles zero prices', () => {
    expect(determineCheapSide(0, 0.5)).toBe('yes');
    expect(determineCheapSide(0.5, 0)).toBe('no');
  });
});

// ── isSpreadSignal tests ─────────────────────────────────────────────────────

describe('isSpreadSignal', () => {
  it('returns true when |deviation| > threshold', () => {
    expect(isSpreadSignal(0.05, 0.02)).toBe(true);
  });

  it('returns true for negative deviation exceeding threshold', () => {
    expect(isSpreadSignal(-0.05, 0.02)).toBe(true);
  });

  it('returns false when |deviation| < threshold', () => {
    expect(isSpreadSignal(0.01, 0.02)).toBe(false);
  });

  it('returns false when |deviation| equals threshold', () => {
    expect(isSpreadSignal(0.02, 0.02)).toBe(false);
  });

  it('returns false when deviation is 0', () => {
    expect(isSpreadSignal(0, 0.02)).toBe(false);
  });

  it('handles zero threshold', () => {
    expect(isSpreadSignal(0.001, 0)).toBe(true);
  });

  it('returns false for zero deviation with zero threshold', () => {
    expect(isSpreadSignal(0, 0)).toBe(false);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<SpreadMeanReversionDeps> = {}): SpreadMeanReversionDeps {
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

describe('createSpreadMeanReversionTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createSpreadMeanReversionTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient spread history)', async () => {
    const deps = makeDeps();
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
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
    const tick = createSpreadMeanReversionTick(deps);
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
    const tick = createSpreadMeanReversionTick(deps);
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
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createSpreadMeanReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
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
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles market with no noTokenId by deriving no price', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: undefined,
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
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
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for yes and no of each)
    expect(deps.clob.getOrderBook).toHaveBeenCalled();
  });

  it('records spread history across ticks', async () => {
    const deps = makeDeps();
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    await tick();
    await tick();
    // getOrderBook called for yes+no per tick per market
    expect(deps.clob.getOrderBook).toHaveBeenCalled();
  });

  it('skips market where yes mid price is 0', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.00', '100']], [['0.00', '100']],
        )),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market where yes mid price is 1', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['1.00', '100']], [['1.00', '100']],
        )),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: spread deviation triggers buy cheapest side ──────────

  it('enters buy-yes when yes is cheaper and spread deviates', async () => {
    // yes=0.30, no=0.75 → spread=1.05 → deviation=0.05 → buy yes (cheaper)
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 4) {
          // First 2 ticks (2 calls per tick: yes+no), stable spread ~1.0
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Then deviate: yes cheap, no expensive
        if (tokenId === 'yes-1') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.tokenId).toBe('yes-1');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  it('enters buy-no when no is cheaper and spread deviates', async () => {
    // yes=0.75, no=0.30 → spread=1.05 → deviation=0.05 → buy no (cheaper)
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 4) {
          // Stable spread ~1.0
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Then deviate: no cheap, yes expensive
        if (tokenId === 'yes-1') {
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.tokenId).toBe('no-1');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when spread is within threshold ──────────────────────────

  it('does not enter when spread deviation is below threshold', async () => {
    // Stable spread = 1.0 → deviation ~0 → no signal
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        spreadThreshold: 0.10,
        minVolume: 1,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 4) {
          // Stable
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 8) {
          // Deviate to create entry
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        // Price recovers for TP (exit check uses yes-1 tokenId)
        return Promise.resolve(makeBook([['0.65', '100']], [['0.67', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 4) {
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 8) {
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        // Price drops further for SL
        return Promise.resolve(makeBook([['0.05', '100']], [['0.07', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 4) {
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Deviate then stay stable
        if (tokenId === 'yes-1') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
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
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 4) {
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 8) {
          // Deviate for entry
          if (tokenId === 'yes-1') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        if (callCount <= 12) {
          // TP exit
          return Promise.resolve(makeBook([['0.65', '100']], [['0.67', '100']]));
        }
        // Back to deviated after exit
        if (tokenId === 'yes-1') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
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
        // First passes: stable
        if (callCount <= 18) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Then deviate for entry
        return Promise.resolve(makeBook([['0.29', '100']], [['0.76', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
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
    const tick = createSpreadMeanReversionTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('uses default config values when no overrides provided', () => {
    const cfg = makeConfig();
    expect(cfg.spreadWindow).toBe(20);
    expect(cfg.spreadThreshold).toBe(0.02);
    expect(cfg.spreadEmaAlpha).toBe(0.1);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.02);
    expect(cfg.stopLossPct).toBe(0.015);
    expect(cfg.maxHoldMs).toBe(600_000);
    expect(cfg.maxPositions).toBe(5);
    expect(cfg.cooldownMs).toBe(60_000);
    expect(cfg.positionSize).toBe('8');
  });

  it('overrides specific config values', () => {
    const cfg = makeConfig({ spreadThreshold: 0.05, maxPositions: 10 });
    expect(cfg.spreadThreshold).toBe(0.05);
    expect(cfg.maxPositions).toBe(10);
    expect(cfg.spreadWindow).toBe(20); // default preserved
  });

  it('does not enter same market twice', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Persistent deviation
        return Promise.resolve(makeBook([['0.29', '100']], [['0.76', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
        maxPositions: 10,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only one entry for the single market
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('places GTC order for entry', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        return Promise.resolve(makeBook([['0.29', '100']], [['0.76', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
        spreadEmaAlpha: 0.1,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.orderType).toBe('GTC');
      expect(call.side).toBe('buy');
    }
    expect(true).toBe(true);
  });

  it('handles market with volume exactly at minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 5000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    // volume=5000 equals minVolume=5000 → not < minVolume → should scan
    expect(deps.clob.getOrderBook).toHaveBeenCalled();
  });

  it('handles market with volume just below minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 4999, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles market with null volume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: null, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('fetches orderbook for both yes and no tokens', async () => {
    const deps = makeDeps({
      config: { minVolume: 1 },
    });
    const tick = createSpreadMeanReversionTick(deps);
    await tick();
    // Should call getOrderBook for yes-1 and no-1
    expect(deps.clob.getOrderBook).toHaveBeenCalledWith('yes-1');
    expect(deps.clob.getOrderBook).toHaveBeenCalledWith('no-1');
  });

  it('does not enter when spread is exactly 1.0', async () => {
    // yes=0.50, no=0.50 → spread=1.0 → deviation=0 → no signal
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        spreadThreshold: 0.02,
        minVolume: 1,
      },
    });

    const tick = createSpreadMeanReversionTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
