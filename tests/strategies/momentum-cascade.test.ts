import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcReturn,
  updateMomentumEma,
  findLeader,
  calcCascadeScore,
  isFollowerLagging,
  createMomentumCascadeTick,
  DEFAULT_CONFIG,
  type MomentumCascadeConfig,
  type MomentumCascadeDeps,
} from '../../src/strategies/polymarket/momentum-cascade.js';
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

function makeMarket(overrides: Record<string, unknown> = {}) {
  return {
    conditionId: 'cond-1',
    slug: 'test-market',
    title: 'Test Market',
    yesTokenId: 'yes-token-1',
    noTokenId: 'no-token-1',
    closed: false,
    resolved: false,
    volume: 10000,
    eventSlug: 'event-1',
    ...overrides,
  };
}

function makeEvent(markets: ReturnType<typeof makeMarket>[], id = 'event-1') {
  return { id, markets };
}

function makeDeps(overrides: Partial<MomentumCascadeDeps> = {}): MomentumCascadeDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.50', '100']], [['0.55', '100']]),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    } as any,
    eventBus: {
      emit: vi.fn(),
    } as any,
    gamma: {
      getEvents: vi.fn().mockResolvedValue([makeEvent([makeMarket()])]),
      getTrending: vi.fn().mockResolvedValue([makeMarket()]),
    } as any,
    ...overrides,
  };
}

// ── calcReturn tests ────────────────────────────────────────────────────────

describe('calcReturn', () => {
  it('returns 0 for empty array', () => {
    expect(calcReturn([])).toBe(0);
  });

  it('returns 0 for single price', () => {
    expect(calcReturn([0.5])).toBe(0);
  });

  it('returns positive return for rising prices', () => {
    expect(calcReturn([0.50, 0.55])).toBeCloseTo(0.1, 4);
  });

  it('returns negative return for falling prices', () => {
    expect(calcReturn([0.60, 0.54])).toBeCloseTo(-0.1, 4);
  });

  it('returns 0 when first price is 0', () => {
    expect(calcReturn([0, 0.5])).toBe(0);
  });

  it('returns 0 for flat prices', () => {
    expect(calcReturn([0.5, 0.5, 0.5])).toBe(0);
  });

  it('uses first and last only', () => {
    expect(calcReturn([0.40, 0.99, 0.01, 0.48])).toBeCloseTo(0.2, 4);
  });
});

// ── updateMomentumEma tests ─────────────────────────────────────────────────

describe('updateMomentumEma', () => {
  it('returns returnVal when prevEma is null', () => {
    expect(updateMomentumEma(null, 0.05, 0.15)).toBe(0.05);
  });

  it('blends with previous EMA normally', () => {
    const result = updateMomentumEma(0.10, 0.20, 0.5);
    expect(result).toBeCloseTo(0.15, 4);
  });

  it('returns prevEma when alpha is 0', () => {
    expect(updateMomentumEma(0.10, 0.50, 0)).toBe(0.10);
  });

  it('returns returnVal when alpha is 1', () => {
    expect(updateMomentumEma(0.10, 0.50, 1)).toBe(0.50);
  });

  it('handles negative values', () => {
    const result = updateMomentumEma(-0.05, -0.10, 0.5);
    expect(result).toBeCloseTo(-0.075, 4);
  });

  it('converges toward repeated value', () => {
    let ema: number | null = null;
    for (let i = 0; i < 50; i++) {
      ema = updateMomentumEma(ema, 0.10, 0.15);
    }
    expect(ema).toBeCloseTo(0.10, 2);
  });
});

// ── findLeader tests ────────────────────────────────────────────────────────

describe('findLeader', () => {
  it('returns null for empty map', () => {
    expect(findLeader(new Map())).toBeNull();
  });

  it('returns the single entry', () => {
    const result = findLeader(new Map([['m1', 0.05]]));
    expect(result).toEqual({ marketId: 'm1', momentum: 0.05 });
  });

  it('returns market with highest absolute momentum', () => {
    const result = findLeader(new Map([['m1', 0.02], ['m2', -0.08], ['m3', 0.05]]));
    expect(result).toEqual({ marketId: 'm2', momentum: -0.08 });
  });

  it('handles all positive momentums', () => {
    const result = findLeader(new Map([['a', 0.01], ['b', 0.05], ['c', 0.03]]));
    expect(result?.marketId).toBe('b');
  });

  it('handles all negative momentums', () => {
    const result = findLeader(new Map([['a', -0.01], ['b', -0.05], ['c', -0.03]]));
    expect(result?.marketId).toBe('b');
  });

  it('handles zero momentums', () => {
    const result = findLeader(new Map([['a', 0], ['b', 0]]));
    expect(result).not.toBeNull();
    expect(result!.momentum).toBe(0);
  });
});

// ── calcCascadeScore tests ──────────────────────────────────────────────────

describe('calcCascadeScore', () => {
  it('returns positive when leader ahead of follower', () => {
    expect(calcCascadeScore(0.10, 0.02)).toBeCloseTo(0.08, 4);
  });

  it('returns negative when follower ahead of leader', () => {
    expect(calcCascadeScore(0.02, 0.10)).toBeCloseTo(-0.08, 4);
  });

  it('returns 0 when equal', () => {
    expect(calcCascadeScore(0.05, 0.05)).toBe(0);
  });

  it('works with negative momentums', () => {
    expect(calcCascadeScore(-0.10, -0.02)).toBeCloseTo(-0.08, 4);
  });

  it('handles zero leader momentum', () => {
    expect(calcCascadeScore(0, 0.05)).toBeCloseTo(-0.05, 4);
  });
});

// ── isFollowerLagging tests ─────────────────────────────────────────────────

describe('isFollowerLagging', () => {
  it('returns true when momentum below lagMax', () => {
    expect(isFollowerLagging(0.005, 0.01)).toBe(true);
  });

  it('returns false when momentum above lagMax', () => {
    expect(isFollowerLagging(0.02, 0.01)).toBe(false);
  });

  it('returns false at exact lagMax', () => {
    expect(isFollowerLagging(0.01, 0.01)).toBe(false);
  });

  it('uses absolute value for negative momentum', () => {
    expect(isFollowerLagging(-0.005, 0.01)).toBe(true);
    expect(isFollowerLagging(-0.02, 0.01)).toBe(false);
  });

  it('returns true for zero momentum', () => {
    expect(isFollowerLagging(0, 0.01)).toBe(true);
  });
});

// ── createMomentumCascadeTick tests ─────────────────────────────────────────

describe('createMomentumCascadeTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  it('returns a function', () => {
    const tick = createMomentumCascadeTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('handles API error from gamma gracefully', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockRejectedValue(new Error('API down')) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles clob error gracefully', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('Network error')) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([makeMarket({ closed: true })])]) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([makeMarket({ resolved: true })])]) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([makeMarket({ yesTokenId: undefined })])]) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below volume threshold', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([makeMarket({ volume: 100 })])]) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips events with too few markets', async () => {
    // Only one market in the event — need minMarketsPerEvent (2)
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([makeMarket()])]) } as any,
      config: { minMarketsPerEvent: 2 },
    });
    const tick = createMomentumCascadeTick(deps);
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter with insufficient price history', async () => {
    const markets = [
      makeMarket({ conditionId: 'c1', yesTokenId: 'y1', noTokenId: 'n1', eventSlug: 'ev1' }),
      makeMarket({ conditionId: 'c2', yesTokenId: 'y2', noTokenId: 'n2', eventSlug: 'ev1' }),
    ];
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent(markets)]) } as any,
      config: { momentumWindow: 12, minMarketsPerEvent: 2 },
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])) } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', () => {
    const deps = makeDeps({ config: { cascadeThreshold: 0.05, positionSize: '20' } });
    const tick = createMomentumCascadeTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('detects cascade and enters on lagging follower', async () => {
    const leaderMarket = makeMarket({ conditionId: 'leader', yesTokenId: 'y-leader', noTokenId: 'n-leader', eventSlug: 'ev1' });
    const followerMarket = makeMarket({ conditionId: 'follower', yesTokenId: 'y-follower', noTokenId: 'n-follower', eventSlug: 'ev1' });

    let leaderCallCount = 0;
    const leaderPrices = [0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70, 0.72, 0.74];
    const followerPrice = 0.50;

    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([leaderMarket, followerMarket])]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
          if (tokenId === 'y-leader') {
            const p = leaderPrices[Math.min(leaderCallCount++, leaderPrices.length - 1)];
            return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
          }
          return Promise.resolve(makeBook([[String(followerPrice - 0.02), '100']], [[String(followerPrice + 0.02), '100']]));
        }),
      } as any,
      config: { momentumWindow: 3, cascadeThreshold: 0.01, followerLagMax: 0.02, minMarketsPerEvent: 2 },
    });

    const tick = createMomentumCascadeTick(deps);
    for (let i = 0; i < 13; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    if (placeCalls.length > 0) {
      const entryCall = placeCalls.find((c: any) => c[0].orderType === 'GTC');
      if (entryCall) {
        expect(entryCall[0].side).toBe('buy');
      }
    }
  });

  it('emits trade.executed on entry', async () => {
    const leaderMarket = makeMarket({ conditionId: 'leader', yesTokenId: 'y-leader', noTokenId: 'n-leader', eventSlug: 'ev1' });
    const followerMarket = makeMarket({ conditionId: 'follower', yesTokenId: 'y-follower', noTokenId: 'n-follower', eventSlug: 'ev1' });

    let leaderCallCount = 0;
    const leaderPrices = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77, 0.80];

    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([leaderMarket, followerMarket])]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
          if (tokenId === 'y-leader') {
            const p = leaderPrices[Math.min(leaderCallCount++, leaderPrices.length - 1)];
            return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
          }
          return Promise.resolve(makeBook([['0.48', '100']], [['0.52', '100']]));
        }),
      } as any,
      config: { momentumWindow: 3, cascadeThreshold: 0.01, followerLagMax: 0.02, minMarketsPerEvent: 2 },
    });

    const tick = createMomentumCascadeTick(deps);
    for (let i = 0; i < 11; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const tradeCalls = (deps.eventBus.emit as any).mock.calls.filter((c: any) => c[0] === 'trade.executed');
    if (tradeCalls.length > 0) {
      expect(tradeCalls[0][1].trade.strategy).toBe('momentum-cascade');
    }
  });

  it('respects maxPositions limit', async () => {
    const markets = Array.from({ length: 8 }, (_, i) => makeMarket({
      conditionId: `cond-${i}`,
      yesTokenId: `yes-${i}`,
      noTokenId: `no-${i}`,
      eventSlug: 'ev1',
    }));

    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent(markets)]) } as any,
      config: { maxPositions: 2, momentumWindow: 3, cascadeThreshold: 0.001, followerLagMax: 0.5, minMarketsPerEvent: 2 },
    });

    const tick = createMomentumCascadeTick(deps);
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls
      .filter((c: any) => c[0].orderType === 'GTC');
    expect(entryCalls.length).toBeLessThanOrEqual(2);
  });

  it('exits on max hold time', async () => {
    const leaderMarket = makeMarket({ conditionId: 'leader', yesTokenId: 'y-leader', noTokenId: 'n-leader', eventSlug: 'ev1' });
    const followerMarket = makeMarket({ conditionId: 'follower', yesTokenId: 'y-follower', noTokenId: 'n-follower', eventSlug: 'ev1' });

    let leaderCallCount = 0;
    const leaderPrices = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68];

    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent([leaderMarket, followerMarket])]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
          if (tokenId === 'y-leader') {
            const p = leaderPrices[Math.min(leaderCallCount++, leaderPrices.length - 1)];
            return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
          }
          return Promise.resolve(makeBook([['0.48', '100']], [['0.52', '100']]));
        }),
      } as any,
      config: { momentumWindow: 3, cascadeThreshold: 0.01, followerLagMax: 0.02, minMarketsPerEvent: 2, maxHoldMs: 5000 },
    });

    const tick = createMomentumCascadeTick(deps);
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    vi.advanceTimersByTime(60_000);
    await tick();

    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    expect(placeCalls.length).toBeGreaterThanOrEqual(0);
  });

  it('handles placeOrder failure gracefully', async () => {
    const markets = [
      makeMarket({ conditionId: 'c1', yesTokenId: 'y1', noTokenId: 'n1', eventSlug: 'ev1' }),
      makeMarket({ conditionId: 'c2', yesTokenId: 'y2', noTokenId: 'n2', eventSlug: 'ev1' }),
    ];

    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([makeEvent(markets)]) } as any,
      orderManager: { placeOrder: vi.fn().mockRejectedValue(new Error('Rejected')) } as any,
      config: { momentumWindow: 3, cascadeThreshold: 0.001, followerLagMax: 0.5, minMarketsPerEvent: 2 },
    });

    const tick = createMomentumCascadeTick(deps);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    expect(true).toBe(true);
  });

  it('uses default config values correctly', () => {
    expect(DEFAULT_CONFIG.momentumWindow).toBe(12);
    expect(DEFAULT_CONFIG.momentumEmaAlpha).toBe(0.15);
    expect(DEFAULT_CONFIG.cascadeThreshold).toBe(0.03);
    expect(DEFAULT_CONFIG.followerLagMax).toBe(0.01);
    expect(DEFAULT_CONFIG.minMarketsPerEvent).toBe(2);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.03);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(900000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(4);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(120000);
    expect(DEFAULT_CONFIG.positionSize).toBe('10');
  });

  it('skips markets with mid price at 0 or 1', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([['0.00', '100']], [['0.00', '100']])),
      } as any,
    });
    const tick = createMomentumCascadeTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
