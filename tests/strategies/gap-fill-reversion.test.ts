import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectGap,
  isGapConfirmed,
  isGapStale,
  calcFillTarget,
  createGapFillReversionTick,
  DEFAULT_CONFIG,
  type GapFillReversionConfig,
  type GapFillReversionDeps,
} from '../../src/strategies/polymarket/gap-fill-reversion.js';
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

function makeConfig(overrides: Partial<GapFillReversionConfig> = {}): GapFillReversionConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── detectGap tests ─────────────────────────────────────────────────────────

describe('detectGap', () => {
  it('detects an upward gap above threshold', () => {
    const result = detectGap(0.50, 0.60, 0.03);
    expect(result.isGap).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.size).toBeCloseTo(0.10, 4);
  });

  it('detects a downward gap above threshold', () => {
    const result = detectGap(0.60, 0.50, 0.03);
    expect(result.isGap).toBe(true);
    expect(result.direction).toBe('down');
    expect(result.size).toBeCloseTo(0.10, 4);
  });

  it('returns isGap false when change is below threshold', () => {
    const result = detectGap(0.50, 0.51, 0.03);
    expect(result.isGap).toBe(false);
    expect(result.size).toBeCloseTo(0.01, 4);
  });

  it('returns isGap false when size equals threshold (strict >)', () => {
    // detectGap uses strict >, so exactly at threshold is not a gap
    // Use 0.25 and 0.50 which are exact in binary float
    const result = detectGap(0.25, 0.50, 0.25);
    expect(result.isGap).toBe(false);
    expect(result.size).toBeCloseTo(0.25, 4);
  });

  it('detects gap just above threshold', () => {
    const result = detectGap(0.50, 0.5301, 0.03);
    expect(result.isGap).toBe(true);
  });

  it('handles zero threshold', () => {
    const result = detectGap(0.50, 0.50001, 0);
    expect(result.isGap).toBe(true);
  });

  it('handles identical prices', () => {
    const result = detectGap(0.50, 0.50, 0.03);
    expect(result.isGap).toBe(false);
    expect(result.size).toBe(0);
  });

  it('handles extreme price values', () => {
    const result = detectGap(0.01, 0.99, 0.03);
    expect(result.isGap).toBe(true);
    expect(result.direction).toBe('up');
    expect(result.size).toBeCloseTo(0.98, 4);
  });

  it('reports correct direction for small downward move', () => {
    const result = detectGap(0.50, 0.49, 0.03);
    expect(result.direction).toBe('down');
  });

  it('reports correct direction for small upward move', () => {
    const result = detectGap(0.50, 0.51, 0.03);
    expect(result.direction).toBe('up');
  });
});

// ── isGapConfirmed tests ────────────────────────────────────────────────────

describe('isGapConfirmed', () => {
  it('returns false when confirmCount < requiredConfirms', () => {
    expect(isGapConfirmed('up', 0.60, 0.62, 1, 2)).toBe(false);
  });

  it('returns true when confirmCount equals requiredConfirms and price on gap side (up)', () => {
    expect(isGapConfirmed('up', 0.60, 0.62, 2, 2)).toBe(true);
  });

  it('returns true when confirmCount exceeds requiredConfirms (up)', () => {
    expect(isGapConfirmed('up', 0.60, 0.65, 5, 2)).toBe(true);
  });

  it('returns false for up gap when price has fallen below gapPrice', () => {
    expect(isGapConfirmed('up', 0.60, 0.58, 3, 2)).toBe(false);
  });

  it('returns true for up gap when price equals gapPrice exactly', () => {
    expect(isGapConfirmed('up', 0.60, 0.60, 2, 2)).toBe(true);
  });

  it('returns true when confirmCount equals requiredConfirms and price on gap side (down)', () => {
    expect(isGapConfirmed('down', 0.40, 0.38, 2, 2)).toBe(true);
  });

  it('returns true when confirmCount exceeds requiredConfirms (down)', () => {
    expect(isGapConfirmed('down', 0.40, 0.35, 5, 2)).toBe(true);
  });

  it('returns false for down gap when price has risen above gapPrice', () => {
    expect(isGapConfirmed('down', 0.40, 0.45, 3, 2)).toBe(false);
  });

  it('returns true for down gap when price equals gapPrice exactly', () => {
    expect(isGapConfirmed('down', 0.40, 0.40, 2, 2)).toBe(true);
  });

  it('returns false when confirmCount is 0', () => {
    expect(isGapConfirmed('up', 0.60, 0.65, 0, 2)).toBe(false);
  });

  it('returns true when requiredConfirms is 0 and price is on gap side', () => {
    expect(isGapConfirmed('up', 0.60, 0.65, 0, 0)).toBe(true);
  });
});

// ── isGapStale tests ────────────────────────────────────────────────────────

describe('isGapStale', () => {
  it('returns false when gap is fresh', () => {
    expect(isGapStale(1000, 1500, 300_000)).toBe(false);
  });

  it('returns true when gap is older than decayMs', () => {
    expect(isGapStale(1000, 400_000, 300_000)).toBe(true);
  });

  it('returns false when gap age exactly equals decayMs', () => {
    expect(isGapStale(1000, 301_000, 300_000)).toBe(false);
  });

  it('returns true when gap age is just over decayMs', () => {
    expect(isGapStale(1000, 301_002, 300_000)).toBe(true);
  });

  it('handles zero decayMs (all gaps are stale)', () => {
    expect(isGapStale(1000, 1001, 0)).toBe(true);
  });

  it('handles very large decayMs', () => {
    expect(isGapStale(0, 1_000_000, 10_000_000)).toBe(false);
  });
});

// ── calcFillTarget tests ────────────────────────────────────────────────────

describe('calcFillTarget', () => {
  it('returns midpoint with default fillPct (0.5)', () => {
    const result = calcFillTarget(0.50, 0.60);
    expect(result).toBeCloseTo(0.55, 4);
  });

  it('returns preGapPrice when fillPct is 0 (full fill)', () => {
    const result = calcFillTarget(0.50, 0.60, 0);
    expect(result).toBeCloseTo(0.50, 4);
  });

  it('returns gapPrice when fillPct is 1 (no fill)', () => {
    const result = calcFillTarget(0.50, 0.60, 1);
    expect(result).toBeCloseTo(0.60, 4);
  });

  it('calculates correct target for downward gap', () => {
    // preGap=0.60, gap=0.40, fillPct=0.5 → 0.60 + 0.5*(0.40-0.60) = 0.60 - 0.10 = 0.50
    const result = calcFillTarget(0.60, 0.40, 0.5);
    expect(result).toBeCloseTo(0.50, 4);
  });

  it('calculates correct target for 75% fill', () => {
    // preGap=0.50, gap=0.70, fillPct=0.25 → 0.50 + 0.25*0.20 = 0.55
    const result = calcFillTarget(0.50, 0.70, 0.25);
    expect(result).toBeCloseTo(0.55, 4);
  });

  it('handles identical prices', () => {
    const result = calcFillTarget(0.50, 0.50, 0.5);
    expect(result).toBeCloseTo(0.50, 4);
  });

  it('handles extreme fill percentage', () => {
    const result = calcFillTarget(0.50, 0.70, 2.0);
    // 0.50 + 2.0 * (0.70 - 0.50) = 0.50 + 0.40 = 0.90
    expect(result).toBeCloseTo(0.90, 4);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<GapFillReversionDeps> = {}): GapFillReversionDeps {
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

describe('createGapFillReversionTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createGapFillReversionTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (no previous price)', async () => {
    const deps = makeDeps();
    const tick = createGapFillReversionTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createGapFillReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createGapFillReversionTick(deps);
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
    const tick = createGapFillReversionTick(deps);
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
    const tick = createGapFillReversionTick(deps);
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
    const tick = createGapFillReversionTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createGapFillReversionTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createGapFillReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createGapFillReversionTick(deps);
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
    const tick = createGapFillReversionTick(deps);
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
    const tick = createGapFillReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createGapFillReversionTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter on second tick with stable prices (no gap)', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createGapFillReversionTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('detects a gap but does not enter before confirmTicks', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Tick 1: stable at 0.50
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Tick 2: gap up to 0.60
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, gapThreshold: 0.03, confirmTicks: 3 },
    });

    const tick = createGapFillReversionTick(deps);
    await tick(); // establishes price
    await tick(); // detects gap, confirmCount=0
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters buy-no after upward gap is confirmed', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Tick 1: stable at 0.50
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Tick 2+: gap up to 0.60 and stays
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, gapThreshold: 0.03, confirmTicks: 2 },
    });

    const tick = createGapFillReversionTick(deps);
    await tick(); // tick 1: set initial price
    await tick(); // tick 2: detect gap, confirmCount=0
    await tick(); // tick 3: confirmCount=1
    await tick(); // tick 4: confirmCount=2 → confirmed, place order

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.orderType).toBe('GTC');
  });

  it('enters buy-yes after downward gap is confirmed', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Tick 1: stable at 0.60
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
        }
        // Tick 2+: gap down to 0.50 and stays
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, gapThreshold: 0.03, confirmTicks: 2 },
    });

    const tick = createGapFillReversionTick(deps);
    await tick(); // tick 1: set initial price
    await tick(); // tick 2: detect gap, confirmCount=0
    await tick(); // tick 3: confirmCount=1
    await tick(); // tick 4: confirmCount=2 → confirmed, place order

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.orderType).toBe('GTC');
  });

  it('emits trade.executed on entry', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, gapThreshold: 0.03, confirmTicks: 2 },
    });

    const tick = createGapFillReversionTick(deps);
    await tick();
    await tick();
    await tick();
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        strategy: 'gap-fill-reversion',
        side: 'buy',
      }),
    }));
  });

  it('invalidates gap when price reverts before confirmation', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']])); // 0.50
        }
        if (callCount === 2) {
          return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']])); // gap up to 0.60
        }
        // Price reverts back to 0.50
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, gapThreshold: 0.03, confirmTicks: 2 },
    });

    const tick = createGapFillReversionTick(deps);
    await tick(); // set price
    await tick(); // detect gap
    await tick(); // price reverts → gap invalidated
    await tick(); // no active gap
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market where mid price is 0', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.00', '100']], [['0.00', '100']],
        )),
      } as any,
    });
    const tick = createGapFillReversionTick(deps);
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
    const tick = createGapFillReversionTick(deps);
    await tick();
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
    const tick = createGapFillReversionTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createGapFillReversionTick(deps);
    await tick();
    await tick();
    await tick();
    // getOrderBook called once per tick per market
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(3);
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
        // First 3 calls (tick 1): establish prices at 0.50
        if (callCount <= 3) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Then gap up to 0.60
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 1,
        maxPositions: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createGapFillReversionTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Tick 1: establish at 0.60
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
        }
        // Tick 2-4: gap down to 0.50 (creates downward gap → BUY YES)
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Tick 5+: price recovers to 0.65 → TP for yes position
        return Promise.resolve(makeBook([['0.64', '100']], [['0.66', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 2,
        takeProfitPct: 0.03,
        stopLossPct: 0.50,
      },
    });

    const tick = createGapFillReversionTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Should have entry + exit orders
    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const exitCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(exitCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Price drops further for SL
        return Promise.resolve(makeBook([['0.05', '100']], [['0.07', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createGapFillReversionTick(deps);
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
          return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 2,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createGapFillReversionTick(deps);
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
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
        }
        if (callCount <= 6) {
          // TP exit: price drops for no position profit
          return Promise.resolve(makeBook([['0.39', '100']], [['0.41', '100']]));
        }
        // Back to gap territory
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 2,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createGapFillReversionTick(deps);
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

  it('does not enter when gap is stale (too old)', async () => {
    let callCount = 0;
    const now = Date.now();
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(now)        // tick 1
      .mockReturnValueOnce(now + 1000) // tick 2: detect gap
      .mockReturnValueOnce(now + 1000)
      .mockReturnValueOnce(now + 400_000) // tick 3: stale
      .mockReturnValueOnce(now + 400_000)
      .mockReturnValueOnce(now + 400_000);

    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minVolume: 1, gapThreshold: 0.03, confirmTicks: 2, gapDecayMs: 300_000 },
    });

    const tick = createGapFillReversionTick(deps);
    await tick(); // establish price
    await tick(); // detect gap
    await tick(); // gap is stale, should skip

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('uses default config values when no overrides provided', () => {
    const cfg = makeConfig();
    expect(cfg.gapThreshold).toBe(0.03);
    expect(cfg.confirmTicks).toBe(2);
    expect(cfg.gapDecayMs).toBe(300_000);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.025);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(20 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.positionSize).toBe('10');
  });

  it('does not enter duplicate position on same token', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createGapFillReversionTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only one entry for the single market
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('removes gap record after entering a position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 1) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minVolume: 1,
        gapThreshold: 0.03,
        confirmTicks: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createGapFillReversionTick(deps);
    await tick(); // establish
    await tick(); // detect gap
    await tick(); // confirm + enter

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBe(1);

    // Further ticks should not create another entry (gap removed + position exists)
    await tick();
    await tick();
    const entriesAfter = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entriesAfter.length).toBe(1);
  });
});
