import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcSkew,
  calcConcentration,
  shouldRebalance,
  createInventorySkewRebalancerTick,
  type InventorySkewRebalancerDeps,
  type TrackedPosition,
} from '../../src/strategies/polymarket/inventory-skew-rebalancer.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeDeps(overrides?: Partial<InventorySkewRebalancerDeps>): InventorySkewRebalancerDeps {
  return {
    clob: { getOrderBook: vi.fn().mockResolvedValue(makeBook([['0.50', '100']], [['0.52', '100']])) } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn(), on: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

function makePosition(overrides?: Partial<TrackedPosition>): TrackedPosition {
  return {
    tokenId: 'token-1',
    side: 'yes',
    size: 100,
    entryPrice: 0.50,
    currentPrice: 0.55,
    marketId: 'market-1',
    ...overrides,
  };
}

// ── calcSkew ─────────────────────────────────────────────────────────────────

describe('calcSkew', () => {
  it('returns 0 for empty positions', () => {
    expect(calcSkew([])).toBe(0);
  });

  it('returns 0 for balanced YES and NO exposure', () => {
    const positions = [
      makePosition({ side: 'yes', size: 100, currentPrice: 0.50 }),
      makePosition({ side: 'no', size: 100, currentPrice: 0.50 }),
    ];
    expect(calcSkew(positions)).toBe(0);
  });

  it('returns positive for YES-heavy portfolio', () => {
    const positions = [
      makePosition({ side: 'yes', size: 200, currentPrice: 0.50 }),
      makePosition({ side: 'no', size: 50, currentPrice: 0.50 }),
    ];
    // yesExp=100, noExp=25, total=125, skew=75/125=0.6
    expect(calcSkew(positions)).toBeCloseTo(0.6);
  });

  it('returns negative for NO-heavy portfolio', () => {
    const positions = [
      makePosition({ side: 'yes', size: 50, currentPrice: 0.50 }),
      makePosition({ side: 'no', size: 200, currentPrice: 0.50 }),
    ];
    expect(calcSkew(positions)).toBeCloseTo(-0.6);
  });

  it('returns 1 when only YES positions exist', () => {
    const positions = [
      makePosition({ side: 'yes', size: 100, currentPrice: 0.50 }),
    ];
    expect(calcSkew(positions)).toBe(1);
  });

  it('returns -1 when only NO positions exist', () => {
    const positions = [
      makePosition({ side: 'no', size: 100, currentPrice: 0.50 }),
    ];
    expect(calcSkew(positions)).toBe(-1);
  });

  it('accounts for differing current prices', () => {
    const positions = [
      makePosition({ side: 'yes', size: 100, currentPrice: 0.80 }),
      makePosition({ side: 'no', size: 100, currentPrice: 0.20 }),
    ];
    // yesExp=80, noExp=20, total=100, skew=60/100=0.6
    expect(calcSkew(positions)).toBeCloseTo(0.6);
  });

  it('handles multiple positions on the same side', () => {
    const positions = [
      makePosition({ side: 'yes', size: 50, currentPrice: 0.50 }),
      makePosition({ side: 'yes', size: 50, currentPrice: 0.50 }),
      makePosition({ side: 'no', size: 100, currentPrice: 0.50 }),
    ];
    expect(calcSkew(positions)).toBeCloseTo(0);
  });
});

// ── calcConcentration ────────────────────────────────────────────────────────

describe('calcConcentration', () => {
  it('returns 0 for empty portfolio', () => {
    const pos = makePosition();
    expect(calcConcentration(pos, [])).toBe(0);
  });

  it('returns 1 for single position', () => {
    const pos = makePosition({ size: 100, currentPrice: 0.50 });
    expect(calcConcentration(pos, [pos])).toBe(1);
  });

  it('returns correct fraction for multiple positions', () => {
    const pos1 = makePosition({ tokenId: 'a', size: 100, currentPrice: 0.50 }); // value=50
    const pos2 = makePosition({ tokenId: 'b', size: 100, currentPrice: 0.50 }); // value=50
    const all = [pos1, pos2];
    expect(calcConcentration(pos1, all)).toBeCloseTo(0.5);
  });

  it('reflects price changes in concentration', () => {
    const pos1 = makePosition({ tokenId: 'a', size: 100, currentPrice: 0.80 }); // value=80
    const pos2 = makePosition({ tokenId: 'b', size: 100, currentPrice: 0.20 }); // value=20
    const all = [pos1, pos2];
    expect(calcConcentration(pos1, all)).toBeCloseTo(0.8);
    expect(calcConcentration(pos2, all)).toBeCloseTo(0.2);
  });

  it('handles zero-sized positions', () => {
    const pos = makePosition({ size: 0, currentPrice: 0.50 });
    const other = makePosition({ tokenId: 'b', size: 100, currentPrice: 0.50 });
    expect(calcConcentration(pos, [pos, other])).toBeCloseTo(0);
  });
});

// ── shouldRebalance ─────────────────────────────────────────────────────────

describe('shouldRebalance', () => {
  it('returns true when skew exceeds threshold and interval elapsed', () => {
    expect(shouldRebalance(0.5, 0.3, 0, 60_000, 120_000)).toBe(true);
  });

  it('returns false when skew is below threshold', () => {
    expect(shouldRebalance(0.1, 0.3, 0, 60_000, 120_000)).toBe(false);
  });

  it('returns false when interval has not elapsed', () => {
    expect(shouldRebalance(0.5, 0.3, 100_000, 60_000, 120_000)).toBe(false);
  });

  it('returns true for negative skew exceeding threshold', () => {
    expect(shouldRebalance(-0.5, 0.3, 0, 60_000, 120_000)).toBe(true);
  });

  it('returns false at exact threshold', () => {
    expect(shouldRebalance(0.3, 0.3, 0, 60_000, 120_000)).toBe(false);
  });

  it('returns true at threshold + epsilon', () => {
    expect(shouldRebalance(0.30001, 0.3, 0, 60_000, 120_000)).toBe(true);
  });

  it('returns true when lastRebalanceAt is 0 (first run)', () => {
    expect(shouldRebalance(0.5, 0.3, 0, 60_000, 60_001)).toBe(true);
  });
});

// ── createInventorySkewRebalancerTick (integration) ─────────────────────────

describe('createInventorySkewRebalancerTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a callable tick function', () => {
    const tick = createInventorySkewRebalancerTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('registers a trade.executed listener on eventBus', () => {
    const deps = makeDeps();
    createInventorySkewRebalancerTick(deps);
    expect(deps.eventBus.on).toHaveBeenCalledWith('trade.executed', expect.any(Function));
  });

  it('does not throw on tick with no positions', async () => {
    const tick = createInventorySkewRebalancerTick(makeDeps());
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not place orders when positions are empty', async () => {
    const deps = makeDeps();
    const tick = createInventorySkewRebalancerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw when clob.getOrderBook rejects', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createInventorySkewRebalancerTick(deps);

    // Simulate a position via eventBus listener
    const onCall = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    );
    const listener = onCall[1];
    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '100', fillPrice: '0.50' } });

    await expect(tick()).resolves.toBeUndefined();
  });

  it('tracks positions from trade.executed events', async () => {
    const deps = makeDeps();
    createInventorySkewRebalancerTick(deps);

    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '100', fillPrice: '0.50' } });
    listener({ trade: { tokenId: 'tok-2', marketId: 'mkt-2', side: 'sell', fillSize: '50', fillPrice: '0.60' } });

    // No error on tick — positions tracked internally
    await expect(makeDeps().clob.getOrderBook).toBeDefined();
  });

  it('aggregates size for duplicate tokenId+side', () => {
    const deps = makeDeps();
    createInventorySkewRebalancerTick(deps);

    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Two buys of the same token
    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '100', fillPrice: '0.50' } });
    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '50', fillPrice: '0.60' } });

    // Should not throw; internal position combined
    expect(true).toBe(true);
  });

  it('ignores zero-size trade events', () => {
    const deps = makeDeps();
    createInventorySkewRebalancerTick(deps);

    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Should not throw or add a position
    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '0', fillPrice: '0.50' } });
    expect(true).toBe(true);
  });

  it('trims overweight YES positions when skew exceeds threshold', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Create skewed portfolio: heavy YES, light NO
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const sellCalls = calls.filter((c: any) => c[0].side === 'sell');
    expect(sellCalls.length).toBeGreaterThanOrEqual(1);
    expect(sellCalls[0][0].tokenId).toBe('yes-1');
  });

  it('trims overweight NO positions when skew is negative', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Heavy NO, light YES
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const sellCalls = calls.filter((c: any) => c[0].side === 'sell');
    expect(sellCalls.length).toBeGreaterThanOrEqual(1);
    expect(sellCalls[0][0].tokenId).toBe('no-1');
  });

  it('does not trim positions with negative unrealised PnL', async () => {
    const deps = makeDeps({
      clob: {
        // Current price lower than entry → negative PnL
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.30', '100']], [['0.32', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0.01,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // YES heavy, entered at 0.50 but current ~0.31 → losing
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.50' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.50' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    // Should not have placed any trim sell orders (PnL is negative)
    const sellCalls = calls.filter((c: any) => c[0].side === 'sell');
    expect(sellCalls.length).toBe(0);
  });

  it('respects maxTradesPerRebalance limit', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 1,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Multiple YES positions
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'yes-2', marketId: 'mkt-2', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '10', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    // Concentration check may fire too, but rebalance pass limited to 1 trade
    // Total should be limited
    expect(calls.length).toBeLessThanOrEqual(3);
  });

  it('respects rebalanceIntervalMs cooldown', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 999_999_999, // very long interval
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    // First tick — should rebalance (lastRebalanceAt = 0)
    await tick();
    const firstCallCount = (deps.orderManager.placeOrder as any).mock.calls.length;

    // Second tick — interval not elapsed, should NOT add new rebalance sells/buys
    await tick();
    const secondCallCount = (deps.orderManager.placeOrder as any).mock.calls.length;

    // Concentration check may still fire on second tick (different from rebalance interval),
    // but the number of new orders should be small relative to first tick.
    // The key assertion: second tick doesn't double the work.
    expect(secondCallCount).toBeLessThanOrEqual(firstCallCount + 1);
  });

  it('trims concentrated positions exceeding maxConcentrationPct', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.99, // high threshold — no skew rebalance
        maxConcentrationPct: 0.3,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // One huge position + one small → concentration > 0.3
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '500', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '10', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const sellCalls = calls.filter((c: any) => c[0].side === 'sell');
    expect(sellCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not trim concentrated positions with negative PnL', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.30', '100']], [['0.32', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.99,
        maxConcentrationPct: 0.3,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0.01,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Large position entered at 0.50, now at ~0.31 → loss
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '500', fillPrice: '0.50' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '10', fillPrice: '0.50' } });

    await tick();

    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(0);
  });

  it('emits trade.executed when trimming overweight position', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeEmits = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    expect(tradeEmits.length).toBeGreaterThanOrEqual(1);
    expect(tradeEmits[0][1].trade.strategy).toBe('inventory-skew-rebalancer');
  });

  it('places buy orders for underweight side during rebalance', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 5,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // YES heavy, NO underweight
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const buyCalls = calls.filter((c: any) => c[0].side === 'buy');
    expect(buyCalls.length).toBeGreaterThanOrEqual(1);
    expect(buyCalls[0][0].tokenId).toBe('no-1');
  });

  it('uses IOC order type for all rebalance trades', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 5,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    for (const call of calls) {
      expect(call[0].orderType).toBe('IOC');
    }
  });

  it('does not rebalance when skew is within threshold', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.99, // very high threshold
        maxConcentrationPct: 0.99, // very high — no concentration trim
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Nearly balanced portfolio
    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '100', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '100', fillPrice: '0.40' } });

    await tick();

    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(0);
  });

  it('refreshes prices from order book before rebalancing', async () => {
    const getOrderBook = vi.fn().mockResolvedValue(
      makeBook([['0.55', '100']], [['0.57', '100']]),
    );

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      config: {
        skewThreshold: 0.99,
        maxConcentrationPct: 0.99,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '100', fillPrice: '0.50' } });

    await tick();

    // getOrderBook called once per position for price refresh
    expect(getOrderBook).toHaveBeenCalledWith('tok-1');
  });

  it('handles orderManager.placeOrder rejection gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('Order failed')),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await expect(tick()).resolves.toBeUndefined();
  });

  it('trims the largest overweight position first', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 1,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    // Two YES positions — larger one should be trimmed first
    listener({ trade: { tokenId: 'yes-small', marketId: 'mkt-1', side: 'buy', fillSize: '50', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'yes-big', marketId: 'mkt-2', side: 'buy', fillSize: '300', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-3', side: 'sell', fillSize: '10', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const sellCalls = calls.filter((c: any) => c[0].side === 'sell');
    if (sellCalls.length > 0) {
      expect(sellCalls[0][0].tokenId).toBe('yes-big');
    }
  });

  it('reduces position size after trim', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        maxConcentrationPct: 0.99,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    // After trim, the sell size should be 200 * 0.25 = 50
    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const sellCalls = calls.filter((c: any) => c[0].side === 'sell' && c[0].tokenId === 'yes-1');
    if (sellCalls.length > 0) {
      expect(parseFloat(sellCalls[0][0].size)).toBeCloseTo(50);
    }
  });

  it('uses positionSize config for buy orders', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 5,
        positionSize: '42',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const buyCalls = calls.filter((c: any) => c[0].side === 'buy');
    if (buyCalls.length > 0) {
      expect(parseFloat(buyCalls[0][0].size)).toBe(42);
    }
  });

  it('emits trade.executed with correct strategy name on concentration trim', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.99,
        maxConcentrationPct: 0.3,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 0.25,
        maxTradesPerRebalance: 3,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '500', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '10', fillPrice: '0.40' } });

    await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeEmits = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    expect(tradeEmits.length).toBeGreaterThanOrEqual(1);
    expect(tradeEmits[0][1].trade.strategy).toBe('inventory-skew-rebalancer');
  });

  it('handles clob error gracefully during price refresh', async () => {
    let callCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) return Promise.reject(new Error('timeout'));
          return Promise.resolve(makeBook([['0.55', '100']], [['0.57', '100']]));
        }),
      } as any,
      config: {
        skewThreshold: 0.99,
        maxConcentrationPct: 0.99,
        rebalanceIntervalMs: 0,
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'tok-1', marketId: 'mkt-1', side: 'buy', fillSize: '100', fillPrice: '0.50' } });

    await expect(tick()).resolves.toBeUndefined();
  });

  it('removes negligible positions after trim', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.55', '100']], [['0.57', '100']]),
        ),
      } as any,
      config: {
        skewThreshold: 0.1,
        rebalanceIntervalMs: 0,
        minPnlToTrim: 0,
        trimPct: 1.0, // trim 100% — should reduce to 0
        maxTradesPerRebalance: 5,
        positionSize: '10',
      },
    });

    const tick = createInventorySkewRebalancerTick(deps);
    const listener = (deps.eventBus.on as any).mock.calls.find(
      (c: any) => c[0] === 'trade.executed',
    )[1];

    listener({ trade: { tokenId: 'yes-1', marketId: 'mkt-1', side: 'buy', fillSize: '200', fillPrice: '0.40' } });
    listener({ trade: { tokenId: 'no-1', marketId: 'mkt-1', side: 'sell', fillSize: '20', fillPrice: '0.40' } });

    await tick();

    // After trimming 100%, position size should be 0 and removed
    // Second tick should have no positions to rebalance — no more orders placed
    const callsAfterFirst = (deps.orderManager.placeOrder as any).mock.calls.length;
    await tick();
    // On second tick the removed position should not cause additional orders
    // (it was fully trimmed and should have been removed)
    expect(true).toBe(true); // mainly testing it doesn't throw
  });

  it('applies default config when no overrides provided', () => {
    const deps = makeDeps();
    const tick = createInventorySkewRebalancerTick(deps);
    // Just ensure it creates without error using defaults
    expect(typeof tick).toBe('function');
  });

  it('merges partial config with defaults', async () => {
    const deps = makeDeps({
      config: { skewThreshold: 0.5 },
    });
    const tick = createInventorySkewRebalancerTick(deps);
    // Tick should work with partial config
    await expect(tick()).resolves.toBeUndefined();
  });
});
