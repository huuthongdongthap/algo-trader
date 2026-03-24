import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcReturn,
  calcCorrelation,
  findLeaderLaggards,
  createCrossEventDriftTick,
  type CrossEventDriftDeps,
} from '../../src/strategies/polymarket/cross-event-drift.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeEvent(markets: Array<{ id: string; conditionId: string; yesTokenId: string; noTokenId?: string; closed?: boolean; resolved?: boolean }>) {
  return {
    id: 'evt-1',
    title: 'Test Event',
    slug: 'test-event',
    description: 'Test',
    markets: markets.map(m => ({
      id: m.id,
      question: `Market ${m.id}?`,
      slug: `market-${m.id}`,
      conditionId: m.conditionId,
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId ?? `no-${m.id}`,
      yesPrice: 0.50,
      noPrice: 0.50,
      volume: 1000,
      volume24h: 500,
      liquidity: 5000,
      endDate: '2026-12-31',
      active: true,
      closed: m.closed ?? false,
      resolved: m.resolved ?? false,
      outcome: null,
    })),
  };
}

function makeDeps(overrides?: Partial<CrossEventDriftDeps>): CrossEventDriftDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getEvents: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

// ── calcReturn tests ────────────────────────────────────────────────────────

describe('calcReturn', () => {
  it('returns positive value for rising prices', () => {
    const prices = [0.40, 0.42, 0.44, 0.46, 0.48, 0.50];
    const ret = calcReturn(prices, 5);
    expect(ret).toBeGreaterThan(0);
  });

  it('returns negative value for falling prices', () => {
    const prices = [0.60, 0.58, 0.56, 0.54, 0.52, 0.50];
    const ret = calcReturn(prices, 5);
    expect(ret).toBeLessThan(0);
  });

  it('returns 0 for flat prices', () => {
    const prices = [0.50, 0.50, 0.50, 0.50, 0.50];
    expect(calcReturn(prices, 5)).toBe(0);
  });

  it('returns 0 for insufficient data (single price)', () => {
    expect(calcReturn([0.50], 5)).toBe(0);
  });

  it('returns 0 for empty array', () => {
    expect(calcReturn([], 5)).toBe(0);
  });
});

// ── calcCorrelation tests ───────────────────────────────────────────────────

describe('calcCorrelation', () => {
  it('returns ~1 for perfectly positively correlated series', () => {
    const a = [0.30, 0.40, 0.50, 0.60, 0.70];
    const b = [0.20, 0.30, 0.40, 0.50, 0.60];
    expect(calcCorrelation(a, b)).toBeCloseTo(1.0);
  });

  it('returns ~-1 for perfectly negatively correlated series', () => {
    const a = [0.30, 0.40, 0.50, 0.60, 0.70];
    const b = [0.70, 0.60, 0.50, 0.40, 0.30];
    expect(calcCorrelation(a, b)).toBeCloseTo(-1.0);
  });

  it('returns ~0 for uncorrelated (constant) series', () => {
    const a = [0.50, 0.50, 0.50, 0.50, 0.50];
    const b = [0.30, 0.60, 0.40, 0.70, 0.20];
    expect(calcCorrelation(a, b)).toBeCloseTo(0);
  });

  it('returns 0 for insufficient data (fewer than 3 points)', () => {
    expect(calcCorrelation([0.5], [0.5])).toBe(0);
    expect(calcCorrelation([0.5, 0.6], [0.5, 0.6])).toBe(0);
  });
});

// ── findLeaderLaggards tests ────────────────────────────────────────────────

describe('findLeaderLaggards', () => {
  it('returns null leader when no market exceeds driftThreshold', () => {
    const returns = new Map<string, number>([
      ['tok-a', 0.01],
      ['tok-b', 0.005],
      ['tok-c', -0.002],
    ]);
    const result = findLeaderLaggards(returns, 0.03, 0.005);
    expect(result.leader).toBeNull();
    expect(result.laggards).toEqual([]);
  });

  it('identifies one leader and laggards correctly', () => {
    const returns = new Map<string, number>([
      ['tok-a', 0.05],   // leader: above 0.03
      ['tok-b', 0.002],  // laggard: below 0.005
      ['tok-c', 0.001],  // laggard: below 0.005
    ]);
    const result = findLeaderLaggards(returns, 0.03, 0.005);
    expect(result.leader).toEqual({ id: 'tok-a', ret: 0.05 });
    expect(result.laggards).toContain('tok-b');
    expect(result.laggards).toContain('tok-c');
    expect(result.laggards).toHaveLength(2);
  });

  it('picks the biggest absolute return when multiple candidates exceed threshold', () => {
    const returns = new Map<string, number>([
      ['tok-a', 0.04],
      ['tok-b', -0.06],  // bigger absolute value
      ['tok-c', 0.001],
    ]);
    const result = findLeaderLaggards(returns, 0.03, 0.005);
    expect(result.leader).toEqual({ id: 'tok-b', ret: -0.06 });
    expect(result.laggards).toContain('tok-c');
  });

  it('returns empty laggards when no market is below followThreshold', () => {
    const returns = new Map<string, number>([
      ['tok-a', 0.05],
      ['tok-b', 0.02],   // above followThreshold
      ['tok-c', -0.01],  // above followThreshold
    ]);
    const result = findLeaderLaggards(returns, 0.03, 0.005);
    expect(result.leader).toEqual({ id: 'tok-a', ret: 0.05 });
    expect(result.laggards).toEqual([]);
  });
});

// ── createCrossEventDriftTick tests ─────────────────────────────────────────

describe('createCrossEventDriftTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a callable tick function', () => {
    const tick = createCrossEventDriftTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (no history)', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
    });
    const tick = createCrossEventDriftTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters when leader drifts and laggard is behind', async () => {
    // We need returnWindow=5 ticks of history, then a leader spike
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    // Leader spikes up: mid goes from 0.50 to 0.55 → return ~10%
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);

    let tickCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        // After enough history, spike yes-1 (leader) while yes-2 stays flat (laggard)
        if (tickCount >= 5 && tokenId === 'yes-1') {
          return Promise.resolve(spikedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0, // disable correlation filter for this test
        maxPositions: 5,
      },
    });
    const tick = createCrossEventDriftTick(deps);

    // Build 6 ticks of stable history first
    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    // Now tick with spike present
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('exits on take-profit', async () => {
    // Entry: buy YES on laggard at ask 0.51, TP at 2% → need price to reach ~0.5202
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);
    const tpBook = makeBook([['0.53', '100']], [['0.55', '100']]); // mid 0.54 → > 2% above 0.51

    let tickCount = 0;
    let entryDone = false;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (entryDone) {
          // After entry, return TP prices for the laggard
          return Promise.resolve(tpBook);
        }
        if (tickCount >= 5 && tokenId === 'yes-1') {
          return Promise.resolve(spikedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
        takeProfitPct: 0.02,
        stopLossPct: 0.5, // high SL to not interfere
        maxHoldMs: 999999999,
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    // Entry tick
    await tick();
    const entryCallCount = orderManager.placeOrder.mock.calls.length;
    expect(entryCallCount).toBeGreaterThan(0);

    // Now set up for TP exit
    entryDone = true;
    await tick();

    // Should have placed an exit order (more calls than entry)
    expect(orderManager.placeOrder.mock.calls.length).toBeGreaterThan(entryCallCount);
  });

  it('exits on stop-loss', async () => {
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);
    // SL book: price drops well below entry for YES position
    const slBook = makeBook([['0.43', '100']], [['0.45', '100']]); // mid 0.44 → big loss

    let tickCount = 0;
    let phase: 'build' | 'spike' | 'sl' = 'build';
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (phase === 'sl') {
          // Return SL price for laggard, stable for leader
          if (tokenId === 'yes-2') return Promise.resolve(slBook);
          return Promise.resolve(stableBook);
        }
        if (phase === 'spike' && tokenId === 'yes-1') {
          return Promise.resolve(spikedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
        takeProfitPct: 0.5, // high TP to not interfere
        stopLossPct: 0.015,
        maxHoldMs: 999999999,
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    phase = 'spike';
    await tick();
    const entryCallCount = orderManager.placeOrder.mock.calls.length;
    expect(entryCallCount).toBeGreaterThan(0);

    phase = 'sl';
    await tick();

    expect(orderManager.placeOrder.mock.calls.length).toBeGreaterThan(entryCallCount);
  });

  it('exits on convergence (laggard catches up to 50% of leader move)', async () => {
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);
    // Convergence: laggard moves enough that its return >= 50% of leader return
    // Leader return ~10%, so laggard needs ~5% return
    // Entry price was ~0.51, so mid of ~0.535 would be ~5% up
    const convergeBook = makeBook([['0.525', '100']], [['0.545', '100']]); // mid 0.535

    let tickCount = 0;
    let phase: 'build' | 'entry' | 'converge' = 'build';
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (phase === 'converge') {
          if (tokenId === 'yes-2' || tokenId === 'no-m2') {
            return Promise.resolve(convergeBook);
          }
          return Promise.resolve(spikedBook);
        }
        if (phase === 'entry' && tokenId === 'yes-1') {
          return Promise.resolve(spikedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
        takeProfitPct: 0.5,
        stopLossPct: 0.5,
        maxHoldMs: 999999999,
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    phase = 'entry';
    await tick();
    const entryCallCount = orderManager.placeOrder.mock.calls.length;
    expect(entryCallCount).toBeGreaterThan(0);

    // Now tick several times with converge prices to build return history
    phase = 'converge';
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Check that an exit was placed (convergence exit)
    expect(orderManager.placeOrder.mock.calls.length).toBeGreaterThan(entryCallCount);
  });

  it('exits on max hold time', async () => {
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);

    let tickCount = 0;
    let entryDone = false;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (entryDone) {
          // Return stable prices (no TP/SL trigger)
          return Promise.resolve(stableBook);
        }
        if (tickCount >= 5 && tokenId === 'yes-1') {
          return Promise.resolve(spikedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
        takeProfitPct: 0.5, // very high, won't trigger
        stopLossPct: 0.5,   // very high, won't trigger
        maxHoldMs: 1, // 1ms — will expire immediately
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    await tick();
    const entryCallCount = orderManager.placeOrder.mock.calls.length;
    expect(entryCallCount).toBeGreaterThan(0);

    entryDone = true;
    // Wait just a tiny bit so maxHoldMs of 1ms expires
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(orderManager.placeOrder.mock.calls.length).toBeGreaterThan(entryCallCount);
  });

  it('does not enter on cooldown', async () => {
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);
    const tpBook = makeBook([['0.53', '100']], [['0.55', '100']]);

    let tickCount = 0;
    let phase: 'build' | 'spike' | 'tp' | 'spike2' = 'build';
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (phase === 'tp') return Promise.resolve(tpBook);
        if (phase === 'spike2' && tokenId === 'yes-1') return Promise.resolve(spikedBook);
        if (phase === 'spike' && tokenId === 'yes-1') return Promise.resolve(spikedBook);
        return Promise.resolve(stableBook);
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
        takeProfitPct: 0.02,
        stopLossPct: 0.5,
        maxHoldMs: 999999999,
        cooldownMs: 999999999, // very long cooldown
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    // Entry
    phase = 'spike';
    await tick();
    const entryCallCount = orderManager.placeOrder.mock.calls.length;
    expect(entryCallCount).toBeGreaterThan(0);

    // TP exit
    phase = 'tp';
    await tick();
    const afterExitCount = orderManager.placeOrder.mock.calls.length;
    expect(afterExitCount).toBeGreaterThan(entryCallCount);

    // Try to re-enter — should be blocked by cooldown
    phase = 'spike2';
    await tick();
    expect(orderManager.placeOrder.mock.calls.length).toBe(afterExitCount);
  });

  it('respects maxPositions limit', async () => {
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const spikedBook = makeBook([['0.54', '100']], [['0.56', '100']]);

    let tickCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (tickCount >= 5 && (tokenId === 'yes-1' || tokenId === 'yes-3')) {
          return Promise.resolve(spikedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
          makeEvent([
            { id: 'm3', conditionId: 'c3', yesTokenId: 'yes-3' },
            { id: 'm4', conditionId: 'c4', yesTokenId: 'yes-4' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
        maxPositions: 1, // only 1 position allowed
        takeProfitPct: 0.5,
        stopLossPct: 0.5,
        maxHoldMs: 999999999,
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    await tick();

    // Only 1 entry order should be placed (maxPositions = 1)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('does not throw on API error from gamma', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createCrossEventDriftTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on API error from clob', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
    });
    const tick = createCrossEventDriftTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter when correlation is below minCorrelation', async () => {
    // Use random-ish prices for market A and stable for B → low correlation
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);

    let callIndex = 0;
    const zigzagPrices = [0.30, 0.70, 0.35, 0.65, 0.32, 0.68, 0.33, 0.67, 0.31, 0.80];
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (tokenId === 'yes-1') {
          const idx = Math.min(Math.floor(callIndex++ / 2), zigzagPrices.length - 1);
          const p = zigzagPrices[idx];
          return Promise.resolve(makeBook(
            [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
          ));
        }
        return Promise.resolve(stableBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.95, // very high, should block entry
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('correctly detects leader going down and buys NO on laggard', async () => {
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    // Leader drops: mid goes from 0.50 to 0.44 → negative return
    const droppedBook = makeBook([['0.43', '100']], [['0.45', '100']]);

    let tickCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        if (tickCount >= 5 && tokenId === 'yes-1') {
          return Promise.resolve(droppedBook);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const orderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
            { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
          ]),
        ]),
      } as any,
      config: {
        returnWindow: 5,
        lookbackPeriods: 5,
        driftThreshold: 0.03,
        followThreshold: 0.005,
        minCorrelation: 0.0,
      },
    });
    const tick = createCrossEventDriftTick(deps);

    for (let i = 0; i < 6; i++) {
      await tick();
      tickCount++;
    }

    await tick();

    expect(orderManager.placeOrder).toHaveBeenCalled();
    // The entry should be on the NO token of the laggard (no-m2)
    const call = orderManager.placeOrder.mock.calls[0][0];
    expect(call.tokenId).toBe('no-m2');
    expect(call.side).toBe('buy');
  });
});
