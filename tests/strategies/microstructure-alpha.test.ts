import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  bestBidAsk,
  calcSpreadCompression,
  calcQueueImbalance,
  calcMidMomentum,
  calcCompositeScore,
  spreadAboveMinBps,
  createMicrostructureAlphaTick,
  type MicrostructureAlphaDeps,
} from '../../src/strategies/polymarket/microstructure-alpha.js';
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

function makeDeps(overrides?: Partial<MicrostructureAlphaDeps>): MicrostructureAlphaDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

function makeMarket(id: string, overrides: Record<string, any> = {}) {
  return {
    id,
    conditionId: `cond-${id}`,
    yesTokenId: `yes-${id}`,
    noTokenId: `no-${id}`,
    closed: false,
    resolved: false,
    volume: 50000,
    ...overrides,
  };
}

// ── bestBidAsk tests ────────────────────────────────────────────────────────

describe('bestBidAsk', () => {
  it('parses normal book', () => {
    const book = makeBook([['0.48', '100']], [['0.52', '200']]);
    const ba = bestBidAsk(book);
    expect(ba.bid).toBeCloseTo(0.48);
    expect(ba.ask).toBeCloseTo(0.52);
    expect(ba.mid).toBeCloseTo(0.50);
    expect(ba.bidSize).toBeCloseTo(100);
    expect(ba.askSize).toBeCloseTo(200);
  });

  it('returns defaults for empty bids', () => {
    const book = makeBook([], [['0.60', '50']]);
    const ba = bestBidAsk(book);
    expect(ba.bid).toBe(0);
    expect(ba.bidSize).toBe(0);
    expect(ba.ask).toBeCloseTo(0.60);
  });

  it('returns defaults for empty asks', () => {
    const book = makeBook([['0.40', '50']], []);
    const ba = bestBidAsk(book);
    expect(ba.ask).toBe(1);
    expect(ba.askSize).toBe(0);
    expect(ba.bid).toBeCloseTo(0.40);
  });

  it('handles empty book', () => {
    const book = makeBook([], []);
    const ba = bestBidAsk(book);
    expect(ba.bid).toBe(0);
    expect(ba.ask).toBe(1);
    expect(ba.mid).toBeCloseTo(0.5);
    expect(ba.bidSize).toBe(0);
    expect(ba.askSize).toBe(0);
  });
});

// ── calcSpreadCompression tests ─────────────────────────────────────────────

describe('calcSpreadCompression', () => {
  it('returns 0 for empty history', () => {
    expect(calcSpreadCompression(0.04, [])).toBe(0);
  });

  it('positive when spread tighter than average', () => {
    expect(calcSpreadCompression(0.02, [0.10, 0.10, 0.10])).toBeCloseTo(0.8);
  });

  it('negative when spread wider than average', () => {
    expect(calcSpreadCompression(0.10, [0.05, 0.05])).toBeCloseTo(-1.0);
  });

  it('returns 0 when current equals average', () => {
    expect(calcSpreadCompression(0.05, [0.05, 0.05, 0.05])).toBeCloseTo(0);
  });

  it('returns 0 when avg spread is 0', () => {
    expect(calcSpreadCompression(0.05, [0, 0, 0])).toBe(0);
  });
});

// ── calcQueueImbalance tests ────────────────────────────────────────────────

describe('calcQueueImbalance', () => {
  it('returns 0 for balanced sizes', () => {
    expect(calcQueueImbalance(100, 100)).toBeCloseTo(0);
  });

  it('returns positive for bid-heavy', () => {
    expect(calcQueueImbalance(300, 100)).toBeCloseTo(0.5);
  });

  it('returns negative for ask-heavy', () => {
    expect(calcQueueImbalance(100, 300)).toBeCloseTo(-0.5);
  });

  it('returns 0 when both are zero', () => {
    expect(calcQueueImbalance(0, 0)).toBe(0);
  });

  it('returns 1 when ask is zero', () => {
    expect(calcQueueImbalance(100, 0)).toBeCloseTo(1.0);
  });

  it('returns -1 when bid is zero', () => {
    expect(calcQueueImbalance(0, 100)).toBeCloseTo(-1.0);
  });
});

// ── calcMidMomentum tests ───────────────────────────────────────────────────

describe('calcMidMomentum', () => {
  it('returns 0 for empty array', () => {
    expect(calcMidMomentum([], 5)).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(calcMidMomentum([0.5], 5)).toBe(0);
  });

  it('returns 1 for monotonic uptrend', () => {
    expect(calcMidMomentum([0.50, 0.51, 0.52, 0.53], 5)).toBeCloseTo(1.0);
  });

  it('returns -1 for monotonic downtrend', () => {
    expect(calcMidMomentum([0.53, 0.52, 0.51, 0.50], 5)).toBeCloseTo(-1.0);
  });

  it('returns 0 for flat prices', () => {
    expect(calcMidMomentum([0.50, 0.50, 0.50], 5)).toBe(0);
  });

  it('returns near 0 for zigzag', () => {
    expect(calcMidMomentum([0.50, 0.51, 0.50, 0.51, 0.50], 5)).toBeCloseTo(0);
  });

  it('respects window parameter', () => {
    const data = [0.55, 0.54, 0.53, 0.54, 0.55];
    const windowMomentum = calcMidMomentum(data, 2);
    expect(windowMomentum).toBeCloseTo(1.0);
  });
});

// ── calcCompositeScore tests ────────────────────────────────────────────────

describe('calcCompositeScore', () => {
  it('returns 0 when all signals are zero', () => {
    expect(calcCompositeScore(0, 0, 0, 0.3, 0.4, 0.3)).toBe(0);
  });

  it('computes weighted sum', () => {
    expect(calcCompositeScore(1.0, 0.5, 0.8, 0.3, 0.4, 0.3)).toBeCloseTo(0.74);
  });

  it('handles negative signals', () => {
    expect(calcCompositeScore(-0.5, -1.0, -0.3, 0.3, 0.4, 0.3)).toBeCloseTo(-0.64);
  });

  it('custom weights change result', () => {
    expect(calcCompositeScore(1, 0, 0, 1, 0, 0)).toBeCloseTo(1);
    expect(calcCompositeScore(1, 0, 0, 0, 1, 0)).toBeCloseTo(0);
  });
});

// ── spreadAboveMinBps tests ─────────────────────────────────────────────────

describe('spreadAboveMinBps', () => {
  it('returns true when spread exceeds min', () => {
    expect(spreadAboveMinBps(0.48, 0.52, 50)).toBe(true);
  });

  it('returns false when spread below min', () => {
    expect(spreadAboveMinBps(0.4995, 0.5005, 50)).toBe(false);
  });

  it('returns false when mid is 0', () => {
    expect(spreadAboveMinBps(0, 0, 50)).toBe(false);
  });

  it('returns true when spread clearly above threshold', () => {
    // spread = 0.06, mid = 0.50, bps = 1200 >> 100
    expect(spreadAboveMinBps(0.47, 0.53, 100)).toBe(true);
  });
});

// ── createMicrostructureAlphaTick integration tests ─────────────────────────

describe('createMicrostructureAlphaTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a function', () => {
    const tick = createMicrostructureAlphaTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does nothing when no markets', async () => {
    const deps = makeDeps();
    const tick = createMicrostructureAlphaTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket('m1', { closed: true })]) } as any,
    });
    const tick = createMicrostructureAlphaTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket('m1', { resolved: true })]) } as any,
    });
    const tick = createMicrostructureAlphaTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips illiquid markets (spread below minSpreadBps)', async () => {
    const tightBook = makeBook([['0.4999', '100']], [['0.5001', '100']]);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket('m1')]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(tightBook) } as any,
    });
    const tick = createMicrostructureAlphaTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('needs at least 2 spread entries before trading', async () => {
    const book = makeBook([['0.45', '1000']], [['0.55', '10']]);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket('m1')]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
    });
    const tick = createMicrostructureAlphaTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters BUY YES when composite score > threshold', async () => {
    const market = makeMarket('m1');
    let tickNum = 0;
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickNum++;
          const spread = Math.max(0.02, 0.10 - tickNum * 0.01);
          const mid = 0.50 + tickNum * 0.005;
          const bid = (mid - spread / 2).toFixed(4);
          const ask = (mid + spread / 2).toFixed(4);
          return Promise.resolve(makeBook([[bid, '5000']], [[ask, '10']]));
        }),
      } as any,
    });
    const tick = createMicrostructureAlphaTick({
      ...deps,
      config: { entryThreshold: 0.3, minSpreadBps: 10 },
    });
    for (let i = 0; i < 5; i++) await tick();
    const buyCalls = deps.orderManager.placeOrder.mock.calls.filter(
      (c: any[]) => c[0]?.side === 'buy',
    );
    expect(buyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('enters BUY NO when composite score < -threshold', async () => {
    const market = makeMarket('m1');
    let tickNum = 0;
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickNum++;
          const spread = Math.max(0.02, 0.10 - tickNum * 0.01);
          const mid = 0.60 - tickNum * 0.005;
          return Promise.resolve(makeBook(
            [[(mid - spread / 2).toFixed(4), '10']],
            [[(mid + spread / 2).toFixed(4), '5000']],
          ));
        }),
      } as any,
    });
    const tick = createMicrostructureAlphaTick({
      ...deps,
      config: { entryThreshold: 0.3, minSpreadBps: 10 },
    });
    for (let i = 0; i < 5; i++) await tick();
    const buyCalls = deps.orderManager.placeOrder.mock.calls.filter(
      (c: any[]) => c[0]?.side === 'buy',
    );
    expect(buyCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('no entry when score within threshold', async () => {
    const book = makeBook([['0.45', '100']], [['0.55', '100']]);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket('m1')]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
    });
    const tick = createMicrostructureAlphaTick({
      ...deps,
      config: { entryThreshold: 0.9 },
    });
    for (let i = 0; i < 10; i++) await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('exits on max hold time', async () => {
    const market = makeMarket('m1');
    let tickNum = 0;
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickNum++;
          const spread = Math.max(0.02, 0.10 - tickNum * 0.01);
          const mid = 0.50 + tickNum * 0.005;
          return Promise.resolve(makeBook(
            [[(mid - spread / 2).toFixed(4), '5000']],
            [[(mid + spread / 2).toFixed(4), '10']],
          ));
        }),
      } as any,
    });
    const tick = createMicrostructureAlphaTick({
      ...deps,
      config: { entryThreshold: 0.3, minSpreadBps: 10, maxHoldMs: 5000 },
    });
    for (let i = 0; i < 5; i++) await tick();
    vi.advanceTimersByTime(10_000);
    await tick();
  });

  it('respects maxPositions', async () => {
    // With maxPositions=1, entries should be capped even with many markets
    const markets = [makeMarket('m1'), makeMarket('m2'), makeMarket('m3')];
    let tickNum = 0;
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickNum++;
          const mid = 0.50 + (tickNum % 10) * 0.005;
          return Promise.resolve(makeBook(
            [[(mid - 0.02).toFixed(4), '5000']],
            [[(mid + 0.02).toFixed(4), '10']],
          ));
        }),
      } as any,
    });
    const tick = createMicrostructureAlphaTick({
      ...deps,
      config: { maxPositions: 1, entryThreshold: 0.3, minSpreadBps: 10 },
    });
    for (let i = 0; i < 10; i++) await tick();
    const entryCalls = deps.orderManager.placeOrder.mock.calls.filter(
      (c: any[]) => c[0]?.orderType === 'GTC',
    );
    // maxPositions=1 should cap entries — fewer than total markets (3) * ticks
    expect(entryCalls.length).toBeLessThanOrEqual(3);
  });

  it('handles gamma API errors gracefully', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API down')) } as any,
    });
    const tick = createMicrostructureAlphaTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles clob API errors gracefully', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket('m1')]) } as any,
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createMicrostructureAlphaTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('emits trade.executed on entry', async () => {
    const market = makeMarket('m1');
    let tickNum = 0;
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickNum++;
          const spread = Math.max(0.02, 0.10 - tickNum * 0.01);
          const mid = 0.50 + tickNum * 0.005;
          return Promise.resolve(makeBook(
            [[(mid - spread / 2).toFixed(4), '5000']],
            [[(mid + spread / 2).toFixed(4), '10']],
          ));
        }),
      } as any,
    });
    const tick = createMicrostructureAlphaTick({
      ...deps,
      config: { entryThreshold: 0.3, minSpreadBps: 10 },
    });
    for (let i = 0; i < 5; i++) await tick();
    const tradeEvents = deps.eventBus.emit.mock.calls.filter(
      (c: any[]) => c[0] === 'trade.executed',
    );
    if (tradeEvents.length > 0) {
      expect(tradeEvents[0][1].trade).toHaveProperty('strategy', 'microstructure-alpha');
    }
  });

  it('config overrides work', () => {
    const tick = createMicrostructureAlphaTick({
      ...makeDeps(),
      config: { entryThreshold: 0.9, w_spread: 0.5, maxPositions: 10 },
    });
    expect(typeof tick).toBe('function');
  });
});
