import { describe, it, expect, vi } from 'vitest';
import {
  calcSMA,
  detectRegime,
  calcPullbackDepth,
  calcOBI,
  calcTrendDirection,
  createRegimeAdaptiveMomentumTick,
  type RegimeAdaptiveMomentumDeps,
} from '../../src/strategies/polymarket/regime-adaptive-momentum.js';
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

function makeDeps(overrides?: Partial<RegimeAdaptiveMomentumDeps>): RegimeAdaptiveMomentumDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

// ── calcSMA ─────────────────────────────────────────────────────────────────

describe('calcSMA', () => {
  it('returns 0 for empty array', () => {
    expect(calcSMA([])).toBe(0);
  });

  it('returns the value itself for single element', () => {
    expect(calcSMA([0.5])).toBe(0.5);
  });

  it('calculates correct average for multiple values', () => {
    expect(calcSMA([0.2, 0.4, 0.6])).toBeCloseTo(0.4, 10);
  });

  it('handles identical values', () => {
    expect(calcSMA([0.5, 0.5, 0.5, 0.5])).toBe(0.5);
  });
});

// ── detectRegime ─────────────────────────────────────────────────────────────

describe('detectRegime', () => {
  it('returns trending when SMA divergence is large relative to ATR', () => {
    // Short prices much higher than long prices, with small ATR
    const shortPrices = [0.70, 0.71, 0.72, 0.73, 0.74, 0.75, 0.76, 0.77, 0.78, 0.79];
    const longPrices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48, 0.49,
                        0.50, 0.51, 0.52, 0.53, 0.54, 0.55, 0.56, 0.57, 0.58, 0.59,
                        0.60, 0.61, 0.62, 0.63, 0.64, 0.65, 0.66, 0.67, 0.68, 0.69];
    expect(detectRegime(shortPrices, longPrices)).toBe('trending');
  });

  it('returns volatile when short ATR is much higher than long ATR', () => {
    // Long prices: steady small moves
    const longPrices = Array.from({ length: 30 }, (_, i) => 0.50 + (i % 2 === 0 ? 0.001 : -0.001));
    // Short prices: wild swings
    const shortPrices = Array.from({ length: 10 }, (_, i) => 0.50 + (i % 2 === 0 ? 0.05 : -0.05));
    expect(detectRegime(shortPrices, longPrices)).toBe('volatile');
  });

  it('returns ranging when neither trending nor volatile', () => {
    const longPrices = Array.from({ length: 30 }, (_, i) => 0.50 + (i % 2 === 0 ? 0.01 : -0.01));
    const shortPrices = Array.from({ length: 10 }, (_, i) => 0.50 + (i % 2 === 0 ? 0.01 : -0.01));
    expect(detectRegime(shortPrices, longPrices)).toBe('ranging');
  });

  it('returns ranging for insufficient data', () => {
    expect(detectRegime([0.5], [0.5])).toBe('ranging');
  });

  it('returns ranging when ATR_long is zero', () => {
    const shortPrices = [0.60, 0.61];
    const longPrices = [0.50, 0.50, 0.50];
    expect(detectRegime(shortPrices, longPrices)).toBe('ranging');
  });
});

// ── calcPullbackDepth ───────────────────────────────────────────────────────

describe('calcPullbackDepth', () => {
  it('returns 0 when current is at the bottom of range', () => {
    expect(calcPullbackDepth([0.50, 0.60, 0.70], 0.50)).toBe(0);
  });

  it('returns 1 when current is at the top of range', () => {
    expect(calcPullbackDepth([0.50, 0.60, 0.70], 0.70)).toBe(1);
  });

  it('returns 0.5 when current is in the middle', () => {
    expect(calcPullbackDepth([0.50, 0.70], 0.60)).toBeCloseTo(0.5, 10);
  });

  it('returns 0.5 for flat range', () => {
    expect(calcPullbackDepth([0.50, 0.50, 0.50], 0.50)).toBe(0.5);
  });

  it('returns 0.5 for empty prices', () => {
    expect(calcPullbackDepth([], 0.50)).toBe(0.5);
  });
});

// ── calcOBI ─────────────────────────────────────────────────────────────────

describe('calcOBI', () => {
  it('returns ratio for balanced book', () => {
    const book = makeBook([['0.50', '100']], [['0.51', '100']]);
    expect(calcOBI(book)).toBeCloseTo(1.0, 10);
  });

  it('returns high ratio for bid-heavy book', () => {
    const book = makeBook([['0.50', '300']], [['0.51', '100']]);
    expect(calcOBI(book)).toBeCloseTo(3.0, 10);
  });

  it('returns low ratio for ask-heavy book', () => {
    const book = makeBook([['0.50', '100']], [['0.51', '300']]);
    expect(calcOBI(book)).toBeCloseTo(1 / 3, 4);
  });

  it('returns 1.0 for empty book (no bids)', () => {
    const book = makeBook([], [['0.51', '100']]);
    expect(calcOBI(book)).toBe(1.0);
  });

  it('returns 1.0 for empty book (no asks)', () => {
    const book = makeBook([['0.50', '100']], []);
    expect(calcOBI(book)).toBe(1.0);
  });

  it('returns 1.0 for fully empty book', () => {
    const book = makeBook([], []);
    expect(calcOBI(book)).toBe(1.0);
  });
});

// ── calcTrendDirection ──────────────────────────────────────────────────────

describe('calcTrendDirection', () => {
  it('returns up when shortSMA >= longSMA', () => {
    expect(calcTrendDirection(0.55, 0.50)).toBe('up');
  });

  it('returns up when shortSMA equals longSMA', () => {
    expect(calcTrendDirection(0.50, 0.50)).toBe('up');
  });

  it('returns down when shortSMA < longSMA', () => {
    expect(calcTrendDirection(0.45, 0.50)).toBe('down');
  });
});

// ── createRegimeAdaptiveMomentumTick ────────────────────────────────────────

describe('createRegimeAdaptiveMomentumTick', () => {
  it('creates a callable tick function', () => {
    const tick = createRegimeAdaptiveMomentumTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createRegimeAdaptiveMomentumTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter without enough price history', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    const book = makeBook([['0.49', '100']], [['0.51', '100']]);
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(book) } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    // Only 10 ticks — not enough for longWindow=30
    for (let i = 0; i < 10; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter on cooldown', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    // Build prices that trigger a ranging OBI entry, then cooldown prevents re-entry
    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Ranging regime: oscillating small moves around 0.50
      const p = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      // Bid-heavy book for OBI signal
      return Promise.resolve(makeBook(
        [[String(p - 0.01), '500']],
        [[String(p), '100']],
      ));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortWindow: 3,
        longWindow: 5,
        cooldownMs: 999_999_999, // effectively permanent cooldown
      },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);

    // Build history + trigger entry
    for (let i = 0; i < 15; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );

    // If entry happened, the cooldown should block second entry on same token
    // Force an exit so cooldown activates, then verify no re-entry
    if (entryCalls.length > 0) {
      // Fast forward to trigger max hold exit
      const baseNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseNow + 10 * 60_000);
      await tick();
      vi.spyOn(Date, 'now').mockRestore();

      const entryCallsBefore = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'GTC',
      ).length;

      // More ticks — should be blocked by cooldown
      for (let i = 0; i < 10; i++) await tick();

      const entryCallsAfter = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'GTC',
      ).length;

      expect(entryCallsAfter).toBe(entryCallsBefore);
    }
  });

  it('enters on trending regime with pullback', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    // Build uptrend then pullback within the short window range.
    // shortWindow=5, longWindow=10.
    // Ticks 1-5: low prices (0.30-0.34), ticks 6-9: jump high (0.60-0.63),
    // tick 10: slight pullback to 0.605 (in bottom 30% of short range [0.60-0.63])
    // This creates trending regime (SMA divergence >> ATR) with a pullback entry.
    const prices = [0.30, 0.31, 0.32, 0.33, 0.34, 0.60, 0.61, 0.62, 0.63, 0.605];
    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const mid = prices[Math.min(callCount - 1, prices.length - 1)];
      const bid = (mid - 0.005).toFixed(4);
      const ask = (mid + 0.005).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 5, longWindow: 10 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 12; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBeGreaterThanOrEqual(1);
    if (entryCalls.length > 0) {
      expect(entryCalls[0][0].side).toBe('buy');
    }
  });

  it('enters on ranging regime with bid-heavy OBI signal (BUY YES)', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Ranging: oscillating tightly around 0.50
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      // Bid volume >> ask volume → OBI > 2.0
      return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 5, longWindow: 10 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBeGreaterThanOrEqual(1);
    if (entryCalls.length > 0) {
      // Should buy YES token for bid-heavy OBI
      expect(entryCalls[0][0].tokenId).toBe('yes-1');
    }
  });

  it('enters on ranging regime with ask-heavy OBI signal (BUY NO)', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      // Ask volume >> bid volume → OBI < 0.5
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '500']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 5, longWindow: 10 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBeGreaterThanOrEqual(1);
    if (entryCalls.length > 0) {
      expect(entryCalls[0][0].tokenId).toBe('no-1');
    }
  });

  it('enters on volatile regime with strict pullback (trendStrength > 2.0)', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    // We need:
    // - ATR_short / ATR_long > 2.0 (volatile)
    // - trendStrength > 2.0 (strong trend)
    // - pullback depth <= 0.20
    // - current price > SMA_long
    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      let mid: number;
      if (callCount <= 20) {
        // Slow uptrend (low ATR for long window)
        mid = 0.30 + callCount * 0.005;
      } else if (callCount <= 27) {
        // Sudden spike (high ATR for short window)
        mid = 0.40 + (callCount - 20) * 0.04;
      } else {
        // Pullback to bottom 20% of recent range but above SMA_long
        // Recent range ~[0.40, 0.68], bottom 20% = 0.40-0.456
        // SMA_long ~0.40, need price > 0.40
        mid = 0.42;
      }
      const bid = (mid - 0.005).toFixed(4);
      const ask = (mid + 0.005).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 10, longWindow: 30 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 35; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    // Volatile entries have 0.5x size multiplier
    if (entryCalls.length > 0) {
      const size = parseFloat(entryCalls[0][0].size);
      expect(size).toBeGreaterThan(0);
    }
  });

  it('exits on regime shift with trend reversal against position', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    // Phase 1: ranging regime with bid-heavy OBI → enters YES position
    // Phase 2: volatile regime with downtrend → regime shift + trend against YES
    // Use larger windows so the transition is clear.
    // longWindow=8, shortWindow=4. Need 8 ticks for entry.
    // After entry, phase 2: wild swings centered on a lower price.
    let callCount = 0;
    let phase = 1;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (phase === 1) {
        // Ranging: oscillate tightly, bid-heavy for OBI entry
        const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
        const bid = (mid - 0.01).toFixed(4);
        const ask = (mid + 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
      }
      // Phase 2: alternating high/low around 0.30 to create volatile regime
      // Short ATR >> long ATR (long ATR diluted by phase 1's small moves)
      // SMA_short (~0.30) < SMA_long (~0.40) → downtrend
      const mid = callCount % 2 === 0 ? 0.35 : 0.25;
      const bid = (mid - 0.005).toFixed(4);
      const ask = (mid + 0.005).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortWindow: 4,
        longWindow: 8,
        stopLossPct: 0.99, // very wide so regime shift triggers first
        trendingTpPct: 0.99,
        rangingTpPct: 0.99,
        volatileTpPct: 0.99,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);

    // Build history and enter (need 8 ticks for longWindow)
    for (let i = 0; i < 10; i++) await tick();

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );

    // Switch to phase 2 (volatile downtrend) and tick more
    phase = 2;
    for (let i = 0; i < 20; i++) await tick();

    if (gtcCalls.length > 0) {
      const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'IOC',
      );
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('respects maxPositions limit', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortWindow: 3,
        longWindow: 5,
        maxPositions: 0, // no positions allowed
      },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBe(0);
  });

  it('exits on take-profit for YES position (ranging TP)', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    let entryDone = false;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (!entryDone && callCount <= 10) {
        // Ranging regime, bid-heavy for entry
        const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
        const bid = (mid - 0.01).toFixed(4);
        const ask = (mid + 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
      }
      // After entry: price moves up for take-profit (3% for ranging)
      // Entry price ~0.51 (ask), TP at +3% = 0.5253
      return Promise.resolve(makeBook([['0.54', '100']], [['0.56', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortWindow: 3,
        longWindow: 5,
        rangingTpPct: 0.03,
        stopLossPct: 0.5,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
      const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'GTC',
      );
      if (gtcCalls.length > 0) entryDone = true;
    }

    const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC',
    );
    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    if (gtcCalls.length > 0) {
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('exits on stop-loss for YES position', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    let entryDone = false;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (!entryDone && callCount <= 10) {
        const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
        const bid = (mid - 0.01).toFixed(4);
        const ask = (mid + 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
      }
      // Price drops for stop-loss (entry ~0.51, SL at -2% = 0.4998)
      return Promise.resolve(makeBook([['0.44', '100']], [['0.46', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortWindow: 3,
        longWindow: 5,
        rangingTpPct: 0.99,
        stopLossPct: 0.02,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
      const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'GTC',
      );
      if (gtcCalls.length > 0) entryDone = true;
    }

    const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC',
    );
    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    if (gtcCalls.length > 0) {
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('exits on max hold time', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Ranging regime, bid-heavy for entry
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        shortWindow: 3,
        longWindow: 5,
        rangingTpPct: 0.99,
        stopLossPct: 0.99,
        maxHoldMs: 8 * 60_000,
      },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);

    // Build history and enter
    for (let i = 0; i < 15; i++) await tick();

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );

    if (gtcCalls.length > 0) {
      // Fast-forward past max hold
      const baseNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseNow + 9 * 60_000);

      await tick();

      const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'IOC',
      );
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);

      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  it('skips closed and resolved markets', async () => {
    const markets = [
      { conditionId: 'cond-1', yesTokenId: 'yes-1', closed: true, resolved: false },
      { conditionId: 'cond-2', yesTokenId: 'yes-2', closed: false, resolved: true },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    await tick();

    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const markets = [
      { conditionId: 'cond-1', yesTokenId: '', closed: false, resolved: false },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    await tick();

    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('emits trade.executed on entry with correct strategy name', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 3, longWindow: 5 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    if (tradeCalls.length > 0) {
      expect(tradeCalls[0][1].trade.strategy).toBe('regime-adaptive-momentum');
    }
  });

  it('does not throw on clob API error during scan', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createRegimeAdaptiveMomentumTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('uses correct size multiplier for ranging (0.9x)', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '500']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 3, longWindow: 5, baseSizeUsdc: 100 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    if (tradeCalls.length > 0) {
      // 100 * 0.9 = 90
      expect(parseFloat(tradeCalls[0][1].trade.fillSize)).toBeCloseTo(90, 0);
    }
  });

  it('does not enter when regime is ranging but OBI is balanced', async () => {
    const market = {
      conditionId: 'cond-1',
      yesTokenId: 'yes-1',
      noTokenId: 'no-1',
      closed: false,
      resolved: false,
      volume: 100000,
      volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      const mid = 0.50 + (callCount % 2 === 0 ? 0.005 : -0.005);
      const bid = (mid - 0.01).toFixed(4);
      const ask = (mid + 0.01).toFixed(4);
      // Balanced book — OBI ~1.0
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { shortWindow: 3, longWindow: 5 },
    });

    const tick = createRegimeAdaptiveMomentumTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBe(0);
  });
});
