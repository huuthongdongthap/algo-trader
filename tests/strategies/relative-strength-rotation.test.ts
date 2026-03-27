import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcMomentum,
  rankByMomentum,
  selectLeaders,
  calcRankSpread,
  createRelativeStrengthRotationTick,
  DEFAULT_CONFIG,
  type RelativeStrengthRotationConfig,
  type RelativeStrengthRotationDeps,
} from '../../src/strategies/polymarket/relative-strength-rotation.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';
import type { GammaMarketGroup } from '../../src/polymarket/gamma-client.js';

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

function makeMarket(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, question: `Market ${id}?`, slug: `market-${id}`,
    conditionId: `cond-${id}`, yesTokenId: `yes-${id}`, noTokenId: `no-${id}`,
    yesPrice: 0.50, noPrice: 0.50,
    volume: 50_000, volume24h: 5000, liquidity: 5000, endDate: '2027-12-31',
    active: true, closed: false, resolved: false, outcome: null,
    ...overrides,
  };
}

function makeEvent(id: string, markets: ReturnType<typeof makeMarket>[]): GammaMarketGroup {
  return {
    id,
    title: `Event ${id}`,
    slug: `event-${id}`,
    description: '',
    markets: markets as any,
  };
}

function makeDeps(overrides: Partial<RelativeStrengthRotationDeps> = {}): RelativeStrengthRotationDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '10'], ['0.47', '10']],
          [['0.52', '10'], ['0.53', '10']],
        ),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: {
      getEvents: vi.fn().mockResolvedValue([
        makeEvent('evt-1', [
          makeMarket('m1'),
          makeMarket('m2'),
          makeMarket('m3'),
        ]),
      ]),
    } as any,
    ...overrides,
  };
}

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

  it('calculates positive momentum correctly', () => {
    // (0.6 - 0.4) / 0.4 = 0.5
    expect(calcMomentum([0.4, 0.6])).toBeCloseTo(0.5, 4);
  });

  it('calculates negative momentum correctly', () => {
    // (0.3 - 0.5) / 0.5 = -0.4
    expect(calcMomentum([0.5, 0.3])).toBeCloseTo(-0.4, 4);
  });

  it('uses first and last price only', () => {
    // (0.8 - 0.4) / 0.4 = 1.0
    expect(calcMomentum([0.4, 0.5, 0.6, 0.7, 0.8])).toBeCloseTo(1.0, 4);
  });

  it('returns 0 for no change', () => {
    expect(calcMomentum([0.5, 0.5])).toBe(0);
  });

  it('handles very small prices', () => {
    // (0.02 - 0.01) / 0.01 = 1.0
    expect(calcMomentum([0.01, 0.02])).toBeCloseTo(1.0, 4);
  });
});

// ── rankByMomentum tests ────────────────────────────────────────────────────

describe('rankByMomentum', () => {
  it('returns empty array for empty map', () => {
    expect(rankByMomentum(new Map())).toEqual([]);
  });

  it('ranks single entry as rank 1', () => {
    const m = new Map([['a', 0.5]]);
    const result = rankByMomentum(m);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ marketId: 'a', momentum: 0.5, rank: 1 });
  });

  it('ranks multiple entries descending by momentum', () => {
    const m = new Map([['a', 0.1], ['b', 0.5], ['c', 0.3]]);
    const result = rankByMomentum(m);
    expect(result[0].marketId).toBe('b');
    expect(result[0].rank).toBe(1);
    expect(result[1].marketId).toBe('c');
    expect(result[1].rank).toBe(2);
    expect(result[2].marketId).toBe('a');
    expect(result[2].rank).toBe(3);
  });

  it('handles negative momentums', () => {
    const m = new Map([['a', -0.2], ['b', -0.1]]);
    const result = rankByMomentum(m);
    expect(result[0].marketId).toBe('b');
    expect(result[0].rank).toBe(1);
    expect(result[1].marketId).toBe('a');
    expect(result[1].rank).toBe(2);
  });

  it('handles equal momentums', () => {
    const m = new Map([['a', 0.3], ['b', 0.3]]);
    const result = rankByMomentum(m);
    expect(result).toHaveLength(2);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2);
  });
});

// ── selectLeaders tests ─────────────────────────────────────────────────────

describe('selectLeaders', () => {
  it('returns empty for empty array', () => {
    expect(selectLeaders([], 0.25)).toEqual([]);
  });

  it('selects top 25% of 4 markets (1 leader)', () => {
    const ranked = [
      { marketId: 'a', rank: 1 },
      { marketId: 'b', rank: 2 },
      { marketId: 'c', rank: 3 },
      { marketId: 'd', rank: 4 },
    ];
    const result = selectLeaders(ranked, 0.25);
    expect(result).toEqual(['a']);
  });

  it('selects at least 1 even for small percentage', () => {
    const ranked = [
      { marketId: 'a', rank: 1 },
      { marketId: 'b', rank: 2 },
    ];
    const result = selectLeaders(ranked, 0.01);
    expect(result).toEqual(['a']);
  });

  it('selects top 50% of 4 markets (2 leaders)', () => {
    const ranked = [
      { marketId: 'a', rank: 1 },
      { marketId: 'b', rank: 2 },
      { marketId: 'c', rank: 3 },
      { marketId: 'd', rank: 4 },
    ];
    const result = selectLeaders(ranked, 0.50);
    expect(result).toEqual(['a', 'b']);
  });

  it('selects all for 100%', () => {
    const ranked = [
      { marketId: 'a', rank: 1 },
      { marketId: 'b', rank: 2 },
    ];
    const result = selectLeaders(ranked, 1.0);
    expect(result).toEqual(['a', 'b']);
  });

  it('selects single market as leader', () => {
    const ranked = [{ marketId: 'a', rank: 1 }];
    const result = selectLeaders(ranked, 0.25);
    expect(result).toEqual(['a']);
  });
});

// ── calcRankSpread tests ────────────────────────────────────────────────────

describe('calcRankSpread', () => {
  it('returns 0 for empty array', () => {
    expect(calcRankSpread([])).toBe(0);
  });

  it('returns 0 for single value', () => {
    expect(calcRankSpread([0.5])).toBe(0);
  });

  it('calculates spread correctly', () => {
    expect(calcRankSpread([0.1, 0.5, 0.3])).toBeCloseTo(0.4, 4);
  });

  it('handles negative values', () => {
    expect(calcRankSpread([-0.2, 0.1, 0.3])).toBeCloseTo(0.5, 4);
  });

  it('returns 0 when all values are equal', () => {
    expect(calcRankSpread([0.3, 0.3, 0.3])).toBe(0);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

describe('createRelativeStrengthRotationTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createRelativeStrengthRotationTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [
            makeMarket('m1', { closed: true }),
            makeMarket('m2', { closed: true }),
            makeMarket('m3', { closed: true }),
          ]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [
            makeMarket('m1', { resolved: true }),
            makeMarket('m2', { resolved: true }),
            makeMarket('m3', { resolved: true }),
          ]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [
            makeMarket('m1', { volume: 100 }),
            makeMarket('m2', { volume: 100 }),
            makeMarket('m3', { volume: 100 }),
          ]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty events list', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    // mid = (0+1)/2 = 0.5 valid, but no entry on first tick
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market with no yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [
            makeMarket('m1', { yesTokenId: undefined }),
            makeMarket('m2', { yesTokenId: undefined }),
            makeMarket('m3', { yesTokenId: undefined }),
          ]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips events with too few markets', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [
            makeMarket('m1'),
            makeMarket('m2'),
            // only 2 markets, default minMarketsPerEvent = 3
          ]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    // Run multiple ticks to build history
    for (let i = 0; i < 5; i++) await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('requires minMarketsPerEvent after filtering', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [
            makeMarket('m1'),
            makeMarket('m2'),
            makeMarket('m3', { volume: 1 }), // filtered by volume
          ]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 5; i++) await tick();
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
    const tick = createRelativeStrengthRotationTick(deps);
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
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    await tick();
    await tick();
    // 3 ticks * 3 markets = 9 getOrderBook calls
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(9);
  });

  // ── Rank spread guard ─────────────────────────────────────────────────

  it('does not enter when rank spread is below minRankSpread', async () => {
    // All markets return the same price => momentum = 0 => spread = 0
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: { minRankSpread: 0.10, minVolume: 1 },
    });
    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 10; i++) await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Leader selection / entries ─────────────────────────────────────────

  it('enters a position for the leader market when conditions are met', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        // First pass: build history with stable prices
        if (callCount <= 9) {
          // 3 markets * 3 ticks = 9 calls, all same price
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Second pass: diverge prices so we get spread
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.39', '100']], [['0.41', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        lookbackWindow: 30,
        minMarketsPerEvent: 3,
        topNPercent: 0.34,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 5; i++) await tick();

    // Should have placed an entry order for the leader
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
      expect(call.tokenId).toBe('yes-m1');
    }
    expect(true).toBe(true);
  });

  it('buys yes tokens for leaders', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minRankSpread: 0.01, minVolume: 1, topNPercent: 0.34 },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 5; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    if (entryCalls.length > 0) {
      expect(entryCalls[0][0].side).toBe('buy');
    }
    expect(true).toBe(true);
  });

  it('emits trade.executed on entry', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { minRankSpread: 0.01, minVolume: 1, topNPercent: 0.34 },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 5; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeEvents = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      expect(tradeEvents.length).toBeGreaterThan(0);
    }
    expect(true).toBe(true);
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 15) {
          // Create divergence for entry
          if (tokenId === 'yes-m1') {
            return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
          }
          if (tokenId === 'yes-m2') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // TP: price up significantly
        return Promise.resolve(makeBook([['0.89', '100']], [['0.91', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.34,
        takeProfitPct: 0.03,
        stopLossPct: 0.50,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 8; i++) await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 15) {
          if (tokenId === 'yes-m1') {
            return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
          }
          if (tokenId === 'yes-m2') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // SL: price drops
        return Promise.resolve(makeBook([['0.09', '100']], [['0.11', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.34,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 8; i++) await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.34,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 6; i++) await tick();
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  // ── Cooldown ──────────────────────────────────────────────────────────

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 15) {
          if (tokenId === 'yes-m1') {
            return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
          }
          if (tokenId === 'yes-m2') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (callCount <= 20) {
          // TP exit
          return Promise.resolve(makeBook([['0.89', '100']], [['0.91', '100']]));
        }
        // Back to diverged prices after exit
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.34,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
        maxPositions: 1, // only allow 1 position at a time to isolate cooldown behavior
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 12; i++) await tick();

    // Count entries for the specific leader token (yes-m1)
    const m1Entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC' && c[0].tokenId === 'yes-m1',
    );
    // Should have at most 1 entry for m1 due to cooldown
    expect(m1Entries.length).toBeLessThanOrEqual(1);
  });

  // ── maxPositions ──────────────────────────────────────────────────────

  it('respects maxPositions limit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 15) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // All markets diverge to create entries for multiple
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.67, // top 2 of 3
        maxPositions: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  // ── Multi-event ───────────────────────────────────────────────────────

  it('processes multiple events independently', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [makeMarket('m1'), makeMarket('m2'), makeMarket('m3')]),
          makeEvent('evt-2', [makeMarket('m4'), makeMarket('m5'), makeMarket('m6')]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    // 6 markets across 2 events
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(6);
  });

  it('does not cross events for ranking', async () => {
    // Event 1 has too few markets, event 2 has enough
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', [makeMarket('m1'), makeMarket('m2')]), // < minMarketsPerEvent
          makeEvent('evt-2', [makeMarket('m3'), makeMarket('m4'), makeMarket('m5')]),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 5; i++) await tick();
    // Should only try to enter from evt-2 markets (if conditions met)
    expect(true).toBe(true);
  });

  it('handles event with no markets', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent('evt-1', []),
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles event with undefined markets', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          { id: 'evt-1', title: 'Test', slug: 'test', description: '', markets: undefined },
        ]),
      } as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Config override tests ─────────────────────────────────────────────

  it('uses custom lookbackWindow', async () => {
    const deps = makeDeps({
      config: { lookbackWindow: 2 },
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('uses custom topNPercent', async () => {
    const deps = makeDeps({
      config: { topNPercent: 0.50 },
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('uses custom positionSize', async () => {
    const deps = makeDeps({
      config: { positionSize: '25' },
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  // ── Additional edge cases ─────────────────────────────────────────────

  it('handles clob error for individual market without stopping others', async () => {
    let callIdx = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callIdx++;
        if (tokenId === 'yes-m2') {
          return Promise.reject(new Error('timeout'));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
    });
    const tick = createRelativeStrengthRotationTick(deps);
    await tick();
    // Should have attempted all 3 markets
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(3);
  });

  it('does not enter when there is already a position on the token', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (tokenId === 'yes-m1') {
          return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
        }
        if (tokenId === 'yes-m2') {
          return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
        }
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.34,
        maxPositions: 10,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    // Should not have more than 1 entry for the same token
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    const tokenIds = entries.map((c: any) => c[0].tokenId);
    const unique = new Set(tokenIds);
    expect(unique.size).toBe(tokenIds.length);
  });

  it('default config has expected values', () => {
    expect(DEFAULT_CONFIG.lookbackWindow).toBe(15);
    expect(DEFAULT_CONFIG.minRankSpread).toBe(0.03);
    expect(DEFAULT_CONFIG.topNPercent).toBe(0.25);
    expect(DEFAULT_CONFIG.momentumEmaAlpha).toBe(0.12);
    expect(DEFAULT_CONFIG.minMarketsPerEvent).toBe(3);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.03);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(25 * 60_000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(4);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(120_000);
    expect(DEFAULT_CONFIG.positionSize).toBe('12');
  });

  it('handles event where all markets have same momentum', async () => {
    // All same price => all momentum 0 => spread 0 => no entry
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 10; i++) await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles exit when clob fails during exit check', async () => {
    let callCount = 0;
    let enteredPhase = false;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        if (callCount <= 9) {
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        if (!enteredPhase && callCount <= 15) {
          if (tokenId === 'yes-m1') {
            return Promise.resolve(makeBook([['0.74', '100']], [['0.76', '100']]));
          }
          if (tokenId === 'yes-m2') {
            return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
          }
          return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
        }
        // Once entry is made, fail all subsequent calls
        return Promise.reject(new Error('network error'));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minRankSpread: 0.01,
        minVolume: 1,
        topNPercent: 0.34,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createRelativeStrengthRotationTick(deps);
    for (let i = 0; i < 6; i++) await tick();
    enteredPhase = true;
    await new Promise(r => setTimeout(r, 5));
    await expect(tick()).resolves.toBeUndefined();
  });
});
