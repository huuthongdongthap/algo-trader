import { describe, it, expect, vi } from 'vitest';
import {
  pairKey,
  calcCorrelation,
  calcSpreadZScore,
  calcSpreadMean,
  createPairsStatArbTick,
  type PairsStatArbDeps,
} from '../../src/strategies/polymarket/pairs-stat-arb.js';
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

function makeEvent(markets: Array<{ id: string; conditionId: string; yesTokenId: string; noTokenId?: string; closed?: boolean; resolved?: boolean }>) {
  return {
    id: 'evt-1',
    title: 'Test Event',
    slug: 'test-event',
    description: 'Test',
    markets: markets.map(m => ({
      id: m.id,
      question: `Market ${m.id}?`,
      slug: `market-${m.id}`,
      conditionId: m.conditionId,
      yesTokenId: m.yesTokenId,
      noTokenId: m.noTokenId ?? `no-${m.id}`,
      yesPrice: 0.50,
      noPrice: 0.50,
      volume: 1000,
      volume24h: 500,
      liquidity: 5000,
      endDate: '2026-12-31',
      active: true,
      closed: m.closed ?? false,
      resolved: m.resolved ?? false,
      outcome: null,
    })),
  };
}

// ── pairKey tests ───────────────────────────────────────────────────────────

describe('pairKey', () => {
  it('produces consistent key regardless of order', () => {
    expect(pairKey('token-a', 'token-b')).toBe(pairKey('token-b', 'token-a'));
  });

  it('sorts lexicographically', () => {
    expect(pairKey('b', 'a')).toBe('a:b');
  });
});

// ── calcCorrelation tests ───────────────────────────────────────────────────

describe('calcCorrelation', () => {
  it('returns 0 for < 3 data points', () => {
    expect(calcCorrelation([0.5], [0.5])).toBe(0);
    expect(calcCorrelation([0.5, 0.6], [0.5, 0.6])).toBe(0);
  });

  it('returns ~1 for perfectly correlated series', () => {
    const a = [0.3, 0.4, 0.5, 0.6, 0.7];
    const b = [0.3, 0.4, 0.5, 0.6, 0.7];
    expect(calcCorrelation(a, b)).toBeCloseTo(1.0);
  });

  it('returns ~-1 for perfectly inversely correlated series', () => {
    const a = [0.3, 0.4, 0.5, 0.6, 0.7];
    const b = [0.7, 0.6, 0.5, 0.4, 0.3];
    expect(calcCorrelation(a, b)).toBeCloseTo(-1.0);
  });

  it('returns ~0 for uncorrelated series', () => {
    const a = [0.5, 0.5, 0.5, 0.5, 0.5];
    const b = [0.3, 0.6, 0.4, 0.7, 0.2];
    expect(calcCorrelation(a, b)).toBeCloseTo(0);
  });

  it('handles different length arrays (uses shorter)', () => {
    const a = [0.3, 0.4, 0.5];
    const b = [0.3, 0.4, 0.5, 0.6, 0.7];
    expect(calcCorrelation(a, b)).toBeCloseTo(1.0);
  });
});

// ── calcSpreadZScore tests ──────────────────────────────────────────────────

describe('calcSpreadZScore', () => {
  it('returns 0 for < 3 values', () => {
    expect(calcSpreadZScore([])).toBe(0);
    expect(calcSpreadZScore([0.1, 0.2])).toBe(0);
  });

  it('returns 0 when all spreads equal', () => {
    expect(calcSpreadZScore([0.1, 0.1, 0.1, 0.1])).toBe(0);
  });

  it('returns positive when last spread > mean', () => {
    const spreads = [0.0, 0.0, 0.0, 0.0, 0.2];
    expect(calcSpreadZScore(spreads)).toBeGreaterThan(0);
  });

  it('returns negative when last spread < mean', () => {
    const spreads = [0.0, 0.0, 0.0, 0.0, -0.2];
    expect(calcSpreadZScore(spreads)).toBeLessThan(0);
  });

  it('returns high z for outlier', () => {
    const spreads = Array(19).fill(0);
    spreads.push(0.3);
    expect(calcSpreadZScore(spreads)).toBeGreaterThan(2);
  });
});

// ── calcSpreadMean tests ────────────────────────────────────────────────────

describe('calcSpreadMean', () => {
  it('returns 0 for empty array', () => {
    expect(calcSpreadMean([])).toBe(0);
  });

  it('computes mean correctly', () => {
    expect(calcSpreadMean([0.1, 0.2, 0.3])).toBeCloseTo(0.2);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<PairsStatArbDeps> = {}): PairsStatArbDeps {
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
      getEvents: vi.fn().mockResolvedValue([
        makeEvent([
          { id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1' },
          { id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2' },
        ]),
      ]),
    } as any,
    ...overrides,
  };
}

describe('createPairsStatArbTick', () => {
  it('returns a function', () => {
    const tick = createPairsStatArbTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient history)', async () => {
    const deps = makeDeps();
    const tick = createPairsStatArbTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createPairsStatArbTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createPairsStatArbTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips events with fewer than 2 active markets', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([{ id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1' }]),
        ]),
      } as any,
    });
    const tick = createPairsStatArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips closed markets within events', async () => {
    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockResolvedValue([
          makeEvent([
            { id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', closed: true },
            { id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', closed: true },
          ]),
        ]),
      } as any,
    });
    const tick = createPairsStatArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('places pair entry when spread z-score exceeds threshold with sufficient history', async () => {
    // Stable mid at ~0.50 for both markets
    const stableBook = makeBook(
      [['0.49', '100'], ['0.48', '80']],
      [['0.51', '100'], ['0.53', '80']],
    );

    // Market A spikes to 0.70, B stays at 0.50 → spread diverges
    const spikedBookA = makeBook(
      [['0.69', '100'], ['0.68', '80']],
      [['0.71', '100'], ['0.72', '80']],
    );

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        // After 24 ticks of history (2 calls per tick for 2 markets), spike A
        if (callCount > 48 && tokenId === 'yes-1') {
          return Promise.resolve(spikedBookA);
        }
        return Promise.resolve(stableBook);
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { lookbackPeriods: 25, zScoreThreshold: 2.0, minCorrelation: 0.0 },
    });
    const tick = createPairsStatArbTick(deps);

    // Build 25 ticks of history
    for (let i = 0; i < 25; i++) {
      await tick();
    }

    // 26th tick should detect divergence
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
  });

  it('does not enter when correlation is below threshold', async () => {
    // Markets with random, uncorrelated prices
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
        callCount++;
        // Random-ish prices for A, stable for B → low correlation
        if (tokenId === 'yes-1') {
          const prices = [0.30, 0.70, 0.40, 0.60, 0.35, 0.65, 0.45, 0.55, 0.50, 0.50,
            0.30, 0.70, 0.40, 0.60, 0.35, 0.65, 0.45, 0.55, 0.50, 0.50,
            0.30, 0.70, 0.40, 0.60, 0.35, 0.65, 0.45, 0.55, 0.50, 0.80];
          const idx = Math.min(Math.floor(callCount / 2), prices.length - 1);
          const p = prices[idx];
          return Promise.resolve(makeBook(
            [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.49', '100']], [['0.51', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: { lookbackPeriods: 25, zScoreThreshold: 2.0, minCorrelation: 0.9 },
    });
    const tick = createPairsStatArbTick(deps);

    for (let i = 0; i < 30; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
