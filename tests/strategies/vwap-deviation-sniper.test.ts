import { describe, it, expect, vi } from 'vitest';
import {
  calcVWAP,
  calcDeviation,
  detectVolumeSpike,
  calcAdaptiveThreshold,
  extractBookVolume,
  createVwapDeviationSniperTick,
  type VwapTick,
  type VwapDeviationDeps,
} from '../../src/strategies/polymarket/vwap-deviation-sniper.js';
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

function makeTicks(prices: number[], volumes: number[]): VwapTick[] {
  return prices.map((p, i) => ({ price: p, volume: volumes[i] ?? 100, timestamp: Date.now() + i }));
}

// ── calcVWAP tests ──────────────────────────────────────────────────────────

describe('calcVWAP', () => {
  it('returns 0 for empty array', () => {
    expect(calcVWAP([])).toBe(0);
  });

  it('returns price for single tick', () => {
    expect(calcVWAP([{ price: 0.55, volume: 100, timestamp: 0 }])).toBe(0.55);
  });

  it('correctly weights by volume', () => {
    const ticks: VwapTick[] = [
      { price: 0.40, volume: 100, timestamp: 0 },
      { price: 0.60, volume: 300, timestamp: 1 },
    ];
    // (0.40*100 + 0.60*300) / (100+300) = (40+180)/400 = 0.55
    expect(calcVWAP(ticks)).toBeCloseTo(0.55);
  });

  it('returns 0 when all volumes are zero', () => {
    const ticks: VwapTick[] = [
      { price: 0.50, volume: 0, timestamp: 0 },
      { price: 0.60, volume: 0, timestamp: 1 },
    ];
    expect(calcVWAP(ticks)).toBe(0);
  });
});

// ── calcDeviation tests ─────────────────────────────────────────────────────

describe('calcDeviation', () => {
  it('returns 0 when vwap is 0', () => {
    expect(calcDeviation(0.50, 0)).toBe(0);
  });

  it('returns negative when price < vwap', () => {
    const dev = calcDeviation(0.45, 0.50);
    expect(dev).toBeCloseTo(-0.10);
  });

  it('returns positive when price > vwap', () => {
    const dev = calcDeviation(0.55, 0.50);
    expect(dev).toBeCloseTo(0.10);
  });

  it('returns 0 when price equals vwap', () => {
    expect(calcDeviation(0.50, 0.50)).toBe(0);
  });
});

// ── detectVolumeSpike tests ─────────────────────────────────────────────────

describe('detectVolumeSpike', () => {
  it('returns false for empty tick history', () => {
    expect(detectVolumeSpike(500, [], 2.0)).toBe(false);
  });

  it('returns false when volume below threshold', () => {
    const ticks = makeTicks([0.50, 0.50, 0.50], [100, 100, 100]);
    // avg=100, current=150, need > 200
    expect(detectVolumeSpike(150, ticks, 2.0)).toBe(false);
  });

  it('returns true when volume exceeds threshold', () => {
    const ticks = makeTicks([0.50, 0.50, 0.50], [100, 100, 100]);
    // avg=100, current=250, need > 200
    expect(detectVolumeSpike(250, ticks, 2.0)).toBe(true);
  });

  it('handles single tick history', () => {
    const ticks = makeTicks([0.50], [100]);
    expect(detectVolumeSpike(250, ticks, 2.0)).toBe(true);
    expect(detectVolumeSpike(150, ticks, 2.0)).toBe(false);
  });
});

// ── calcAdaptiveThreshold tests ─────────────────────────────────────────────

describe('calcAdaptiveThreshold', () => {
  it('returns base threshold for < 2 ticks', () => {
    expect(calcAdaptiveThreshold([], 0.03, 1.5)).toBe(0.03);
    expect(calcAdaptiveThreshold(makeTicks([0.50], [100]), 0.03, 1.5)).toBe(0.03);
  });

  it('returns base threshold when all prices equal (zero stdDev)', () => {
    const ticks = makeTicks([0.50, 0.50, 0.50, 0.50], [100, 100, 100, 100]);
    expect(calcAdaptiveThreshold(ticks, 0.03, 1.5)).toBe(0.03);
  });

  it('returns higher threshold for volatile prices', () => {
    const ticks = makeTicks([0.30, 0.70, 0.30, 0.70], [100, 100, 100, 100]);
    const threshold = calcAdaptiveThreshold(ticks, 0.03, 1.5);
    expect(threshold).toBeGreaterThan(0.03);
  });
});

// ── extractBookVolume tests ─────────────────────────────────────────────────

describe('extractBookVolume', () => {
  it('returns 0 for empty book', () => {
    expect(extractBookVolume(makeBook([], []))).toBe(0);
  });

  it('sums all bid and ask sizes', () => {
    const book = makeBook(
      [['0.49', '100'], ['0.48', '200']],
      [['0.51', '150'], ['0.52', '50']],
    );
    expect(extractBookVolume(book)).toBe(500);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<VwapDeviationDeps> = {}): VwapDeviationDeps {
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

describe('createVwapDeviationSniperTick', () => {
  it('returns a function', () => {
    const tick = createVwapDeviationSniperTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient history)', async () => {
    const deps = makeDeps();
    const tick = createVwapDeviationSniperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createVwapDeviationSniperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createVwapDeviationSniperTick(deps);
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
    const tick = createVwapDeviationSniperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('places BUY YES entry when price drops below VWAP with volume spike', async () => {
    // Stable orderbook at mid=0.50 with normal volume (~600 total)
    const stableBook = makeBook(
      [['0.49', '100'], ['0.48', '80'], ['0.47', '60'], ['0.46', '40'], ['0.45', '20']],
      [['0.51', '100'], ['0.53', '80'], ['0.54', '60'], ['0.55', '40'], ['0.56', '20']],
    );

    // Depressed price book: mid=0.415, high volume (~3000 total = spike)
    const depressedBook = makeBook(
      [['0.41', '500'], ['0.40', '400'], ['0.39', '300'], ['0.38', '200'], ['0.37', '100']],
      [['0.42', '500'], ['0.43', '400'], ['0.44', '300'], ['0.45', '200'], ['0.46', '100']],
    );

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 29) return Promise.resolve(stableBook);
        return Promise.resolve(depressedBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { vwapWindowSize: 30, deviationThreshold: 0.03, volumeSpikeMultiplier: 2.0, volatilityAdaptive: false },
    });
    const tick = createVwapDeviationSniperTick(deps);

    // Build 30 ticks of history
    for (let i = 0; i < 30; i++) {
      await tick();
    }

    // 31st tick should detect signal
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('does not enter without volume spike', async () => {
    // Price drops but volume stays normal
    const stableBook = makeBook(
      [['0.49', '100'], ['0.48', '80']],
      [['0.51', '100'], ['0.53', '80']],
    );
    const lowVolDropBook = makeBook(
      [['0.41', '50'], ['0.40', '40']],
      [['0.42', '50'], ['0.43', '40']],
    );

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 29) return Promise.resolve(stableBook);
        return Promise.resolve(lowVolDropBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { vwapWindowSize: 30, deviationThreshold: 0.03, volumeSpikeMultiplier: 2.0, volatilityAdaptive: false },
    });
    const tick = createVwapDeviationSniperTick(deps);

    for (let i = 0; i < 31; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
