import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyOrders,
  computeNetFlow,
  hasDivergence,
  shouldEnter,
  pruneSnapshots,
  createSmartMoneyDivergenceTick,
  type SmartMoneyDivergenceConfig,
  type SmartMoneyDivergenceDeps,
  type FlowSnapshot,
} from '../../src/strategies/polymarket/smart-money-divergence.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// -- Helper: build a mock orderbook -------------------------------------------

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeConfig(overrides: Partial<SmartMoneyDivergenceConfig> = {}): SmartMoneyDivergenceConfig {
  return {
    sizeThreshold: 200,
    flowWindowMs: 120_000,
    minSmartFlowUsdc: 500,
    minDivergenceTicks: 3,
    takeProfitPct: 0.04,
    stopLossPct: 0.025,
    maxHoldMs: 15 * 60_000,
    maxPositions: 4,
    cooldownMs: 120_000,
    positionSize: '15',
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<FlowSnapshot> = {}): FlowSnapshot {
  return {
    timestamp: Date.now(),
    smartBidSize: 0,
    smartAskSize: 0,
    retailBidSize: 0,
    retailAskSize: 0,
    ...overrides,
  };
}

// -- classifyOrders tests -----------------------------------------------------

describe('classifyOrders', () => {
  it('returns zeros for empty book', () => {
    const book = makeBook([], []);
    const result = classifyOrders(book, 200);
    expect(result.smartBidSize).toBe(0);
    expect(result.smartAskSize).toBe(0);
    expect(result.retailBidSize).toBe(0);
    expect(result.retailAskSize).toBe(0);
  });

  it('classifies all orders as retail when below threshold', () => {
    const book = makeBook(
      [['0.50', '100'], ['0.49', '50']],
      [['0.51', '80'], ['0.52', '30']],
    );
    const result = classifyOrders(book, 200);
    expect(result.smartBidSize).toBe(0);
    expect(result.smartAskSize).toBe(0);
    expect(result.retailBidSize).toBe(150);
    expect(result.retailAskSize).toBe(110);
  });

  it('classifies all orders as smart when above threshold', () => {
    const book = makeBook(
      [['0.50', '500'], ['0.49', '300']],
      [['0.51', '400'], ['0.52', '600']],
    );
    const result = classifyOrders(book, 200);
    expect(result.smartBidSize).toBe(800);
    expect(result.smartAskSize).toBe(1000);
    expect(result.retailBidSize).toBe(0);
    expect(result.retailAskSize).toBe(0);
  });

  it('splits orders between smart and retail correctly', () => {
    const book = makeBook(
      [['0.50', '500'], ['0.49', '50']],
      [['0.51', '100'], ['0.52', '300']],
    );
    const result = classifyOrders(book, 200);
    expect(result.smartBidSize).toBe(500);
    expect(result.retailBidSize).toBe(50);
    expect(result.smartAskSize).toBe(300);
    expect(result.retailAskSize).toBe(100);
  });

  it('orders exactly at threshold are classified as retail', () => {
    const book = makeBook(
      [['0.50', '200']],
      [['0.51', '200']],
    );
    const result = classifyOrders(book, 200);
    expect(result.smartBidSize).toBe(0);
    expect(result.smartAskSize).toBe(0);
    expect(result.retailBidSize).toBe(200);
    expect(result.retailAskSize).toBe(200);
  });

  it('handles single bid-side smart order', () => {
    const book = makeBook(
      [['0.50', '1000']],
      [],
    );
    const result = classifyOrders(book, 200);
    expect(result.smartBidSize).toBe(1000);
    expect(result.retailBidSize).toBe(0);
    expect(result.smartAskSize).toBe(0);
    expect(result.retailAskSize).toBe(0);
  });

  it('handles single ask-side smart order', () => {
    const book = makeBook(
      [],
      [['0.51', '500']],
    );
    const result = classifyOrders(book, 200);
    expect(result.smartAskSize).toBe(500);
    expect(result.retailAskSize).toBe(0);
  });
});

// -- computeNetFlow tests -----------------------------------------------------

describe('computeNetFlow', () => {
  it('returns 0 for empty snapshots', () => {
    expect(computeNetFlow([], 'smart')).toBe(0);
    expect(computeNetFlow([], 'retail')).toBe(0);
  });

  it('computes positive smart net flow (bid heavy)', () => {
    const snapshots = [
      makeSnapshot({ smartBidSize: 600, smartAskSize: 100 }),
    ];
    expect(computeNetFlow(snapshots, 'smart')).toBe(500);
  });

  it('computes negative smart net flow (ask heavy)', () => {
    const snapshots = [
      makeSnapshot({ smartBidSize: 100, smartAskSize: 700 }),
    ];
    expect(computeNetFlow(snapshots, 'smart')).toBe(-600);
  });

  it('computes retail net flow correctly', () => {
    const snapshots = [
      makeSnapshot({ retailBidSize: 50, retailAskSize: 200 }),
    ];
    expect(computeNetFlow(snapshots, 'retail')).toBe(-150);
  });

  it('accumulates across multiple snapshots', () => {
    const snapshots = [
      makeSnapshot({ smartBidSize: 300, smartAskSize: 100 }),
      makeSnapshot({ smartBidSize: 200, smartAskSize: 50 }),
    ];
    expect(computeNetFlow(snapshots, 'smart')).toBe(350); // (300-100) + (200-50)
  });

  it('returns 0 when bids equal asks', () => {
    const snapshots = [
      makeSnapshot({ smartBidSize: 300, smartAskSize: 300 }),
    ];
    expect(computeNetFlow(snapshots, 'smart')).toBe(0);
  });
});

// -- hasDivergence tests ------------------------------------------------------

describe('hasDivergence', () => {
  it('returns true when smart positive and retail negative', () => {
    expect(hasDivergence(500, -200)).toBe(true);
  });

  it('returns true when smart negative and retail positive', () => {
    expect(hasDivergence(-500, 200)).toBe(true);
  });

  it('returns false when both positive', () => {
    expect(hasDivergence(500, 200)).toBe(false);
  });

  it('returns false when both negative', () => {
    expect(hasDivergence(-500, -200)).toBe(false);
  });

  it('returns false when smart flow is zero', () => {
    expect(hasDivergence(0, 200)).toBe(false);
  });

  it('returns false when retail flow is zero', () => {
    expect(hasDivergence(500, 0)).toBe(false);
  });

  it('returns false when both are zero', () => {
    expect(hasDivergence(0, 0)).toBe(false);
  });
});

// -- shouldEnter tests --------------------------------------------------------

describe('shouldEnter', () => {
  const cfg = makeConfig();

  it('returns buy-yes when smart money is positive and divergence confirmed', () => {
    expect(shouldEnter(600, -200, 3, cfg)).toBe('buy-yes');
  });

  it('returns buy-no when smart money is negative and divergence confirmed', () => {
    expect(shouldEnter(-600, 200, 3, cfg)).toBe('buy-no');
  });

  it('returns null when no divergence (both positive)', () => {
    expect(shouldEnter(600, 200, 3, cfg)).toBeNull();
  });

  it('returns null when smart flow below minSmartFlowUsdc', () => {
    expect(shouldEnter(100, -200, 3, cfg)).toBeNull();
  });

  it('returns null when divergence tick count below threshold', () => {
    expect(shouldEnter(600, -200, 2, cfg)).toBeNull();
  });

  it('returns null when smart flow is zero', () => {
    expect(shouldEnter(0, -200, 5, cfg)).toBeNull();
  });

  it('returns buy-yes at exact minSmartFlowUsdc threshold', () => {
    expect(shouldEnter(500, -200, 3, cfg)).toBe('buy-yes');
  });

  it('returns buy-yes at exact minDivergenceTicks threshold', () => {
    expect(shouldEnter(600, -200, 3, cfg)).toBe('buy-yes');
  });

  it('returns null at one less than minDivergenceTicks', () => {
    expect(shouldEnter(600, -200, 2, cfg)).toBeNull();
  });
});

// -- pruneSnapshots tests -----------------------------------------------------

describe('pruneSnapshots', () => {
  it('returns empty array for empty input', () => {
    expect(pruneSnapshots([], 60_000)).toEqual([]);
  });

  it('keeps snapshots within window', () => {
    const now = Date.now();
    const snapshots = [
      makeSnapshot({ timestamp: now - 1000 }),
      makeSnapshot({ timestamp: now - 500 }),
    ];
    const result = pruneSnapshots(snapshots, 60_000, now);
    expect(result.length).toBe(2);
  });

  it('removes snapshots outside window', () => {
    const now = Date.now();
    const snapshots = [
      makeSnapshot({ timestamp: now - 120_001 }),
      makeSnapshot({ timestamp: now - 1000 }),
    ];
    const result = pruneSnapshots(snapshots, 120_000, now);
    expect(result.length).toBe(1);
    expect(result[0].timestamp).toBe(now - 1000);
  });

  it('removes all snapshots when all are expired', () => {
    const now = Date.now();
    const snapshots = [
      makeSnapshot({ timestamp: now - 200_000 }),
      makeSnapshot({ timestamp: now - 180_000 }),
    ];
    const result = pruneSnapshots(snapshots, 120_000, now);
    expect(result.length).toBe(0);
  });
});

// -- Tick factory tests -------------------------------------------------------

function makeDeps(overrides: Partial<SmartMoneyDivergenceDeps> = {}): SmartMoneyDivergenceDeps {
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
          volume: 1000, volume24h: 500, liquidity: 5000, endDate: '2026-12-31',
          active: true, closed: false, resolved: false, outcome: null,
        },
      ]),
    } as any,
    ...overrides,
  };
}

/** Build a book with smart-money bids and retail asks (divergence: smart positive, retail negative). */
function makeDivergentBookSmartBullish(): RawOrderBook {
  return makeBook(
    [['0.50', '500'], ['0.49', '400'], ['0.48', '10']],
    [['0.52', '10'], ['0.53', '50'], ['0.54', '80']],
  );
}

/** Build a book with smart-money asks and retail bids (divergence: smart negative, retail positive). */
function makeDivergentBookSmartBearish(): RawOrderBook {
  return makeBook(
    [['0.50', '10'], ['0.49', '50'], ['0.48', '80']],
    [['0.52', '500'], ['0.53', '400'], ['0.54', '10']],
  );
}

describe('createSmartMoneyDivergenceTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createSmartMoneyDivergenceTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders when no divergence detected', async () => {
    // Default book has all equal sizes — no smart money, no divergence
    const deps = makeDeps();
    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createSmartMoneyDivergenceTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createSmartMoneyDivergenceTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          closed: true, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          closed: false, resolved: true, active: true,
        }]),
      } as any,
    });
    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('enters position on divergence detection (buy-yes)', async () => {
    // Smart bids are big, retail asks are small → smart positive, retail negative
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);

    // Need minDivergenceTicks=3 ticks of divergence before entry
    await tick(); // tick 1: divergence counter = 1
    await tick(); // tick 2: divergence counter = 2
    await tick(); // tick 3: divergence counter = 3 → entry

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.tokenId).toBe('yes-1');
  });

  it('enters position on divergence detection (buy-no)', async () => {
    // Smart asks are big, retail bids are small → smart negative, retail positive
    const divergentBook = makeDivergentBookSmartBearish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);

    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.tokenId).toBe('no-1');
  });

  it('does not enter before minDivergenceTicks reached', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);

    await tick(); // tick 1
    await tick(); // tick 2
    // Only 2 ticks, need 3
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('resets divergence counter when divergence disappears', async () => {
    // Use a very short flow window so only the current tick matters
    const divergentBook = makeDivergentBookSmartBullish();
    // Neutral book: all retail-sized, equal on both sides → no divergence
    const neutralBook = makeBook(
      [['0.50', '50'], ['0.49', '50']],
      [['0.52', '50'], ['0.53', '50']],
    );

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Ticks 1-2: divergence, tick 3: neutral, tick 4-5: divergence again
        if (callCount <= 2) return Promise.resolve(divergentBook);
        if (callCount === 3) return Promise.resolve(neutralBook);
        return Promise.resolve(divergentBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 1, // 1ms window: only current snapshot matters
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);

    // Small delay between ticks to ensure old snapshots expire (1ms window)
    await tick(); // divergence counter = 1
    await new Promise(r => setTimeout(r, 5));
    await tick(); // divergence counter = 2
    await new Promise(r => setTimeout(r, 5));
    await tick(); // neutral → counter resets to 0
    await new Promise(r => setTimeout(r, 5));
    await tick(); // divergence counter = 1
    await new Promise(r => setTimeout(r, 5));
    await tick(); // divergence counter = 2
    // Only 2 consecutive ticks since reset, need 3
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();

    await new Promise(r => setTimeout(r, 5));
    await tick(); // divergence counter = 3 → entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('exits on take profit', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(divergentBook);
        // After entry: price goes up → take profit
        return Promise.resolve(makeBook(
          [['0.59', '10'], ['0.58', '10']],
          [['0.61', '10'], ['0.62', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        takeProfitPct: 0.04,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // exit due to TP
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits on stop loss', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(divergentBook);
        // Price drops → stop loss
        return Promise.resolve(makeBook(
          [['0.44', '10'], ['0.43', '10']],
          [['0.46', '10'], ['0.47', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        stopLossPct: 0.025,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // exit due to SL
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('exits on max hold time', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        maxHoldMs: 1, // 1ms to trigger immediately
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Wait tiny bit to exceed maxHoldMs
    await new Promise(r => setTimeout(r, 5));
    await tick(); // exit
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('cooldown prevents re-entry', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(divergentBook);
        if (callCount === 4) {
          // Price up for TP exit
          return Promise.resolve(makeBook(
            [['0.59', '10']], [['0.61', '10']],
          ));
        }
        // Back to divergent book after exit
        return Promise.resolve(divergentBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        takeProfitPct: 0.04,
        cooldownMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // TP exit
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Try to re-enter — should be on cooldown
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2); // no new orders
  });

  it('respects maxPositions limit', async () => {
    // Use a book where mid ~ ask to avoid triggering SL on exit check
    const divergentBook = makeBook(
      [['0.51', '500'], ['0.50', '400'], ['0.49', '10']],
      [['0.52', '10'], ['0.53', '50'], ['0.54', '80']],
    );

    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm3', conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm4', conditionId: 'cond-4', yesTokenId: 'yes-4', noTokenId: 'no-4',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm5', conditionId: 'cond-5', yesTokenId: 'yes-5', noTokenId: 'no-5',
        closed: false, resolved: false, active: true,
      },
    ];

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 1, // low threshold for easier entry
        flowWindowMs: 120_000,
        maxPositions: 2,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick(); // entries for market 1 & 2 (maxPositions=2)

    // Should only have 2 orders
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Another tick should not add more
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('emits trade.executed events on entry', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        strategy: 'smart-money-divergence',
        side: 'buy',
      }),
    }));
  });

  it('emits trade.executed events on exit', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(divergentBook);
        return Promise.resolve(makeBook(
          [['0.59', '10']], [['0.61', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        takeProfitPct: 0.04,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    await tick(); // exit

    // Should have 2 trade.executed events (entry + exit)
    const emitCalls = (deps.eventBus.emit as any).mock.calls.filter(
      (c: any[]) => c[0] === 'trade.executed',
    );
    expect(emitCalls.length).toBe(2);
  });

  it('handles market with no noTokenId', async () => {
    const divergentBook = makeDivergentBookSmartBearish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: undefined,
          closed: false, resolved: false, active: true,
        }]),
      } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick();

    // Should still place order using yesTokenId as fallback
    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.tokenId).toBe('yes-1');
  });

  it('skips markets without yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: undefined, noTokenId: 'no-1',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips market when mid price is at boundary (0 or 1)', async () => {
    const edgeBook = makeBook(
      [],
      [['1.00', '500']],
    );
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(edgeBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 1,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles order manager error gracefully during entry', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('Order failed')),
      } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await expect(tick()).resolves.toBeUndefined(); // no throw
  });

  it('handles order manager error gracefully during exit', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(divergentBook);
        return Promise.resolve(makeBook(
          [['0.59', '10']], [['0.61', '10']],
        ));
      }),
    };

    let orderCount = 0;
    const orderManager = {
      placeOrder: vi.fn().mockImplementation(() => {
        orderCount++;
        if (orderCount === 1) return Promise.resolve({ id: 'order-1' });
        return Promise.reject(new Error('Exit failed'));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        takeProfitPct: 0.04,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry succeeds
    await expect(tick()).resolves.toBeUndefined(); // exit fails gracefully
  });

  it('uses GTC order type for entries', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick();

    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.orderType).toBe('GTC');
  });

  it('does not enter same market twice', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 1, // low threshold
        flowWindowMs: 120_000,
        maxPositions: 4,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick(); // entry
    await tick(); // should not enter again
    await tick(); // should not enter again

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('applies config overrides correctly', async () => {
    const divergentBook = makeDivergentBookSmartBullish();

    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(divergentBook) } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 1,
        flowWindowMs: 120_000,
        positionSize: '25',
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('stop-loss exit for no-side position when price rises', async () => {
    const divergentBook = makeDivergentBookSmartBearish();

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) return Promise.resolve(divergentBook);
        // Price rises → loss for NO position
        return Promise.resolve(makeBook(
          [['0.56', '10'], ['0.55', '10']],
          [['0.58', '10'], ['0.59', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
      config: {
        sizeThreshold: 200,
        minSmartFlowUsdc: 500,
        minDivergenceTicks: 3,
        flowWindowMs: 120_000,
        stopLossPct: 0.025,
        cooldownMs: 120_000,
      },
    });

    const tick = createSmartMoneyDivergenceTick(deps);
    await tick();
    await tick();
    await tick(); // entry (buy-no)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
    const entryCall = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(entryCall.tokenId).toBe('no-1');

    await tick(); // exit due to SL
    // At least one IOC exit order should have been placed
    const allCalls = (deps.orderManager.placeOrder as any).mock.calls;
    const exitCalls = allCalls.filter((c: any[]) => c[0]?.orderType === 'IOC');
    expect(exitCalls.length).toBeGreaterThanOrEqual(1);
  });
});
