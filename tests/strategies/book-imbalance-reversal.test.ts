import { describe, it, expect, vi } from 'vitest';
import {
  calcOBI,
  calcZScore,
  createBookImbalanceReversalTick,
  type BookImbalanceDeps,
} from '../../src/strategies/polymarket/book-imbalance-reversal.js';
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

// ── calcOBI tests ───────────────────────────────────────────────────────────

describe('calcOBI', () => {
  it('returns 0 for empty book', () => {
    const book = makeBook([], []);
    expect(calcOBI(book, 5)).toBe(0);
  });

  it('returns +1 when only bids exist', () => {
    const book = makeBook([['0.50', '100']], []);
    expect(calcOBI(book, 5)).toBe(1);
  });

  it('returns -1 when only asks exist', () => {
    const book = makeBook([], [['0.60', '100']]);
    expect(calcOBI(book, 5)).toBe(-1);
  });

  it('returns 0 for balanced book', () => {
    const book = makeBook(
      [['0.50', '100'], ['0.49', '50']],
      [['0.51', '100'], ['0.52', '50']],
    );
    expect(calcOBI(book, 5)).toBe(0);
  });

  it('returns positive when bids > asks', () => {
    const book = makeBook(
      [['0.50', '200'], ['0.49', '100']],
      [['0.51', '50'], ['0.52', '50']],
    );
    const obi = calcOBI(book, 5);
    expect(obi).toBeGreaterThan(0);
    // (300 - 100) / (300 + 100) = 0.5
    expect(obi).toBeCloseTo(0.5);
  });

  it('respects depth limit', () => {
    const book = makeBook(
      [['0.50', '100'], ['0.49', '200'], ['0.48', '300']],
      [['0.51', '100']],
    );
    // depth=1: bids=100, asks=100 → OBI=0
    expect(calcOBI(book, 1)).toBe(0);
    // depth=3: bids=600, asks=100 → OBI > 0
    expect(calcOBI(book, 3)).toBeGreaterThan(0);
  });
});

// ── calcZScore tests ────────────────────────────────────────────────────────

describe('calcZScore', () => {
  it('returns 0 for < 3 prices', () => {
    expect(calcZScore([])).toBe(0);
    expect(calcZScore([0.5])).toBe(0);
    expect(calcZScore([0.5, 0.5])).toBe(0);
  });

  it('returns 0 when all prices are equal', () => {
    expect(calcZScore([0.5, 0.5, 0.5, 0.5])).toBe(0);
  });

  it('returns positive when last price > mean', () => {
    // [0.40, 0.40, 0.40, 0.60] → mean=0.45, last=0.60 → z > 0
    const z = calcZScore([0.40, 0.40, 0.40, 0.60]);
    expect(z).toBeGreaterThan(0);
  });

  it('returns negative when last price < mean', () => {
    // [0.60, 0.60, 0.60, 0.40] → mean=0.55, last=0.40 → z < 0
    const z = calcZScore([0.60, 0.60, 0.60, 0.40]);
    expect(z).toBeLessThan(0);
  });

  it('returns high z-score for outlier', () => {
    // Stable at 0.50 then spike to 0.80
    const prices = Array(19).fill(0.50);
    prices.push(0.80);
    const z = calcZScore(prices);
    expect(z).toBeGreaterThan(2);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<BookImbalanceDeps> = {}): BookImbalanceDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '100'], ['0.47', '80'], ['0.46', '60'], ['0.45', '40'], ['0.44', '20']],
          [['0.52', '100'], ['0.53', '80'], ['0.54', '60'], ['0.55', '40'], ['0.56', '20']],
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

describe('createBookImbalanceReversalTick', () => {
  it('returns a function', () => {
    const tick = createBookImbalanceReversalTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createBookImbalanceReversalTick(deps);
    await tick();
    // Only 1 price recorded, need lookbackPeriods (20) → no entry
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createBookImbalanceReversalTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createBookImbalanceReversalTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed/resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          closed: true, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createBookImbalanceReversalTick(deps);
    await tick();
    // getOrderBook should not be called for closed markets
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('places entry when OBI and z-score align after enough history', async () => {
    // Build a book with heavy bid imbalance (OBI > 0.3)
    const heavyBidBook = makeBook(
      [['0.45', '500'], ['0.44', '400'], ['0.43', '300'], ['0.42', '200'], ['0.41', '100']],
      [['0.46', '50'], ['0.47', '30'], ['0.48', '20'], ['0.49', '10'], ['0.50', '5']],
    );

    // Simulate prices dropping (z < -1.5) by returning different mids over time
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First 19 calls: stable at 0.50
        if (callCount <= 19) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // 20th+ call: price drops to 0.35 with heavy bid imbalance
        return Promise.resolve(heavyBidBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { lookbackPeriods: 20, obiThreshold: 0.3, zScoreThreshold: 1.5 },
    });
    const tick = createBookImbalanceReversalTick(deps);

    // Run 20 ticks to build history
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    // 21st tick should detect signal and place order
    await tick();

    // Should have placed an entry order
    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });
});
