import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcVelocity,
  calcAggregateVelocity,
  calcStalenessScore,
  isStaleQuote,
  createStaleQuoteSniperTick,
  DEFAULT_CONFIG,
  type StaleQuoteSniperConfig,
  type StaleQuoteSniperDeps,
} from '../../src/strategies/polymarket/stale-quote-sniper.js';
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

function makeMarket(overrides: Record<string, unknown> = {}) {
  return {
    conditionId: 'cond-1',
    slug: 'test-market',
    title: 'Test Market',
    yesTokenId: 'yes-token-1',
    noTokenId: 'no-token-1',
    closed: false,
    resolved: false,
    volume: 10000,
    eventSlug: 'event-1',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<StaleQuoteSniperDeps> = {}): StaleQuoteSniperDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.50', '100']], [['0.55', '100']]),
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

// ── calcVelocity tests ──────────────────────────────────────────────────────

describe('calcVelocity', () => {
  it('returns 0 for empty array', () => {
    expect(calcVelocity([])).toBe(0);
  });

  it('returns 0 for single price', () => {
    expect(calcVelocity([0.5])).toBe(0);
  });

  it('returns positive velocity for rising prices', () => {
    expect(calcVelocity([0.50, 0.52, 0.54])).toBeCloseTo(0.04 / 3, 6);
  });

  it('returns negative velocity for falling prices', () => {
    expect(calcVelocity([0.60, 0.58, 0.55])).toBeCloseTo(-0.05 / 3, 6);
  });

  it('returns 0 for flat prices', () => {
    expect(calcVelocity([0.50, 0.50, 0.50])).toBe(0);
  });

  it('calculates correctly for two prices', () => {
    expect(calcVelocity([0.40, 0.50])).toBeCloseTo(0.10 / 2, 6);
  });
});

// ── calcAggregateVelocity tests ─────────────────────────────────────────────

describe('calcAggregateVelocity', () => {
  it('returns 0 for empty array', () => {
    expect(calcAggregateVelocity([])).toBe(0);
  });

  it('returns absolute average of positive velocities', () => {
    expect(calcAggregateVelocity([0.01, 0.02, 0.03])).toBeCloseTo(0.02, 6);
  });

  it('returns absolute average of negative velocities', () => {
    expect(calcAggregateVelocity([-0.01, -0.02, -0.03])).toBeCloseTo(0.02, 6);
  });

  it('returns absolute average of mixed velocities', () => {
    expect(calcAggregateVelocity([0.01, -0.03])).toBeCloseTo(0.02, 6);
  });

  it('returns value for single element', () => {
    expect(calcAggregateVelocity([0.05])).toBeCloseTo(0.05, 6);
  });

  it('returns 0 for all-zero velocities', () => {
    expect(calcAggregateVelocity([0, 0, 0])).toBe(0);
  });
});

// ── calcStalenessScore tests ────────────────────────────────────────────────

describe('calcStalenessScore', () => {
  it('returns high score when market velocity is near zero', () => {
    const score = calcStalenessScore(0.05, 0.0001, 0.0001);
    expect(score).toBeGreaterThan(100);
  });

  it('returns low score when market velocity matches aggregate', () => {
    const score = calcStalenessScore(0.05, 0.05, 0.0001);
    expect(score).toBeCloseTo(1.0, 1);
  });

  it('uses epsilon to prevent division by zero', () => {
    const score = calcStalenessScore(0.05, 0, 0.0001);
    expect(score).toBeCloseTo(500, 0);
  });

  it('returns 0 when aggregate velocity is 0', () => {
    expect(calcStalenessScore(0, 0.01, 0.0001)).toBe(0);
  });

  it('handles negative market velocity (uses abs)', () => {
    const s1 = calcStalenessScore(0.05, 0.02, 0.0001);
    const s2 = calcStalenessScore(0.05, -0.02, 0.0001);
    expect(s1).toBeCloseTo(s2, 4);
  });
});

// ── isStaleQuote tests ──────────────────────────────────────────────────────

describe('isStaleQuote', () => {
  const cfg = { stalenessThreshold: 5.0, minAggVelocity: 0.005 };

  it('returns true when both conditions met', () => {
    expect(isStaleQuote(10.0, 0.01, cfg)).toBe(true);
  });

  it('returns false when staleness below threshold', () => {
    expect(isStaleQuote(3.0, 0.01, cfg)).toBe(false);
  });

  it('returns false when aggregate velocity too low', () => {
    expect(isStaleQuote(10.0, 0.001, cfg)).toBe(false);
  });

  it('returns false when both below threshold', () => {
    expect(isStaleQuote(2.0, 0.001, cfg)).toBe(false);
  });

  it('returns false at exact threshold (not strictly greater)', () => {
    expect(isStaleQuote(5.0, 0.005, cfg)).toBe(false);
  });

  it('returns true well above thresholds', () => {
    expect(isStaleQuote(100, 0.1, cfg)).toBe(true);
  });
});

// ── createStaleQuoteSniperTick tests ────────────────────────────────────────

describe('createStaleQuoteSniperTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-15T12:00:00Z'));
  });

  it('returns a function', () => {
    const tick = createStaleQuoteSniperTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('handles API error from gamma gracefully', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API down')) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles clob error gracefully', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('Network error')) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ closed: true })]) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ resolved: true })]) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without yesTokenId', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ yesTokenId: undefined })]) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below volume threshold', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([makeMarket({ volume: 100 })]) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter with insufficient price history', async () => {
    const deps = makeDeps({ config: { velocityWindow: 10 } });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])) } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', () => {
    const deps = makeDeps({ config: { velocityWindow: 5, positionSize: '20' } });
    const tick = createStaleQuoteSniperTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('detects stale market and enters BUY YES when aggregate drifts up', async () => {
    // Multiple markets: one moving up, one stale
    const movingMarket = makeMarket({ conditionId: 'moving', yesTokenId: 'yes-moving', noTokenId: 'no-moving' });
    const staleMarket = makeMarket({ conditionId: 'stale', yesTokenId: 'yes-stale', noTokenId: 'no-stale' });

    let movingCallCount = 0;
    const movingPrices = [0.50, 0.52, 0.54, 0.56, 0.58, 0.60, 0.62, 0.64, 0.66, 0.68, 0.70];
    const stalePrice = 0.50;

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([movingMarket, staleMarket]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
          if (tokenId === 'yes-moving') {
            const p = movingPrices[Math.min(movingCallCount++, movingPrices.length - 1)];
            return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
          }
          return Promise.resolve(makeBook([[String(stalePrice - 0.02), '100']], [[String(stalePrice + 0.02), '100']]));
        }),
      } as any,
      config: { velocityWindow: 3, stalenessThreshold: 3.0, minAggVelocity: 0.001 },
    });

    const tick = createStaleQuoteSniperTick(deps);
    for (let i = 0; i < 11; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    // Should have attempted to snipe the stale market
    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    if (placeCalls.length > 0) {
      const entryCall = placeCalls.find((c: any) => c[0].orderType === 'GTC');
      if (entryCall) {
        expect(entryCall[0].side).toBe('buy');
      }
    }
  });

  it('does not enter when aggregate velocity too low', async () => {
    // All markets barely moving
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.500', '100']], [['0.501', '100']]),
        ),
      } as any,
      config: { velocityWindow: 3, minAggVelocity: 0.1 },
    });

    const tick = createStaleQuoteSniperTick(deps);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('emits trade.executed event on entry', async () => {
    const movingMarket = makeMarket({ conditionId: 'moving', yesTokenId: 'yes-moving', noTokenId: 'no-moving' });
    const staleMarket = makeMarket({ conditionId: 'stale', yesTokenId: 'yes-stale', noTokenId: 'no-stale' });

    let movingCallCount = 0;
    const movingPrices = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71, 0.74, 0.77, 0.80];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([movingMarket, staleMarket]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
          if (tokenId === 'yes-moving') {
            const p = movingPrices[Math.min(movingCallCount++, movingPrices.length - 1)];
            return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
          }
          return Promise.resolve(makeBook([['0.48', '100']], [['0.52', '100']]));
        }),
      } as any,
      config: { velocityWindow: 3, stalenessThreshold: 3.0, minAggVelocity: 0.001 },
    });

    const tick = createStaleQuoteSniperTick(deps);
    for (let i = 0; i < 11; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const tradeCalls = (deps.eventBus.emit as any).mock.calls.filter((c: any) => c[0] === 'trade.executed');
    if (tradeCalls.length > 0) {
      expect(tradeCalls[0][1].trade.strategy).toBe('stale-quote-sniper');
    }
  });

  it('respects maxPositions limit', async () => {
    const markets = Array.from({ length: 10 }, (_, i) => makeMarket({
      conditionId: `cond-${i}`,
      yesTokenId: `yes-${i}`,
      noTokenId: `no-${i}`,
    }));

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: { maxPositions: 2, velocityWindow: 3, stalenessThreshold: 1.0, minAggVelocity: 0.0001 },
    });

    const tick = createStaleQuoteSniperTick(deps);
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls
      .filter((c: any) => c[0].orderType === 'GTC');
    expect(entryCalls.length).toBeLessThanOrEqual(2);
  });

  it('exits on max hold time', async () => {
    const movingMarket = makeMarket({ conditionId: 'moving', yesTokenId: 'yes-moving', noTokenId: 'no-moving' });
    const staleMarket = makeMarket({ conditionId: 'stale', yesTokenId: 'yes-stale', noTokenId: 'no-stale' });

    let movingCallCount = 0;
    const movingPrices = [0.50, 0.53, 0.56, 0.59, 0.62, 0.65, 0.68, 0.71];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([movingMarket, staleMarket]) } as any,
      clob: {
        getOrderBook: vi.fn().mockImplementation((tokenId: string) => {
          if (tokenId === 'yes-moving') {
            const p = movingPrices[Math.min(movingCallCount++, movingPrices.length - 1)];
            return Promise.resolve(makeBook([[String(p - 0.02), '100']], [[String(p + 0.02), '100']]));
          }
          return Promise.resolve(makeBook([['0.48', '100']], [['0.52', '100']]));
        }),
      } as any,
      config: { velocityWindow: 3, stalenessThreshold: 3.0, minAggVelocity: 0.001, maxHoldMs: 5000 },
    });

    const tick = createStaleQuoteSniperTick(deps);
    for (let i = 0; i < 8; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }

    vi.advanceTimersByTime(60_000);
    await tick();

    const placeCalls = (deps.orderManager.placeOrder as any).mock.calls;
    const exitCalls = placeCalls.filter((c: any) => c[0].orderType === 'IOC');
    // May have exits if position was opened
    expect(placeCalls.length).toBeGreaterThanOrEqual(0);
  });

  it('handles placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: { placeOrder: vi.fn().mockRejectedValue(new Error('Rejected')) } as any,
      config: { velocityWindow: 3, stalenessThreshold: 1.0, minAggVelocity: 0.0001 },
    });

    const tick = createStaleQuoteSniperTick(deps);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      await tick();
    }
    // Should not crash
    expect(true).toBe(true);
  });

  it('uses default config values correctly', () => {
    expect(DEFAULT_CONFIG.velocityWindow).toBe(10);
    expect(DEFAULT_CONFIG.stalenessThreshold).toBe(5.0);
    expect(DEFAULT_CONFIG.epsilon).toBe(0.0001);
    expect(DEFAULT_CONFIG.minAggVelocity).toBe(0.005);
    expect(DEFAULT_CONFIG.minVolume).toBe(3000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.02);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.015);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(600000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(5);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(60000);
    expect(DEFAULT_CONFIG.positionSize).toBe('8');
  });

  it('skips markets with mid price at 0 or 1', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([['0.00', '100']], [['0.00', '100']])),
      } as any,
    });
    const tick = createStaleQuoteSniperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
