import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calcShannonEntropy,
  calcSideEntropy,
  isLowEntropy,
  isEntropyDecreasing,
  createEntropyScorerTick,
  type EntropyScorerDeps,
} from '../../src/strategies/polymarket/entropy-scorer.js';
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

function makeDeps(overrides?: Partial<EntropyScorerDeps>): EntropyScorerDeps {
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

// ── calcShannonEntropy tests ────────────────────────────────────────────────

describe('calcShannonEntropy', () => {
  it('returns 0 for empty array', () => {
    expect(calcShannonEntropy([])).toBe(0);
  });

  it('returns 0 for all-zero sizes', () => {
    expect(calcShannonEntropy([0, 0, 0])).toBe(0);
  });

  it('returns 0 for single element (max concentration)', () => {
    expect(calcShannonEntropy([100])).toBe(0);
  });

  it('returns 1 for two equal elements', () => {
    expect(calcShannonEntropy([50, 50])).toBeCloseTo(1.0);
  });

  it('returns log2(n) for n equal elements', () => {
    // 4 equal elements → log2(4) = 2
    expect(calcShannonEntropy([25, 25, 25, 25])).toBeCloseTo(2.0);
  });

  it('returns log2(8) for 8 equal elements', () => {
    expect(calcShannonEntropy([10, 10, 10, 10, 10, 10, 10, 10])).toBeCloseTo(3.0);
  });

  it('handles unequal distribution', () => {
    // One dominant element → low entropy
    const entropy = calcShannonEntropy([90, 5, 3, 2]);
    expect(entropy).toBeGreaterThan(0);
    expect(entropy).toBeLessThan(2.0); // Less than max for 4 elements
  });

  it('concentrated distribution has lower entropy than uniform', () => {
    const concentrated = calcShannonEntropy([100, 1, 1, 1]);
    const uniform = calcShannonEntropy([25, 25, 25, 25]);
    expect(concentrated).toBeLessThan(uniform);
  });

  it('ignores zero-size entries', () => {
    const withZeros = calcShannonEntropy([50, 0, 50, 0]);
    const withoutZeros = calcShannonEntropy([50, 50]);
    expect(withZeros).toBeCloseTo(withoutZeros);
  });

  it('handles negative sizes gracefully by skipping them', () => {
    // Negative sizes are skipped entirely (from both total and entropy)
    const result = calcShannonEntropy([-10, 50, 50]);
    expect(result).toBeCloseTo(1.0);
  });
});

// ── calcSideEntropy tests ───────────────────────────────────────────────────

describe('calcSideEntropy', () => {
  it('returns 0 for empty levels', () => {
    expect(calcSideEntropy([])).toBe(0);
  });

  it('returns 0 for single level', () => {
    const levels = [{ price: '0.50', size: '100' }];
    expect(calcSideEntropy(levels)).toBe(0);
  });

  it('calculates entropy from level sizes', () => {
    const levels = [
      { price: '0.50', size: '50' },
      { price: '0.49', size: '50' },
    ];
    expect(calcSideEntropy(levels)).toBeCloseTo(1.0);
  });

  it('concentrated levels have lower entropy', () => {
    const concentrated = [
      { price: '0.50', size: '100' },
      { price: '0.49', size: '1' },
      { price: '0.48', size: '1' },
    ];
    const spread = [
      { price: '0.50', size: '33' },
      { price: '0.49', size: '33' },
      { price: '0.48', size: '34' },
    ];
    expect(calcSideEntropy(concentrated)).toBeLessThan(calcSideEntropy(spread));
  });

  it('filters out zero-size levels', () => {
    const levels = [
      { price: '0.50', size: '50' },
      { price: '0.49', size: '0' },
      { price: '0.48', size: '50' },
    ];
    expect(calcSideEntropy(levels)).toBeCloseTo(1.0);
  });
});

// ── isLowEntropy tests ──────────────────────────────────────────────────────

describe('isLowEntropy', () => {
  it('returns true when entropy is below threshold', () => {
    expect(isLowEntropy(1.0, 1.5)).toBe(true);
  });

  it('returns false when entropy is above threshold', () => {
    expect(isLowEntropy(2.0, 1.5)).toBe(false);
  });

  it('returns false when entropy equals threshold', () => {
    expect(isLowEntropy(1.5, 1.5)).toBe(false);
  });

  it('returns true for zero entropy', () => {
    expect(isLowEntropy(0, 1.5)).toBe(true);
  });
});

// ── isEntropyDecreasing tests ───────────────────────────────────────────────

describe('isEntropyDecreasing', () => {
  it('returns false for empty history', () => {
    expect(isEntropyDecreasing(1.0, [], 0.2)).toBe(false);
  });

  it('returns true when entropy dropped by minDrop from avg', () => {
    const history = [2.0, 2.0, 2.0, 2.0];
    // avg = 2.0, current = 1.5, drop = 0.5 > 0.2
    expect(isEntropyDecreasing(1.5, history, 0.2)).toBe(true);
  });

  it('returns false when drop is less than minDrop', () => {
    const history = [2.0, 2.0, 2.0, 2.0];
    // avg = 2.0, current = 1.9, drop = 0.1 < 0.2
    expect(isEntropyDecreasing(1.9, history, 0.2)).toBe(false);
  });

  it('returns false when entropy is increasing', () => {
    const history = [1.0, 1.0, 1.0];
    // avg = 1.0, current = 1.5, drop = -0.5
    expect(isEntropyDecreasing(1.5, history, 0.2)).toBe(false);
  });

  it('returns false when drop exactly equals minDrop (strict inequality)', () => {
    const history = [2.0, 2.0];
    // avg = 2.0, current = 1.8, drop = 0.2, but >= is not used (strict >)
    expect(isEntropyDecreasing(1.8, history, 0.2)).toBe(false);
  });

  it('returns true when drop exceeds minDrop by small amount', () => {
    const history = [2.0, 2.0];
    // avg = 2.0, current = 1.79, drop = 0.21 > 0.2
    expect(isEntropyDecreasing(1.79, history, 0.2)).toBe(true);
  });

  it('works with single-element history', () => {
    expect(isEntropyDecreasing(1.0, [2.0], 0.2)).toBe(true);
  });
});

// ── createEntropyScorerTick integration tests ───────────────────────────────

describe('createEntropyScorerTick', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a function', () => {
    const tick = createEntropyScorerTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does nothing when no trending markets', async () => {
    const deps = makeDeps();
    const tick = createEntropyScorerTick(deps);
    await tick();
    expect(deps.gamma.getTrending).toHaveBeenCalled();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const market = makeMarket('m1', { closed: true });
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });
    const tick = createEntropyScorerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const market = makeMarket('m1', { resolved: true });
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });
    const tick = createEntropyScorerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const market = makeMarket('m1', { yesTokenId: '' });
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });
    const tick = createEntropyScorerTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets with insufficient book depth', async () => {
    const market = makeMarket('m1');
    // Only 2 bid levels, needs 3
    const book = makeBook(
      [['0.50', '100'], ['0.49', '50']],
      [['0.52', '100'], ['0.53', '50'], ['0.54', '30']],
    );
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
    });
    const tick = createEntropyScorerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips when mid is 0 or 1', async () => {
    const market = makeMarket('m1');
    const book = makeBook(
      [['0.00', '100'], ['0.00', '50'], ['0.00', '30']],
      [['0.00', '100'], ['0.00', '50'], ['0.00', '30']],
    );
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
    });
    const tick = createEntropyScorerTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('needs multiple ticks to build history before entering', async () => {
    const market = makeMarket('m1');
    // Concentrated book: one big bid, small asks → low entropy, bid side concentrated
    const book = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '10'], ['0.53', '10'], ['0.54', '10']],
    );
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1 },
    });
    const tick = createEntropyScorerTick(deps);

    // First tick — only 1 history entry, needs at least 2
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters YES when bid entropy < ask entropy and conditions met', async () => {
    const market = makeMarket('m1');
    // Bid side: concentrated (one big order) → low entropy
    // Ask side: spread out → higher entropy
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // First several calls: high entropy (to build history with higher avg)
      if (callCount <= 3) return highEntropyBook;
      // Then low entropy (entropy drops)
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0 },
    });
    const tick = createEntropyScorerTick(deps);

    // Build history
    await tick();
    await tick();
    await tick();
    // Now entry should trigger
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
  });

  it('enters NO when ask entropy < bid entropy and conditions met', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    // Ask side concentrated, bid side spread → ask entropy < bid entropy → NO
    const lowEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '500'], ['0.53', '1'], ['0.54', '1']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    // Should use noTokenId
    expect(call.tokenId).toBe('no-m1');
  });

  it('respects maxPositions', async () => {
    const markets = [makeMarket('m1'), makeMarket('m2'), makeMarket('m3')];
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 9) return highEntropyBook; // 3 markets × 3 ticks
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0, maxPositions: 1 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick();

    // Only 1 position allowed
    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(1);
  });

  it('emits trade.executed on entry', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        strategy: 'entropy-scorer',
        side: 'buy',
      }),
    }));
  });

  it('exits position on take-profit', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    // Price moved up significantly for take-profit
    const profitBook = makeBook(
      [['0.58', '100'], ['0.57', '50'], ['0.56', '30']],
      [['0.60', '100'], ['0.59', '50'], ['0.58', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      if (callCount <= 4) return lowEntropyBook;
      return profitBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0, takeProfitPct: 0.035 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick(); // entry

    // Advance time and tick for exit
    vi.advanceTimersByTime(1000);
    await tick(); // should trigger exit

    // placeOrder called twice: entry + exit
    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits position on stop-loss', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    // Price dropped for stop-loss
    const lossBook = makeBook(
      [['0.44', '100'], ['0.43', '50'], ['0.42', '30']],
      [['0.46', '100'], ['0.45', '50'], ['0.44', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      if (callCount <= 4) return lowEntropyBook;
      return lossBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0, stopLossPct: 0.02 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick(); // entry

    vi.advanceTimersByTime(1000);
    await tick(); // stop-loss exit

    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(2);
  });

  it('exits position on max hold time', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    // Same price — no TP/SL trigger
    const flatBook = makeBook(
      [['0.51', '100'], ['0.50', '50'], ['0.49', '30']],
      [['0.53', '100'], ['0.52', '50'], ['0.51', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      if (callCount <= 4) return lowEntropyBook;
      return flatBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0, maxHoldMs: 15 * 60_000 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick(); // entry

    // Advance past maxHoldMs
    vi.advanceTimersByTime(16 * 60_000);
    await tick(); // max hold exit

    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(2);
  });

  it('applies cooldown after exit', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const flatBook = makeBook(
      [['0.51', '100'], ['0.50', '50'], ['0.49', '30']],
      [['0.53', '100'], ['0.52', '50'], ['0.51', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      if (callCount <= 4) return lowEntropyBook;
      return flatBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0, maxHoldMs: 1000, cooldownMs: 120_000 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick(); // entry

    vi.advanceTimersByTime(2000);
    await tick(); // exit via max hold

    const orderCount = (deps.orderManager.placeOrder as any).mock.calls.length;
    expect(orderCount).toBe(2); // entry + exit

    // Immediately try again — should be on cooldown
    await tick();
    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(orderCount);
  });

  it('does not enter when entropy is above threshold', async () => {
    const market = makeMarket('m1');
    // Uniform distribution → high entropy
    const uniformBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(uniformBook) } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 0.5 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when entropy is not decreasing', async () => {
    const market = makeMarket('m1');
    // Low entropy but constant — no drop from average
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockResolvedValue(lowEntropyBook) } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.5, lowEntropyThreshold: 3.0 },
    });
    const tick = createEntropyScorerTick(deps);

    // All ticks see same entropy — avg ≈ current, no drop
    await tick();
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles clob errors gracefully', async () => {
    const market = makeMarket('m1');
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('network')) } as any,
    });
    const tick = createEntropyScorerTick(deps);

    // Should not throw
    await expect(tick()).resolves.not.toThrow();
  });

  it('handles gamma errors gracefully', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('gamma down')) } as any,
    });
    const tick = createEntropyScorerTick(deps);
    await expect(tick()).resolves.not.toThrow();
  });

  it('uses noTokenId when entering NO side', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    // Ask side concentrated → ask entropy < bid entropy → NO
    const lowEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '500'], ['0.53', '1'], ['0.54', '1']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick();

    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.tokenId).toBe('no-m1');
  });

  it('falls back to yesTokenId when noTokenId is null', async () => {
    const market = makeMarket('m1', { noTokenId: null });
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    // Ask concentrated → NO side, but noTokenId is null
    const lowEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '500'], ['0.53', '1'], ['0.54', '1']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick();

    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.tokenId).toBe('yes-m1');
  });

  it('does not re-enter a market with existing position', async () => {
    const market = makeMarket('m1');
    const highEntropyBook = makeBook(
      [['0.50', '30'], ['0.49', '30'], ['0.48', '30']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );
    const lowEntropyBook = makeBook(
      [['0.50', '500'], ['0.49', '1'], ['0.48', '1']],
      [['0.52', '30'], ['0.53', '30'], ['0.54', '30']],
    );

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 3) return highEntropyBook;
      return lowEntropyBook;
    });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook } as any,
      config: { entropyWindow: 3, minEntropyDrop: 0.1, lowEntropyThreshold: 3.0, maxPositions: 4 },
    });
    const tick = createEntropyScorerTick(deps);

    await tick();
    await tick();
    await tick();
    await tick(); // entry

    // Tick again — should not create duplicate position
    await tick();
    expect((deps.orderManager.placeOrder as any).mock.calls.length).toBe(1);
  });
});
