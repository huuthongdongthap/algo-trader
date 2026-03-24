import { describe, it, expect, vi } from 'vitest';
import {
  calcDepthRatio,
  calcDepthZScore,
  detectMomentum,
  createOrderbookDepthRatioTick,
  type OrderbookDepthDeps,
} from '../../src/strategies/polymarket/orderbook-depth-ratio.js';
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

// ── calcDepthRatio tests ────────────────────────────────────────────────────

describe('calcDepthRatio', () => {
  it('returns 0 for empty book', () => {
    const book = makeBook([], []);
    expect(calcDepthRatio(book, 5)).toBe(0);
  });

  it('returns Infinity when only bids exist', () => {
    const book = makeBook([['0.50', '100'], ['0.49', '80']], []);
    expect(calcDepthRatio(book, 5)).toBe(Infinity);
  });

  it('returns 0 when only asks exist', () => {
    const book = makeBook([], [['0.60', '100'], ['0.61', '50']]);
    expect(calcDepthRatio(book, 5)).toBe(0);
  });

  it('returns 1 for balanced book', () => {
    const book = makeBook(
      [['0.50', '100'], ['0.49', '50']],
      [['0.51', '100'], ['0.52', '50']],
    );
    expect(calcDepthRatio(book, 5)).toBe(1);
  });

  it('returns > 1 when bids > asks (heavy bid)', () => {
    const book = makeBook(
      [['0.50', '300'], ['0.49', '200']],
      [['0.51', '50'], ['0.52', '50']],
    );
    const ratio = calcDepthRatio(book, 5);
    // 500 / 100 = 5
    expect(ratio).toBe(5);
  });

  it('returns < 1 when asks > bids (heavy ask)', () => {
    const book = makeBook(
      [['0.50', '50'], ['0.49', '50']],
      [['0.51', '300'], ['0.52', '200']],
    );
    const ratio = calcDepthRatio(book, 5);
    // 100 / 500 = 0.2
    expect(ratio).toBeCloseTo(0.2);
  });

  it('respects depth limit', () => {
    const book = makeBook(
      [['0.50', '100'], ['0.49', '200'], ['0.48', '300']],
      [['0.51', '100']],
    );
    // depth=1: bids=100, asks=100 → ratio=1
    expect(calcDepthRatio(book, 1)).toBe(1);
    // depth=3: bids=600, asks=100 → ratio=6
    expect(calcDepthRatio(book, 3)).toBe(6);
  });
});

// ── calcDepthZScore tests ───────────────────────────────────────────────────

describe('calcDepthZScore', () => {
  it('returns 0 for insufficient data (< 3 observations)', () => {
    expect(calcDepthZScore([])).toBe(0);
    expect(calcDepthZScore([1.0])).toBe(0);
    expect(calcDepthZScore([1.0, 1.5])).toBe(0);
  });

  it('returns 0 when all ratios are constant (zero variance)', () => {
    expect(calcDepthZScore([1.0, 1.0, 1.0, 1.0])).toBe(0);
  });

  it('returns positive z-score when latest ratio is above mean', () => {
    // [1.0, 1.0, 1.0, 3.0] → mean=1.5, last=3.0 → z > 0
    const z = calcDepthZScore([1.0, 1.0, 1.0, 3.0]);
    expect(z).toBeGreaterThan(0);
  });

  it('returns negative z-score when latest ratio is below mean', () => {
    // [3.0, 3.0, 3.0, 1.0] → mean=2.5, last=1.0 → z < 0
    const z = calcDepthZScore([3.0, 3.0, 3.0, 1.0]);
    expect(z).toBeLessThan(0);
  });

  it('returns high z-score for outlier deviation from mean', () => {
    // Stable at 1.0 then spike to 5.0
    const ratios = Array(19).fill(1.0);
    ratios.push(5.0);
    const z = calcDepthZScore(ratios);
    expect(z).toBeGreaterThan(2);
  });
});

// ── detectMomentum tests ────────────────────────────────────────────────────

describe('detectMomentum', () => {
  it('returns flat for insufficient data (< 3 prices)', () => {
    expect(detectMomentum([])).toBe('flat');
    expect(detectMomentum([0.5])).toBe('flat');
    expect(detectMomentum([0.5, 0.6])).toBe('flat');
  });

  it('returns up for ascending prices', () => {
    expect(detectMomentum([0.40, 0.45, 0.50])).toBe('up');
  });

  it('returns down for descending prices', () => {
    expect(detectMomentum([0.60, 0.55, 0.50])).toBe('down');
  });

  it('returns flat for non-monotonic prices', () => {
    expect(detectMomentum([0.50, 0.55, 0.50])).toBe('flat');
  });

  it('uses last 3 prices when given more', () => {
    // Last 3: [0.40, 0.45, 0.50] → up
    expect(detectMomentum([0.90, 0.80, 0.40, 0.45, 0.50])).toBe('up');
    // Last 3: [0.60, 0.55, 0.50] → down
    expect(detectMomentum([0.10, 0.20, 0.60, 0.55, 0.50])).toBe('down');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides?: Partial<OrderbookDepthDeps>): OrderbookDepthDeps {
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
      placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }),
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

describe('createOrderbookDepthRatioTick', () => {
  it('returns a callable function', () => {
    const tick = createOrderbookDepthRatioTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient depth history)', async () => {
    const deps = makeDeps();
    const tick = createOrderbookDepthRatioTick(deps);
    await tick();
    // Only 1 ratio recorded, need lookbackPeriods (20) → no entry
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createOrderbookDepthRatioTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error during scan', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createOrderbookDepthRatioTick(deps);
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
    const tick = createOrderbookDepthRatioTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('places entry on heavy bid support + momentum alignment', async () => {
    // Heavy bid book: ratio = 1500 / 115 ≈ 13 (>> 3.0)
    const heavyBidBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );

    // Balanced book for building history: ratio = 1.0
    const balancedBook = makeBook(
      [['0.49', '100']], [['0.51', '100']],
    );

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First 19 calls: balanced book (ratio ≈ 1.0)
        if (callCount <= 19) {
          return Promise.resolve(balancedBook);
        }
        // 20th+: heavy bid book with rising mid to align momentum
        return Promise.resolve(heavyBidBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        highThreshold: 3.0,
        zScoreThreshold: 1.5,
        momentumAlignRequired: false, // disable momentum filter for simpler test
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    // Run 20 ticks to build depth history
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    // 21st tick should detect heavy bid signal and place order
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const orderArgs = (deps.orderManager.placeOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(orderArgs.side).toBe('buy');
  });

  it('places entry on heavy ask pressure (BUY NO)', async () => {
    // Heavy ask book: ratio = 115 / 1500 ≈ 0.077 (<< 0.33)
    const heavyAskBook = makeBook(
      [['0.47', '50'], ['0.46', '30'], ['0.45', '20'], ['0.44', '10'], ['0.43', '5']],
      [['0.48', '500'], ['0.49', '400'], ['0.50', '300'], ['0.51', '200'], ['0.52', '100']],
    );

    const balancedBook = makeBook(
      [['0.49', '100']], [['0.51', '100']],
    );

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 19) {
          return Promise.resolve(balancedBook);
        }
        return Promise.resolve(heavyAskBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        lowThreshold: 0.33,
        zScoreThreshold: 1.5,
        momentumAlignRequired: false,
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    for (let i = 0; i < 20; i++) {
      await tick();
    }
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('exits on take-profit', async () => {
    // Entry: heavy bid, mid ≈ 0.525
    const entryBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);

    // Exit book: price moved up by > 2.5% from entry
    // entry mid ≈ 0.525, TP at 0.525 * 1.025 ≈ 0.538
    const tpBook = makeBook(
      [['0.56', '100']], [['0.58', '100']],
    );

    let callCount = 0;
    let phase: 'history' | 'entry' | 'exit' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (phase === 'history') return Promise.resolve(balancedBook);
        if (phase === 'entry') return Promise.resolve(entryBook);
        return Promise.resolve(tpBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        takeProfitPct: 0.025,
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    // Build history
    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    // Entry tick
    phase = 'entry';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Exit tick with TP
    phase = 'exit';
    await tick();
    // Should have placed exit order (2nd call to placeOrder)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(exitCall.side).toBe('sell'); // selling YES position
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits on stop-loss', async () => {
    const entryBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);

    // SL book: price dropped by > 1.8% from entry
    // entry mid ≈ 0.525, SL at 0.525 * (1 - 0.018) ≈ 0.5155
    const slBook = makeBook(
      [['0.49', '100']], [['0.51', '100']],
    );

    let phase: 'history' | 'entry' | 'exit' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        if (phase === 'history') return Promise.resolve(balancedBook);
        if (phase === 'entry') return Promise.resolve(entryBook);
        return Promise.resolve(slBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        stopLossPct: 0.018,
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    phase = 'entry';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    phase = 'exit';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('exits on max hold time', async () => {
    const entryBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    // Price stays near entry (no TP/SL), balanced ratio (no reversal)
    const holdBook = makeBook(
      [['0.52', '100']], [['0.53', '100']],
    );

    let phase: 'history' | 'entry' | 'exit' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        if (phase === 'history') return Promise.resolve(balancedBook);
        if (phase === 'entry') return Promise.resolve(entryBook);
        return Promise.resolve(holdBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        maxHoldMs: 1, // 1ms → will immediately expire
        stopLossPct: 0.5, // wide SL so it doesn't trigger
        takeProfitPct: 0.5, // wide TP so it doesn't trigger
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    phase = 'entry';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Wait to ensure maxHoldMs is exceeded
    await new Promise(r => setTimeout(r, 5));

    phase = 'exit';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('does not enter when on cooldown', async () => {
    const entryBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const tpBook = makeBook([['0.56', '100']], [['0.58', '100']]);

    let phase: 'history' | 'entry' | 'tp' | 'reentry' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        if (phase === 'history') return Promise.resolve(balancedBook);
        if (phase === 'entry') return Promise.resolve(entryBook);
        if (phase === 'tp') return Promise.resolve(tpBook);
        return Promise.resolve(entryBook); // reentry attempt
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        cooldownMs: 60_000, // long cooldown
        takeProfitPct: 0.025,
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    // Enter
    phase = 'entry';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // TP exit
    phase = 'tp';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Try to re-enter during cooldown
    phase = 'reentry';
    await tick();
    // Should NOT have placed a 3rd order (cooldown active)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('respects maxPositions limit', async () => {
    const heavyBidBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);

    let phase: 'history' | 'entry' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        if (phase === 'history') return Promise.resolve(balancedBook);
        return Promise.resolve(heavyBidBook);
      }),
    };

    // 3 different markets
    const markets = [
      { id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1', closed: false, resolved: false, active: true },
      { id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2', closed: false, resolved: false, active: true },
      { id: 'm3', conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3', closed: false, resolved: false, active: true },
    ];

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        maxPositions: 2, // only allow 2
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    phase = 'entry';
    await tick();

    // Should only have 2 entries, not 3
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('does not enter when momentum is misaligned', async () => {
    // Heavy bid book (ratio >> 3.0) but price is going DOWN
    const heavyBidBook = makeBook(
      [['0.47', '500'], ['0.46', '400'], ['0.45', '300'], ['0.44', '200'], ['0.43', '100']],
      [['0.48', '50'], ['0.49', '30'], ['0.50', '20'], ['0.51', '10'], ['0.52', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);

    // Simulate declining prices to create 'down' momentum
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 17) {
          return Promise.resolve(balancedBook);
        }
        // Last few ticks: declining price + heavy bid book
        // This creates 'down' momentum while signal says BUY YES
        const declineBooks = [
          makeBook([['0.49', '100']], [['0.51', '100']]), // mid=0.50
          makeBook([['0.48', '100']], [['0.50', '100']]), // mid=0.49
          makeBook([['0.47', '100']], [['0.49', '100']]), // mid=0.48
        ];
        const idx = callCount - 18;
        if (idx < declineBooks.length) {
          return Promise.resolve(declineBooks[idx]);
        }
        return Promise.resolve(heavyBidBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: true, // momentum must align
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    for (let i = 0; i < 21; i++) {
      await tick();
    }

    // Heavy bid wants BUY YES, but momentum is 'down' → no entry
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('exits on depth ratio reversal', async () => {
    const entryBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);

    // Reversal book: ratio flips to heavy asks (ratio << 0.33) while YES pos is open
    // Price stays near entry so no TP/SL
    const reversalBook = makeBook(
      [['0.52', '10'], ['0.51', '5']],
      [['0.53', '500'], ['0.54', '400'], ['0.55', '300'], ['0.56', '200'], ['0.57', '100']],
    );

    let phase: 'history' | 'entry' | 'reversal' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        if (phase === 'history') return Promise.resolve(balancedBook);
        if (phase === 'entry') return Promise.resolve(entryBook);
        return Promise.resolve(reversalBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        stopLossPct: 0.5, // wide SL
        takeProfitPct: 0.5, // wide TP
        maxHoldMs: 999_999, // long hold
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    phase = 'entry';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Reversal: depth ratio flips to heavy ask while holding YES
    phase = 'reversal';
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(exitCall.orderType).toBe('IOC');
  });

  it('emits trade.executed events on entry and exit', async () => {
    const entryBook = makeBook(
      [['0.52', '500'], ['0.51', '400'], ['0.50', '300'], ['0.49', '200'], ['0.48', '100']],
      [['0.53', '50'], ['0.54', '30'], ['0.55', '20'], ['0.56', '10'], ['0.57', '5']],
    );
    const balancedBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    const tpBook = makeBook([['0.56', '100']], [['0.58', '100']]);

    let phase: 'history' | 'entry' | 'tp' = 'history';
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        if (phase === 'history') return Promise.resolve(balancedBook);
        if (phase === 'entry') return Promise.resolve(entryBook);
        return Promise.resolve(tpBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        lookbackPeriods: 20,
        momentumAlignRequired: false,
        takeProfitPct: 0.025,
      },
    });
    const tick = createOrderbookDepthRatioTick(deps);

    phase = 'history';
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    phase = 'entry';
    await tick();
    expect(deps.eventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        strategy: 'orderbook-depth-ratio',
        side: 'buy',
      }),
    }));

    phase = 'tp';
    await tick();
    // Should have emitted a second trade.executed for the exit
    const emitCalls = (deps.eventBus.emit as ReturnType<typeof vi.fn>).mock.calls;
    const tradeEvents = emitCalls.filter(c => c[0] === 'trade.executed');
    expect(tradeEvents.length).toBe(2);
  });
});
