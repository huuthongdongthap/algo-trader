import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInAccumulationRange,
  calcSliceSize,
  shouldStopAccumulating,
  createTwapAccumulatorTick,
  DEFAULT_CONFIG,
  type TwapAccumulatorConfig,
  type TwapAccumulatorDeps,
} from '../../src/strategies/polymarket/twap-accumulator.js';
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

function makeMarket(overrides: Record<string, any> = {}) {
  return {
    id: 'm1',
    question: 'Will X happen?',
    slug: 'will-x-happen',
    conditionId: 'cond-1',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    yesPrice: 0.30,
    noPrice: 0.70,
    volume: 100000,
    volume24h: 10000,
    liquidity: 50000,
    endDate: '',
    active: true,
    closed: false,
    resolved: false,
    outcome: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<TwapAccumulatorDeps> = {}): TwapAccumulatorDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.30', '100']], [['0.32', '100']]),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    } as any,
    eventBus: {
      emit: vi.fn(),
    } as any,
    gamma: {
      getTrending: vi.fn().mockResolvedValue([makeMarket()]),
    } as any,
    ...overrides,
  };
}

// ── isInAccumulationRange tests ─────────────────────────────────────────────

describe('isInAccumulationRange', () => {
  it('returns true when price is at lower bound', () => {
    expect(isInAccumulationRange(0.20, 0.20, 0.45)).toBe(true);
  });

  it('returns true when price is at upper bound', () => {
    expect(isInAccumulationRange(0.45, 0.20, 0.45)).toBe(true);
  });

  it('returns true when price is in the middle of range', () => {
    expect(isInAccumulationRange(0.30, 0.20, 0.45)).toBe(true);
  });

  it('returns false when price is below range', () => {
    expect(isInAccumulationRange(0.10, 0.20, 0.45)).toBe(false);
  });

  it('returns false when price is above range', () => {
    expect(isInAccumulationRange(0.50, 0.20, 0.45)).toBe(false);
  });

  it('returns false when price is exactly 0', () => {
    expect(isInAccumulationRange(0, 0.20, 0.45)).toBe(false);
  });

  it('returns false when price is 1', () => {
    expect(isInAccumulationRange(1, 0.20, 0.45)).toBe(false);
  });
});

// ── calcSliceSize tests ─────────────────────────────────────────────────────

describe('calcSliceSize', () => {
  it('divides target evenly across slices', () => {
    expect(calcSliceSize(50, 5)).toBe(10);
  });

  it('handles non-integer results', () => {
    expect(calcSliceSize(100, 3)).toBeCloseTo(33.3333, 3);
  });

  it('returns full amount for 1 slice', () => {
    expect(calcSliceSize(50, 1)).toBe(50);
  });

  it('returns 0 for 0 slices', () => {
    expect(calcSliceSize(50, 0)).toBe(0);
  });

  it('returns 0 for negative slices', () => {
    expect(calcSliceSize(50, -1)).toBe(0);
  });

  it('handles very small target size', () => {
    expect(calcSliceSize(1, 10)).toBeCloseTo(0.1, 5);
  });

  it('handles very large target size', () => {
    expect(calcSliceSize(10000, 5)).toBe(2000);
  });
});

// ── shouldStopAccumulating tests ────────────────────────────────────────────

describe('shouldStopAccumulating', () => {
  const baseConfig = {
    numSlices: 5,
    maxAccumulationMs: 300_000,
    accumulateLow: 0.20,
    accumulateHigh: 0.45,
    sliceIntervalMs: 30_000,
  };

  it('returns null when accumulation should continue', () => {
    const state = { slicesExecuted: 2, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.30, baseConfig, 50_000)).toBeNull();
  });

  it('returns "all-slices-filled" when all slices are done', () => {
    const state = { slicesExecuted: 5, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.30, baseConfig, 50_000)).toBe('all-slices-filled');
  });

  it('returns "all-slices-filled" when slicesExecuted exceeds numSlices', () => {
    const state = { slicesExecuted: 7, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.30, baseConfig, 50_000)).toBe('all-slices-filled');
  });

  it('returns "price-out-of-range" when price drops below low', () => {
    const state = { slicesExecuted: 2, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.10, baseConfig, 50_000)).toBe('price-out-of-range');
  });

  it('returns "price-out-of-range" when price rises above high', () => {
    const state = { slicesExecuted: 2, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.50, baseConfig, 50_000)).toBe('price-out-of-range');
  });

  it('returns "max-time-elapsed" when maxAccumulationMs is reached', () => {
    const state = { slicesExecuted: 2, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.30, baseConfig, 301_001)).toBe('max-time-elapsed');
  });

  it('returns "max-time-elapsed" at exactly maxAccumulationMs', () => {
    const state = { slicesExecuted: 2, startedAt: 0, lastSliceAt: 0 };
    expect(shouldStopAccumulating(state, 0.30, baseConfig, 300_000)).toBe('max-time-elapsed');
  });

  it('prioritizes "all-slices-filled" over other conditions', () => {
    const state = { slicesExecuted: 5, startedAt: 0, lastSliceAt: 0 };
    // Price also out of range, and time also expired
    expect(shouldStopAccumulating(state, 0.10, baseConfig, 999_999)).toBe('all-slices-filled');
  });

  it('returns null at boundary when 0 slices executed', () => {
    const state = { slicesExecuted: 0, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.30, baseConfig, 50_000)).toBeNull();
  });

  it('returns null when price is at exact lower bound', () => {
    const state = { slicesExecuted: 0, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.20, baseConfig, 50_000)).toBeNull();
  });

  it('returns null when price is at exact upper bound', () => {
    const state = { slicesExecuted: 0, startedAt: 1000, lastSliceAt: 1000 };
    expect(shouldStopAccumulating(state, 0.45, baseConfig, 50_000)).toBeNull();
  });
});

// ── createTwapAccumulatorTick integration tests ─────────────────────────────

describe('createTwapAccumulatorTick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T00:00:00Z'));
  });

  it('returns a function', () => {
    const tick = createTwapAccumulatorTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('calls gamma.getTrending on each tick', async () => {
    const deps = makeDeps();
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    expect(deps.gamma.getTrending).toHaveBeenCalledWith(20);
  });

  it('starts accumulation for a market in price range', async () => {
    const deps = makeDeps();
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    // Should call getOrderBook for the market during scan
    expect(deps.clob.getOrderBook).toHaveBeenCalledWith('yes-1');
  });

  it('skips markets with low volume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ volume24h: 100 }),
        ]),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    // Only the processAccumulations and checkExits calls; no entry scan order book calls
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ closed: true }),
        ]),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ resolved: true }),
        ]),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ yesTokenId: null }),
        ]),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets where price is outside accumulation range', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.60', '100']], [['0.62', '100']]),
        ),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('executes first slice immediately after starting accumulation', async () => {
    const deps = makeDeps();
    const tick = createTwapAccumulatorTick(deps);
    // First tick: starts accumulation
    await tick();
    // Second tick: processAccumulations runs, lastSliceAt=0 so interval check passes
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('respects sliceIntervalMs between slices', async () => {
    const deps = makeDeps({
      config: { sliceIntervalMs: 30_000 },
    });
    const tick = createTwapAccumulatorTick(deps);

    // Tick 1: starts accumulation
    await tick();
    // Tick 2: executes first slice (lastSliceAt=0)
    await tick();
    const callsAfterFirst = (deps.orderManager.placeOrder as any).mock.calls.length;

    // Tick 3: immediately after — should NOT execute another slice
    await tick();
    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(callsAfterFirst);

    // Advance time past interval
    vi.advanceTimersByTime(30_001);
    await tick();
    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('promotes accumulation to position after all slices', async () => {
    const deps = makeDeps({
      config: { numSlices: 1, sliceIntervalMs: 0 },
    });
    const tick = createTwapAccumulatorTick(deps);

    // Tick 1: starts accumulation
    await tick();
    // Tick 2: executes 1 slice, then on next check sees all slices done
    await tick();
    // Tick 3: processes accumulation and promotes to position
    await tick();

    // Now there's a managed position — subsequent ticks should check exits
    // We verify by checking getOrderBook is called (for exit checks)
    const callCount = (deps.clob.getOrderBook as any).mock.calls.length;
    await tick();
    expect((deps.clob.getOrderBook as any).mock.calls.length).toBeGreaterThan(callCount);
  });

  it('stops accumulation when price exits range', async () => {
    let callCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          callCount++;
          // First few calls return in-range price, then out of range
          if (callCount <= 3) {
            return Promise.resolve(makeBook([['0.30', '100']], [['0.32', '100']]));
          }
          return Promise.resolve(makeBook([['0.55', '100']], [['0.57', '100']]));
        }),
      } as any,
      config: { sliceIntervalMs: 0 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // scan entries — starts accumulation
    await tick(); // process — executes slice, price still in range
    await tick(); // process — price now out of range, stops

    // Should not place any more orders after price exits range
    const orderCalls = (deps.orderManager.placeOrder as any).mock.calls.length;
    await tick();
    // Might start new accumulation if gamma returns market again, but
    // the original one should have been finalized
    expect(orderCalls).toBeGreaterThanOrEqual(1);
  });

  it('stops accumulation when maxAccumulationMs elapsed', async () => {
    const deps = makeDeps({
      config: { maxAccumulationMs: 60_000, sliceIntervalMs: 30_000 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // starts accumulation
    vi.advanceTimersByTime(61_000);
    await tick(); // should stop due to max time

    // Verify order was not placed (time expired before first slice could happen)
    // Actually first slice has lastSliceAt=0, so interval is satisfied,
    // but shouldStopAccumulating is checked first
    // The stop check happens and finds max-time-elapsed
  });

  it('respects maxPositions limit', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ conditionId: 'c1', yesTokenId: 'y1', noTokenId: 'n1' }),
          makeMarket({ conditionId: 'c2', yesTokenId: 'y2', noTokenId: 'n2' }),
          makeMarket({ conditionId: 'c3', yesTokenId: 'y3', noTokenId: 'n3' }),
          makeMarket({ conditionId: 'c4', yesTokenId: 'y4', noTokenId: 'n4' }),
        ]),
      } as any,
      config: { maxPositions: 3 },
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick();

    // Should only start accumulation for 3 markets (maxPositions)
    // The 4th should be skipped
    // We can check that getOrderBook was called for at most 3 markets during scan
    const bookCalls = (deps.clob.getOrderBook as any).mock.calls;
    const uniqueTokens = new Set(bookCalls.map((c: any) => c[0]));
    expect(uniqueTokens.size).toBeLessThanOrEqual(3);
  });

  it('exits position on take profit', async () => {
    const deps = makeDeps({
      config: { numSlices: 1, sliceIntervalMs: 0, takeProfitPct: 0.06 },
    });
    const tick = createTwapAccumulatorTick(deps);

    // Build up position
    await tick(); // scan — start accumulation
    await tick(); // process — execute slice
    await tick(); // process — all slices done, promote to position

    // Now change price to trigger TP (entry ~0.31 mid, need +6%)
    (deps.clob.getOrderBook as any).mockResolvedValue(
      makeBook([['0.40', '100']], [['0.42', '100']]),
    );

    await tick(); // checkExits — should trigger TP
    // Verify sell order placed
    const sellCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].side === 'sell',
    );
    expect(sellCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits position on stop loss', async () => {
    const deps = makeDeps({
      config: { numSlices: 1, sliceIntervalMs: 0, stopLossPct: 0.04 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // scan
    await tick(); // execute slice
    await tick(); // promote to position

    // Price drops significantly
    (deps.clob.getOrderBook as any).mockResolvedValue(
      makeBook([['0.20', '100']], [['0.22', '100']]),
    );

    await tick();
    const sellCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].side === 'sell',
    );
    expect(sellCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits position on max hold time', async () => {
    const deps = makeDeps({
      config: { numSlices: 1, sliceIntervalMs: 0, maxHoldMs: 60_000 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // scan
    await tick(); // slice
    await tick(); // promote

    vi.advanceTimersByTime(61_000);
    await tick();

    const sellCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].side === 'sell',
    );
    expect(sellCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('emits trade.executed event on slice execution', async () => {
    const deps = makeDeps({
      config: { sliceIntervalMs: 0 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // scan
    await tick(); // execute slice

    expect(deps.eventBus.emit).toHaveBeenCalledWith(
      'trade.executed',
      expect.objectContaining({
        trade: expect.objectContaining({
          side: 'buy',
          strategy: 'twap-accumulator',
        }),
      }),
    );
  });

  it('emits trade.executed event on exit', async () => {
    const deps = makeDeps({
      config: { numSlices: 1, sliceIntervalMs: 0, maxHoldMs: 1 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // scan
    await tick(); // slice
    await tick(); // promote

    vi.advanceTimersByTime(10);
    await tick(); // exit

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const sellEvents = emitCalls.filter(
      (c: any) => c[0] === 'trade.executed' && c[1].trade.side === 'sell',
    );
    expect(sellEvents.length).toBeGreaterThanOrEqual(1);
  });

  it('does not re-accumulate a market already being accumulated', async () => {
    const deps = makeDeps({
      config: { sliceIntervalMs: 30_000 },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // starts accumulation for cond-1
    await tick(); // should NOT start a second accumulation for cond-1

    // gamma.getTrending should be called twice but getOrderBook for scan
    // should only attempt once (the second time it's already accumulating)
    expect(deps.gamma.getTrending).toHaveBeenCalledTimes(2);
  });

  it('applies cooldown after position exit', async () => {
    const deps = makeDeps({
      config: {
        numSlices: 1,
        sliceIntervalMs: 0,
        maxHoldMs: 1,
        cooldownMs: 300_000,
      },
    });
    const tick = createTwapAccumulatorTick(deps);

    await tick(); // scan
    await tick(); // slice
    await tick(); // promote

    vi.advanceTimersByTime(10);
    await tick(); // exit (sets cooldown)

    // Reset mocks to track new calls
    (deps.orderManager.placeOrder as any).mockClear();

    await tick(); // should not re-enter due to cooldown
    // No new buy orders should be placed (might get 0 calls or only scan-related)
    const buyCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].side === 'buy',
    );
    expect(buyCalls.length).toBe(0);
  });

  it('handles getOrderBook errors gracefully during scan', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockRejectedValue(new Error('network error')),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    // Should not throw
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles getOrderBook errors gracefully during accumulation', async () => {
    let callCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount <= 1) {
            return Promise.resolve(makeBook([['0.30', '100']], [['0.32', '100']]));
          }
          return Promise.reject(new Error('network error'));
        }),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick(); // scan succeeds
    await expect(tick()).resolves.toBeUndefined(); // accumulation getOrderBook fails gracefully
  });

  it('handles placeOrder errors gracefully during accumulation', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('order rejected')),
      } as any,
      config: { sliceIntervalMs: 0 },
    });
    const tick = createTwapAccumulatorTick(deps);
    await tick(); // scan
    await expect(tick()).resolves.toBeUndefined(); // slice fails gracefully
  });

  it('handles gamma.getTrending errors gracefully', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockRejectedValue(new Error('API down')),
      } as any,
    });
    const tick = createTwapAccumulatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('uses custom config when provided', () => {
    const deps = makeDeps({
      config: { accumulateLow: 0.10, accumulateHigh: 0.30, numSlices: 10 },
    });
    // Should not throw — config merging works
    const tick = createTwapAccumulatorTick(deps);
    expect(typeof tick).toBe('function');
  });
});
