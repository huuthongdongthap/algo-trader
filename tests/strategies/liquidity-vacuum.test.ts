import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calcTotalLiquidity,
  calcBidAskLiquidityRatio,
  isVacuum,
  createLiquidityVacuumTick,
  type LiquidityVacuumDeps,
} from '../../src/strategies/polymarket/liquidity-vacuum.js';
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

function makeDeps(overrides?: Partial<LiquidityVacuumDeps>): LiquidityVacuumDeps {
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

/**
 * Build a book with specific bid/ask total sizes spread across multiple levels.
 */
function makeDeepBook(
  bidTotal: number,
  askTotal: number,
  midPrice = 0.50,
  levels = 3,
): RawOrderBook {
  const spread = 0.02;
  const bidBase = midPrice - spread / 2;
  const askBase = midPrice + spread / 2;
  const bidSizePerLevel = bidTotal / levels;
  const askSizePerLevel = askTotal / levels;

  const bids: [string, string][] = [];
  const asks: [string, string][] = [];
  for (let i = 0; i < levels; i++) {
    bids.push([(bidBase - i * 0.01).toFixed(4), bidSizePerLevel.toFixed(2)]);
    asks.push([(askBase + i * 0.01).toFixed(4), askSizePerLevel.toFixed(2)]);
  }
  return makeBook(bids, asks);
}

// ── calcTotalLiquidity tests ────────────────────────────────────────────────

describe('calcTotalLiquidity', () => {
  it('sums all bid and ask sizes', () => {
    const book = makeBook(
      [['0.48', '100'], ['0.47', '200']],
      [['0.52', '150'], ['0.53', '50']],
    );
    expect(calcTotalLiquidity(book)).toBeCloseTo(500);
  });

  it('returns 0 for empty book', () => {
    const book = makeBook([], []);
    expect(calcTotalLiquidity(book)).toBe(0);
  });

  it('handles bids only', () => {
    const book = makeBook([['0.45', '300']], []);
    expect(calcTotalLiquidity(book)).toBeCloseTo(300);
  });

  it('handles asks only', () => {
    const book = makeBook([], [['0.55', '250']]);
    expect(calcTotalLiquidity(book)).toBeCloseTo(250);
  });

  it('handles single level on each side', () => {
    const book = makeBook([['0.50', '1000']], [['0.51', '2000']]);
    expect(calcTotalLiquidity(book)).toBeCloseTo(3000);
  });

  it('handles many levels', () => {
    const bids: [string, string][] = Array.from({ length: 10 }, (_, i) => [
      (0.50 - i * 0.01).toFixed(2),
      '10',
    ]);
    const asks: [string, string][] = Array.from({ length: 10 }, (_, i) => [
      (0.51 + i * 0.01).toFixed(2),
      '10',
    ]);
    const book = makeBook(bids, asks);
    expect(calcTotalLiquidity(book)).toBeCloseTo(200);
  });
});

// ── calcBidAskLiquidityRatio tests ──────────────────────────────────────────

describe('calcBidAskLiquidityRatio', () => {
  it('returns 0.5 ratio for equal liquidity', () => {
    const book = makeBook(
      [['0.48', '100'], ['0.47', '100']],
      [['0.52', '100'], ['0.53', '100']],
    );
    const result = calcBidAskLiquidityRatio(book);
    expect(result.bidLiquidity).toBeCloseTo(200);
    expect(result.askLiquidity).toBeCloseTo(200);
    expect(result.ratio).toBeCloseTo(0.5);
  });

  it('returns ratio > 0.5 when bids dominate', () => {
    const book = makeBook([['0.48', '900']], [['0.52', '100']]);
    const result = calcBidAskLiquidityRatio(book);
    expect(result.ratio).toBeCloseTo(0.9);
  });

  it('returns ratio < 0.5 when asks dominate', () => {
    const book = makeBook([['0.48', '100']], [['0.52', '900']]);
    const result = calcBidAskLiquidityRatio(book);
    expect(result.ratio).toBeCloseTo(0.1);
  });

  it('returns 0.5 for empty book', () => {
    const book = makeBook([], []);
    const result = calcBidAskLiquidityRatio(book);
    expect(result.ratio).toBe(0.5);
    expect(result.bidLiquidity).toBe(0);
    expect(result.askLiquidity).toBe(0);
  });

  it('returns 1.0 for bids only', () => {
    const book = makeBook([['0.48', '500']], []);
    const result = calcBidAskLiquidityRatio(book);
    expect(result.ratio).toBeCloseTo(1.0);
  });

  it('returns 0.0 for asks only', () => {
    const book = makeBook([], [['0.52', '500']]);
    const result = calcBidAskLiquidityRatio(book);
    expect(result.ratio).toBeCloseTo(0.0);
  });
});

// ── isVacuum tests ──────────────────────────────────────────────────────────

describe('isVacuum', () => {
  it('detects vacuum when liquidity drops below threshold', () => {
    // avg = 1000, ratio = 0.3 → threshold = 300
    expect(isVacuum(200, 1000, 0.3)).toBe(true);
  });

  it('no vacuum when liquidity is above threshold', () => {
    expect(isVacuum(500, 1000, 0.3)).toBe(false);
  });

  it('no vacuum when exactly at threshold', () => {
    expect(isVacuum(300, 1000, 0.3)).toBe(false);
  });

  it('no vacuum when avg liquidity is 0', () => {
    expect(isVacuum(0, 0, 0.3)).toBe(false);
  });

  it('detects vacuum at ratio = 0.5 (50% drop)', () => {
    expect(isVacuum(400, 1000, 0.5)).toBe(true);
  });

  it('no vacuum when current equals avg and ratio < 1', () => {
    expect(isVacuum(1000, 1000, 0.3)).toBe(false);
  });

  it('detects vacuum with very small ratio', () => {
    expect(isVacuum(50, 1000, 0.1)).toBe(true);
  });

  it('no vacuum when current is slightly above threshold', () => {
    expect(isVacuum(301, 1000, 0.3)).toBe(false);
  });
});

// ── createLiquidityVacuumTick integration tests ─────────────────────────────

describe('createLiquidityVacuumTick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a function', () => {
    const deps = makeDeps();
    const tick = createLiquidityVacuumTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('calls gamma.getTrending on each tick', async () => {
    const deps = makeDeps();
    const tick = createLiquidityVacuumTick(deps);
    await tick();
    expect(deps.gamma.getTrending).toHaveBeenCalledWith(20);
  });

  it('does not enter when market is closed', async () => {
    const market = makeMarket('m1', { closed: true });
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when market is resolved', async () => {
    const market = makeMarket('m1', { resolved: true });
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when market has no yesTokenId', async () => {
    const market = makeMarket('m1', { yesTokenId: '' });
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when mid price is below range', async () => {
    const market = makeMarket('m1');
    // Mid = 0.05 (below 0.10)
    const lowBook = makeBook([['0.04', '500']], [['0.06', '500']]);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(lowBook) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when mid price is above range', async () => {
    const market = makeMarket('m1');
    // Mid = 0.95 (above 0.90)
    const highBook = makeBook([['0.94', '500']], [['0.96', '500']]);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(highBook) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when insufficient liquidity history', async () => {
    const market = makeMarket('m1');
    // Normal liquidity book, but only 1 tick of history
    const book = makeDeepBook(500, 500, 0.50);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    // First tick — only 1 data point
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when avg liquidity is below minAvgLiquidity', async () => {
    const market = makeMarket('m1');
    // Small liquidity (< 1000 default min)
    const smallBook = makeDeepBook(100, 100, 0.50);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(smallBook) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    // Build up history
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when no vacuum detected (stable liquidity)', async () => {
    const market = makeMarket('m1');
    // Stable book with same liquidity each tick
    const stableBook = makeDeepBook(1000, 1000, 0.50);
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(stableBook) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);
    // Build up stable history
    for (let i = 0; i < 5; i++) {
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // Helper: build history then trigger vacuum in one step using phase-based mock.
  // Normal book: 5000 bids + 5000 asks = 10000 total.
  // Vacuum book (bid-side): 50 bids + 500 asks = 550 total. 550 < 10000 * 0.3 = 3000 → vacuum.
  // Vacuum book (ask-side): 500 bids + 50 asks = 550 total. Same vacuum, opposite direction.

  it('enters BUY YES when bid liquidity drops (vacuum on bids)', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    // bids << asks → price will recover up → BUY YES
    const vacuumBook = makeDeepBook(50, 500, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: 'yes-m1',
        side: 'buy',
      }),
    );
  });

  it('enters BUY NO when ask liquidity drops (vacuum on asks)', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    // asks << bids → price will recover down → BUY NO
    const vacuumBook = makeDeepBook(500, 50, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenId: 'no-m1',
        side: 'buy',
      }),
    );
  });

  it('emits trade.executed event on entry', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith(
      'trade.executed',
      expect.objectContaining({
        trade: expect.objectContaining({
          strategy: 'liquidity-vacuum',
          side: 'buy',
        }),
      }),
    );
  });

  it('respects maxPositions limit', async () => {
    const markets = Array.from({ length: 6 }, (_, i) => makeMarket(`m${i}`));
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      clob: { getOrderBook } as any,
      config: { maxPositions: 2 },
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('does not re-enter same market with existing position', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Second vacuum tick — should not enter again (position exists)
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('exits on take-profit for YES position', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);
    // Price went up significantly: entry ~0.51, now mid = 0.65 → gain > 3%
    const profitBook = makeDeepBook(5000, 5000, 0.65);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      if (phase === 'normal') return normalBook;
      if (phase === 'vacuum') return vacuumBook;
      return profitBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    phase = 'profit';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    expect(deps.orderManager.placeOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        side: 'sell',
        orderType: 'IOC',
      }),
    );
  });

  it('exits on stop-loss for YES position', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);
    // Price went down: entry ~0.51, now mid = 0.35 → loss > 2%
    const lossBook = makeDeepBook(5000, 5000, 0.35);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      if (phase === 'normal') return normalBook;
      if (phase === 'vacuum') return vacuumBook;
      return lossBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    phase = 'loss';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    expect(deps.orderManager.placeOrder).toHaveBeenLastCalledWith(
      expect.objectContaining({
        side: 'sell',
        orderType: 'IOC',
      }),
    );
  });

  it('exits on max hold time', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      if (phase === 'normal') return normalBook;
      if (phase === 'vacuum') return vacuumBook;
      // After entry, return normal book at same price (no TP/SL trigger)
      return normalBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Switch to hold phase (normal price, no TP/SL)
    phase = 'hold';
    // Advance past maxHoldMs (5 minutes)
    vi.advanceTimersByTime(6 * 60_000);
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('respects cooldown after exit', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);
    const profitBook = makeDeepBook(5000, 5000, 0.65);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      if (phase === 'normal') return normalBook;
      if (phase === 'vacuum') return vacuumBook;
      if (phase === 'profit') return profitBook;
      return vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Exit with profit
    phase = 'profit';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Try to re-enter immediately — should be on cooldown
    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Advance past cooldown (60s)
    vi.advanceTimersByTime(61_000);
    await tick();
    // May or may not re-enter depending on history state, but at least didn't crash
  });

  it('handles getOrderBook errors gracefully', async () => {
    const market = makeMarket('m1');
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('network')) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    await expect(tick()).resolves.toBeUndefined();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles gamma.getTrending errors gracefully', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('api down')) } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    await expect(tick()).resolves.toBeUndefined();
  });

  it('uses custom config when provided', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(normalBook) } as any,
      config: { vacuumRatio: 0.9 },
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }
    // With stable books and vacuumRatio=0.9, current === avg so no vacuum
    // This verifies config merging doesn't crash
    await tick();
  });

  it('skips market if noTokenId position already exists', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    // asks << bids → BUY NO → position on no-m1
    const vacuumBook = makeDeepBook(500, 50, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Next tick — same market, should skip because no-m1 has a position
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('emits trade.executed on exit', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);
    const profitBook = makeDeepBook(5000, 5000, 0.65);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      if (phase === 'normal') return normalBook;
      if (phase === 'vacuum') return vacuumBook;
      return profitBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick(); // entry

    const emitCallsBefore = (deps.eventBus.emit as any).mock.calls.length;

    phase = 'profit';
    await tick(); // exit

    expect(deps.eventBus.emit).toHaveBeenCalledWith(
      'trade.executed',
      expect.objectContaining({
        trade: expect.objectContaining({
          strategy: 'liquidity-vacuum',
        }),
      }),
    );
    expect((deps.eventBus.emit as any).mock.calls.length).toBeGreaterThan(emitCallsBefore);
  });

  it('places order with correct size calculation', async () => {
    const market = makeMarket('m1');
    const normalBook = makeDeepBook(5000, 5000, 0.50);
    const vacuumBook = makeDeepBook(50, 500, 0.50);

    let phase = 'normal';
    const getOrderBook = vi.fn().mockImplementation(() => {
      return phase === 'normal' ? normalBook : vacuumBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createLiquidityVacuumTick(deps);

    for (let i = 0; i < 3; i++) {
      await tick();
    }

    phase = 'vacuum';
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderType: 'GTC',
        side: 'buy',
      }),
    );

    // Check size is rounded integer string
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(Number(call.size)).toBe(Math.round(Number(call.size)));
  });
});
