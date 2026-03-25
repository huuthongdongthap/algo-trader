import { describe, it, expect, vi } from 'vitest';
import {
  calcRSI,
  calcMomentum,
  calcOBI,
  calcZScore,
  detectPullback,
  getRegimeParams,
  createRegimeAdaptiveMomentumTick,
  type RegimeAdaptiveDeps,
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

// ── calcRSI tests ───────────────────────────────────────────────────────────

describe('calcRSI', () => {
  it('returns 50 for insufficient data', () => {
    expect(calcRSI([0.5], 7)).toBe(50);
    expect(calcRSI([], 7)).toBe(50);
  });

  it('returns 100 when all moves are up', () => {
    const prices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47, 0.48];
    expect(calcRSI(prices, 7)).toBe(100);
  });

  it('returns 0 when all moves are down', () => {
    const prices = [0.48, 0.47, 0.46, 0.45, 0.44, 0.43, 0.42, 0.41, 0.40];
    expect(calcRSI(prices, 7)).toBe(0);
  });

  it('returns ~50 for alternating moves', () => {
    const prices = [0.50, 0.52, 0.50, 0.52, 0.50, 0.52, 0.50, 0.52, 0.50];
    const rsi = calcRSI(prices, 7);
    expect(rsi).toBeGreaterThan(30);
    expect(rsi).toBeLessThan(70);
  });
});

// ── calcMomentum tests ──────────────────────────────────────────────────────

describe('calcMomentum', () => {
  it('returns 0 for insufficient data', () => {
    expect(calcMomentum([0.5], 5)).toBe(0);
  });

  it('returns positive for rising prices', () => {
    const prices = [0.40, 0.42, 0.44, 0.46, 0.48, 0.50];
    expect(calcMomentum(prices, 5)).toBeGreaterThan(0);
  });

  it('returns negative for falling prices', () => {
    const prices = [0.60, 0.58, 0.56, 0.54, 0.52, 0.50];
    expect(calcMomentum(prices, 5)).toBeLessThan(0);
  });

  it('returns 0 for flat prices', () => {
    const prices = [0.50, 0.50, 0.50, 0.50, 0.50, 0.50];
    expect(calcMomentum(prices, 5)).toBe(0);
  });
});

// ── calcOBI tests ───────────────────────────────────────────────────────────

describe('calcOBI', () => {
  it('returns 0 for empty book', () => {
    expect(calcOBI(makeBook([], []), 5)).toBe(0);
  });

  it('returns positive when bids > asks', () => {
    const book = makeBook([['0.49', '200']], [['0.51', '50']]);
    expect(calcOBI(book, 5)).toBeGreaterThan(0);
  });

  it('returns 0 for balanced book', () => {
    const book = makeBook([['0.49', '100']], [['0.51', '100']]);
    expect(calcOBI(book, 5)).toBe(0);
  });
});

// ── calcZScore tests ────────────────────────────────────────────────────────

describe('calcZScore', () => {
  it('returns 0 for < 3 prices', () => {
    expect(calcZScore([])).toBe(0);
    expect(calcZScore([0.5, 0.5])).toBe(0);
  });

  it('returns positive when last price > mean', () => {
    expect(calcZScore([0.40, 0.40, 0.40, 0.60])).toBeGreaterThan(0);
  });

  it('returns negative when last price < mean', () => {
    expect(calcZScore([0.60, 0.60, 0.60, 0.40])).toBeLessThan(0);
  });
});

// ── detectPullback tests ────────────────────────────────────────────────────

describe('detectPullback', () => {
  it('detects bullish pullback (uptrend + oversold RSI)', () => {
    expect(detectPullback(30, 0.05, 35, 65, 0.02)).toBe('bullish-pullback');
  });

  it('detects bearish pullback (downtrend + overbought RSI)', () => {
    expect(detectPullback(70, -0.05, 35, 65, 0.02)).toBe('bearish-pullback');
  });

  it('returns none when no pullback conditions met', () => {
    expect(detectPullback(50, 0.05, 35, 65, 0.02)).toBe('none'); // RSI neutral
    expect(detectPullback(30, 0.01, 35, 65, 0.02)).toBe('none'); // momentum too weak
  });
});

// ── getRegimeParams tests ───────────────────────────────────────────────────

describe('getRegimeParams', () => {
  it('scales up in trending regime', () => {
    const params = getRegimeParams('trending-up', 0.03, 0.02);
    expect(params.sizeMultiplier).toBe(1.2);
    expect(params.takeProfitPct).toBeGreaterThan(0.03);
  });

  it('scales down in ranging regime', () => {
    const params = getRegimeParams('ranging', 0.03, 0.02);
    expect(params.sizeMultiplier).toBe(0.9);
    expect(params.takeProfitPct).toBeLessThan(0.03);
  });

  it('reduces size in volatile regime', () => {
    const params = getRegimeParams('volatile', 0.03, 0.02);
    expect(params.sizeMultiplier).toBe(0.5);
  });

  it('returns 0 size for unknown regime', () => {
    const params = getRegimeParams('unknown', 0.03, 0.02);
    expect(params.sizeMultiplier).toBe(0);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<RegimeAdaptiveDeps> = {}): RegimeAdaptiveDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '100'], ['0.47', '80']],
          [['0.52', '100'], ['0.53', '80']],
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

describe('createRegimeAdaptiveMomentumTick', () => {
  it('returns a function', () => {
    const tick = createRegimeAdaptiveMomentumTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient history)', async () => {
    const deps = makeDeps();
    const tick = createRegimeAdaptiveMomentumTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createRegimeAdaptiveMomentumTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createRegimeAdaptiveMomentumTick(deps);
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
    const tick = createRegimeAdaptiveMomentumTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('enters on trending pullback after sufficient history', async () => {
    // Build uptrend then a gradual pullback that creates RSI < 35
    // Need: regime=trending-up, RSI oversold, m15 positive, m5 ≈ 0
    const trendPrices: number[] = [];
    // 30 up (0.20→0.49) + 3 drops + 8 flat → regime=trending-up, RSI≈63, m5≈0
    for (let i = 0; i < 30; i++) trendPrices.push(0.20 + i * 0.01);
    trendPrices.push(0.48, 0.47, 0.46); // pullback
    for (let i = 0; i < 8; i++) trendPrices.push(0.46); // stabilize m5

    let callIdx = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = trendPrices[Math.min(callIdx, trendPrices.length - 1)];
        callIdx++;
        return Promise.resolve(makeBook(
          [[String((p - 0.01).toFixed(4)), '100']],
          [[String((p + 0.01).toFixed(4)), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minPriceTicks: 30,
        rsiPeriod: 7,
        rsiOversold: 65,       // RSI ≈ 63 after pullback → below this
        rsiOverbought: 35,
        minTrendMomentum: 0.01,
      },
    });
    const tick = createRegimeAdaptiveMomentumTick(deps);

    for (let i = 0; i < 41; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('enters on ranging mean-reversion signal', async () => {
    // 32 oscillating prices (ADX ≈ 7) + 3 lower with heavy bid imbalance
    // This gives regime=ranging, z ≈ -2.94, and OBI > 0.3
    const heavyBidBook = makeBook(
      [['0.46', '500'], ['0.45', '400'], ['0.44', '300'], ['0.43', '200'], ['0.42', '100']],
      [['0.48', '30'], ['0.49', '20'], ['0.50', '10']],
    );

    let callIdx = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callIdx++;
        if (callIdx <= 32) {
          // Oscillate around 0.50 (ranging)
          const p = 0.50 + (callIdx % 2 === 0 ? 0.005 : -0.005);
          return Promise.resolve(makeBook(
            [[String((p - 0.01).toFixed(3)), '100']],
            [[String((p + 0.01).toFixed(3)), '100']],
          ));
        }
        return Promise.resolve(heavyBidBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        minPriceTicks: 30,
        obiThreshold: 0.3,
        zScoreThreshold: 1.0,
      },
    });
    const tick = createRegimeAdaptiveMomentumTick(deps);

    for (let i = 0; i < 36; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });
});
