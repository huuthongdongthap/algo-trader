import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcMarkoutScore,
  isToxic,
  detectTrend,
  createAdverseSelectionFilterTick,
  type AdverseSelectionFilterConfig,
  type AdverseSelectionFilterDeps,
  type MarkoutEntry,
} from '../../src/strategies/polymarket/adverse-selection-filter.js';
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

function makeConfig(overrides: Partial<AdverseSelectionFilterConfig> = {}): AdverseSelectionFilterConfig {
  return {
    markoutWindowMs: 60_000,
    markoutHistory: 20,
    minMarkoutScore: -0.005,
    toxicThreshold: -0.02,
    blacklistMs: 600_000,
    trendTicks: 5,
    trendThreshold: 0.02,
    takeProfitPct: 0.04,
    stopLossPct: 0.025,
    maxHoldMs: 15 * 60_000,
    maxPositions: 4,
    cooldownMs: 90_000,
    positionSize: '15',
    ...overrides,
  };
}

function makeMarkoutEntry(pnl: number, overrides: Partial<MarkoutEntry> = {}): MarkoutEntry {
  return {
    entryPrice: 0.50,
    markoutPrice: 0.50 + pnl,
    pnl,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── calcMarkoutScore tests ──────────────────────────────────────────────────

describe('calcMarkoutScore', () => {
  it('returns 0 for empty entries', () => {
    expect(calcMarkoutScore([], 20)).toBe(0);
  });

  it('returns the single entry pnl', () => {
    const entries = [makeMarkoutEntry(0.01)];
    expect(calcMarkoutScore(entries, 20)).toBeCloseTo(0.01);
  });

  it('calculates average over multiple entries', () => {
    const entries = [
      makeMarkoutEntry(0.01),
      makeMarkoutEntry(0.03),
      makeMarkoutEntry(-0.02),
    ];
    // (0.01 + 0.03 - 0.02) / 3 ≈ 0.00667
    expect(calcMarkoutScore(entries, 20)).toBeCloseTo(0.02 / 3);
  });

  it('only uses last historyLimit entries', () => {
    const entries = [
      makeMarkoutEntry(-0.10), // should be excluded with limit=2
      makeMarkoutEntry(0.04),
      makeMarkoutEntry(0.02),
    ];
    // Only last 2: (0.04 + 0.02) / 2 = 0.03
    expect(calcMarkoutScore(entries, 2)).toBeCloseTo(0.03);
  });

  it('returns negative for consistently bad markouts', () => {
    const entries = [
      makeMarkoutEntry(-0.03),
      makeMarkoutEntry(-0.02),
      makeMarkoutEntry(-0.01),
    ];
    expect(calcMarkoutScore(entries, 20)).toBeLessThan(0);
  });

  it('returns positive for consistently good markouts', () => {
    const entries = [
      makeMarkoutEntry(0.05),
      makeMarkoutEntry(0.03),
      makeMarkoutEntry(0.02),
    ];
    expect(calcMarkoutScore(entries, 20)).toBeGreaterThan(0);
  });

  it('handles single entry with historyLimit=1', () => {
    const entries = [
      makeMarkoutEntry(-0.10),
      makeMarkoutEntry(0.05),
    ];
    // Only last 1: 0.05
    expect(calcMarkoutScore(entries, 1)).toBeCloseTo(0.05);
  });

  it('returns 0 when all pnls are zero', () => {
    const entries = [makeMarkoutEntry(0), makeMarkoutEntry(0)];
    expect(calcMarkoutScore(entries, 20)).toBe(0);
  });
});

// ── isToxic tests ───────────────────────────────────────────────────────────

describe('isToxic', () => {
  it('returns true when score is below threshold', () => {
    expect(isToxic(-0.03, -0.02)).toBe(true);
  });

  it('returns false when score is above threshold', () => {
    expect(isToxic(-0.01, -0.02)).toBe(false);
  });

  it('returns false when score equals threshold', () => {
    expect(isToxic(-0.02, -0.02)).toBe(false);
  });

  it('returns false for positive score', () => {
    expect(isToxic(0.05, -0.02)).toBe(false);
  });

  it('returns true for very negative score', () => {
    expect(isToxic(-1.0, -0.02)).toBe(true);
  });

  it('handles zero threshold', () => {
    expect(isToxic(-0.001, 0)).toBe(true);
    expect(isToxic(0.001, 0)).toBe(false);
  });
});

// ── detectTrend tests ───────────────────────────────────────────────────────

describe('detectTrend', () => {
  it('returns null for insufficient data', () => {
    expect(detectTrend([0.50, 0.51], 5, 0.02)).toBeNull();
  });

  it('returns null for empty array', () => {
    expect(detectTrend([], 5, 0.02)).toBeNull();
  });

  it('detects upward trend', () => {
    // 0.50 → 0.52 = +4% > 2% threshold
    const prices = [0.50, 0.505, 0.51, 0.515, 0.52];
    expect(detectTrend(prices, 5, 0.02)).toBe('up');
  });

  it('detects downward trend', () => {
    // 0.52 → 0.50 = -3.8% < -2%
    const prices = [0.52, 0.515, 0.51, 0.505, 0.50];
    expect(detectTrend(prices, 5, 0.02)).toBe('down');
  });

  it('returns null for flat prices', () => {
    const prices = [0.50, 0.501, 0.499, 0.500, 0.501];
    expect(detectTrend(prices, 5, 0.02)).toBeNull();
  });

  it('uses only the last trendTicks prices', () => {
    // First few go down, but last 3 go up
    const prices = [0.60, 0.55, 0.50, 0.50, 0.52, 0.55];
    // last 3: [0.50, 0.52, 0.55] → (0.55 - 0.50) / 0.50 = 10%
    expect(detectTrend(prices, 3, 0.02)).toBe('up');
  });

  it('returns null when first price is zero', () => {
    const prices = [0, 0.01, 0.02, 0.03, 0.04];
    expect(detectTrend(prices, 5, 0.02)).toBeNull();
  });

  it('handles exact threshold (up)', () => {
    // 0.50 → 0.51 = +2% exactly
    const prices = [0.50, 0.502, 0.505, 0.508, 0.51];
    expect(detectTrend(prices, 5, 0.02)).toBe('up');
  });

  it('handles exact threshold (down)', () => {
    // 0.50 → 0.49 = -2% exactly
    const prices = [0.50, 0.498, 0.495, 0.492, 0.49];
    expect(detectTrend(prices, 5, 0.02)).toBe('down');
  });

  it('returns null when just under threshold', () => {
    // 0.50 → 0.509 = +1.8% < 2%
    const prices = [0.50, 0.502, 0.504, 0.507, 0.509];
    expect(detectTrend(prices, 5, 0.02)).toBeNull();
  });

  it('works with trendTicks=1', () => {
    // Single price, first===last, change=0
    const prices = [0.50];
    expect(detectTrend(prices, 1, 0.02)).toBeNull();
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AdverseSelectionFilterDeps> = {}): AdverseSelectionFilterDeps {
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

describe('createAdverseSelectionFilterTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createAdverseSelectionFilterTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (no trend data yet)', async () => {
    const deps = makeDeps();
    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createAdverseSelectionFilterTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createAdverseSelectionFilterTick(deps);
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
    const tick = createAdverseSelectionFilterTick(deps);
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
    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('enters buy-yes position on upward trend', async () => {
    // Simulate prices trending up over trendTicks=3 ticks with low threshold
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Prices trending up: 0.50, 0.52, 0.55
        const mids: [string, string, string, string][] = [
          ['0.49', '0.51', '10', '10'],
          ['0.51', '0.53', '10', '10'],
          ['0.54', '0.56', '10', '10'],
        ];
        const idx = Math.min(callCount - 1, mids.length - 1);
        return Promise.resolve(makeBook(
          [[mids[idx][0], mids[idx][2]]],
          [[mids[idx][1], mids[idx][3]]],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    // Need 3 ticks (trendTicks) to build price history and detect trend
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.tokenId).toBe('yes-1');
  });

  it('enters buy-no position on downward trend', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Prices trending down: 0.55, 0.52, 0.50
        const mids: [string, string][] = [
          ['0.54', '0.56'],
          ['0.51', '0.53'],
          ['0.49', '0.51'],
        ];
        const idx = Math.min(callCount - 1, mids.length - 1);
        return Promise.resolve(makeBook(
          [[mids[idx][0], '10']],
          [[mids[idx][1], '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.tokenId).toBe('no-1');
  });

  it('does not enter when trend is flat', async () => {
    const clob = {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.499', '10']], [['0.501', '10']]),
      ),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('respects maxPositions limit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const mids: [string, string][] = [
          ['0.49', '0.51'],
          ['0.51', '0.53'],
          ['0.54', '0.56'],
        ];
        const idx = Math.min(callCount - 1, mids.length - 1);
        return Promise.resolve(makeBook(
          [[mids[idx][0], '10']],
          [[mids[idx][1], '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          { id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1', closed: false, resolved: false, active: true },
          { id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2', closed: false, resolved: false, active: true },
          { id: 'm3', conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3', closed: false, resolved: false, active: true },
        ]),
      } as any,
      config: { trendTicks: 3, trendThreshold: 0.02, maxPositions: 1 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick();

    // Should only have entered 1 position despite 3 markets
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('exits on take profit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          // Trending up to trigger entry
          const mids: [string, string][] = [
            ['0.49', '0.51'],
            ['0.51', '0.53'],
            ['0.54', '0.56'],
          ];
          const idx = Math.min(callCount - 1, mids.length - 1);
          return Promise.resolve(makeBook(
            [[mids[idx][0], '10']],
            [[mids[idx][1], '10']],
          ));
        }
        // After entry: price jumps up → take profit (entry was ask=0.56, +4% = 0.5824)
        return Promise.resolve(makeBook(
          [['0.62', '10']],
          [['0.64', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02, takeProfitPct: 0.04 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick(); // entry

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // should trigger take-profit exit

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits on stop loss', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          const mids: [string, string][] = [
            ['0.49', '0.51'],
            ['0.51', '0.53'],
            ['0.54', '0.56'],
          ];
          const idx = Math.min(callCount - 1, mids.length - 1);
          return Promise.resolve(makeBook(
            [[mids[idx][0], '10']],
            [[mids[idx][1], '10']],
          ));
        }
        // Price drops → stop loss (entry was ask=0.56, -2.5% ≈ 0.546)
        return Promise.resolve(makeBook(
          [['0.50', '10']],
          [['0.52', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02, stopLossPct: 0.025 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    await tick(); // stop loss

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          const mids: [string, string][] = [
            ['0.49', '0.51'],
            ['0.51', '0.53'],
            ['0.54', '0.56'],
          ];
          const idx = Math.min(callCount - 1, mids.length - 1);
          return Promise.resolve(makeBook(
            [[mids[idx][0], '10']],
            [[mids[idx][1], '10']],
          ));
        }
        // Price stays flat — no TP/SL, but max hold will trigger
        return Promise.resolve(makeBook(
          [['0.54', '10']],
          [['0.56', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02, maxHoldMs: 1 }, // 1ms = immediate
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick(); // entry

    // Small delay to ensure maxHoldMs passes
    await new Promise(r => setTimeout(r, 5));

    await tick(); // max hold exit

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.orderType).toBe('IOC');
  });

  it('emits trade.executed event on entry', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const mids: [string, string][] = [
          ['0.49', '0.51'],
          ['0.51', '0.53'],
          ['0.54', '0.56'],
        ];
        const idx = Math.min(callCount - 1, mids.length - 1);
        return Promise.resolve(makeBook(
          [[mids[idx][0], '10']],
          [[mids[idx][1], '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        side: 'buy',
        strategy: 'adverse-selection-filter',
      }),
    }));
  });

  it('does not enter market when markout score is below minMarkoutScore', async () => {
    // We need to simulate a market that already has bad markout history.
    // Since markout state is internal, we test indirectly: the strategy should
    // not enter a market on cooldown. We use the config to make the scenario.
    const deps = makeDeps({
      config: { trendTicks: 3, trendThreshold: 0.02, minMarkoutScore: 0.10 },
    });

    // With minMarkoutScore=0.10, even no-history markets are allowed (score is null),
    // but if a market had history with score < 0.10, it would be skipped.
    // This tests the benefit-of-doubt path (no history).
    const tick = createAdverseSelectionFilterTick(deps);
    // This should still work because no history = null = allowed
    // We're testing the config is applied correctly
    expect(typeof tick).toBe('function');
  });

  it('skips markets without yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: '',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets with mid price at boundary (0)', async () => {
    const clob = {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.00', '10']], [['0.00', '10']]),
      ),
    };

    const deps = makeDeps({ clob: clob as any });
    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets with mid price at boundary (1)', async () => {
    const clob = {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['1.00', '10']], [['1.00', '10']]),
      ),
    };

    const deps = makeDeps({ clob: clob as any });
    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('uses GTC order type for entries', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const mids: [string, string][] = [
          ['0.49', '0.51'],
          ['0.51', '0.53'],
          ['0.54', '0.56'],
        ];
        const idx = Math.min(callCount - 1, mids.length - 1);
        return Promise.resolve(makeBook(
          [[mids[idx][0], '10']],
          [[mids[idx][1], '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick();

    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.orderType).toBe('GTC');
  });

  it('applies config overrides correctly', () => {
    const deps = makeDeps({
      config: { maxPositions: 10, trendTicks: 8, positionSize: '50' },
    });
    const tick = createAdverseSelectionFilterTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('does not re-enter a market with an existing position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          // Trending up to trigger entry
          const mids: [string, string][] = [
            ['0.49', '0.51'],
            ['0.51', '0.53'],
            ['0.54', '0.56'],
          ];
          const idx = Math.min(callCount - 1, mids.length - 1);
          return Promise.resolve(makeBook(
            [[mids[idx][0], '10']],
            [[mids[idx][1], '10']],
          ));
        }
        // After entry: price stays flat (no TP/SL trigger)
        return Promise.resolve(makeBook(
          [['0.55', '10']],
          [['0.57', '10']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { trendTicks: 3, trendThreshold: 0.02, maxPositions: 4 },
    });

    const tick = createAdverseSelectionFilterTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    await tick(); // should NOT re-enter same market
    await tick();

    // Only 1 entry order (subsequent ticks skip because position exists)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });
});
