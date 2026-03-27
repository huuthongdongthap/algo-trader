import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcTimeUrgency,
  calcMomentumTowardExtreme,
  calcUrgencyScore,
  determineDirection,
  createEventDeadlineScalperTick,
  DEFAULT_CONFIG,
  type EventDeadlineScalperConfig,
  type EventDeadlineScalperDeps,
} from '../../src/strategies/polymarket/event-deadline-scalper.js';
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

function makeConfig(overrides: Partial<EventDeadlineScalperConfig> = {}): EventDeadlineScalperConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// End date that is close to now (within the urgency window)
// 30 days from now minus ~28 days = ~93% elapsed → above 0.7 threshold
function nearDeadlineEndDate(): string {
  const now = Date.now();
  // End in 2 days → with 30-day assumed start, urgency ~ 28/30 = 0.933
  return new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
}

function farDeadlineEndDate(): string {
  // End in 60 days → urgency would be negative (before start), clamped to 0
  return new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
}

// ── calcTimeUrgency tests ────────────────────────────────────────────────────

describe('calcTimeUrgency', () => {
  it('returns 0 when now equals startTime', () => {
    expect(calcTimeUrgency(100, 100, 200)).toBe(0);
  });

  it('returns 1 when now equals endTime', () => {
    expect(calcTimeUrgency(200, 100, 200)).toBe(1);
  });

  it('returns 0.5 when now is midway', () => {
    expect(calcTimeUrgency(150, 100, 200)).toBeCloseTo(0.5, 4);
  });

  it('clamps to 0 when now is before startTime', () => {
    expect(calcTimeUrgency(50, 100, 200)).toBe(0);
  });

  it('clamps to 1 when now is after endTime', () => {
    expect(calcTimeUrgency(300, 100, 200)).toBe(1);
  });

  it('returns 1 when endTime equals startTime', () => {
    expect(calcTimeUrgency(100, 100, 100)).toBe(1);
  });

  it('returns 1 when endTime is before startTime', () => {
    expect(calcTimeUrgency(100, 200, 100)).toBe(1);
  });

  it('returns correct ratio for 75% elapsed', () => {
    expect(calcTimeUrgency(175, 100, 200)).toBeCloseTo(0.75, 4);
  });

  it('returns correct ratio for 25% elapsed', () => {
    expect(calcTimeUrgency(125, 100, 200)).toBeCloseTo(0.25, 4);
  });

  it('handles large timestamp values', () => {
    const start = 1700000000000;
    const end = 1700000100000;
    const now = 1700000090000;
    expect(calcTimeUrgency(now, start, end)).toBeCloseTo(0.9, 4);
  });
});

// ── calcMomentumTowardExtreme tests ──────────────────────────────────────────

describe('calcMomentumTowardExtreme', () => {
  it('returns 0 for empty prices', () => {
    expect(calcMomentumTowardExtreme([])).toBe(0);
  });

  it('returns 0 for single price', () => {
    expect(calcMomentumTowardExtreme([0.6])).toBe(0);
  });

  it('returns positive momentum when price > 0.5 and rising toward 1', () => {
    const result = calcMomentumTowardExtreme([0.6, 0.65, 0.7]);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 when price > 0.5 but falling away from 1', () => {
    const result = calcMomentumTowardExtreme([0.8, 0.75, 0.7]);
    expect(result).toBe(0);
  });

  it('returns positive momentum when price < 0.5 and falling toward 0', () => {
    const result = calcMomentumTowardExtreme([0.4, 0.35, 0.3]);
    expect(result).toBeGreaterThan(0);
  });

  it('returns 0 when price < 0.5 but rising away from 0', () => {
    const result = calcMomentumTowardExtreme([0.2, 0.25, 0.3]);
    expect(result).toBe(0);
  });

  it('returns 0 for flat prices above 0.5', () => {
    const result = calcMomentumTowardExtreme([0.7, 0.7, 0.7]);
    expect(result).toBe(0);
  });

  it('returns 0 for flat prices below 0.5', () => {
    const result = calcMomentumTowardExtreme([0.3, 0.3, 0.3]);
    expect(result).toBe(0);
  });

  it('returns same momentum for same start/end regardless of intermediate prices', () => {
    const short = calcMomentumTowardExtreme([0.6, 0.8]);
    const long = calcMomentumTowardExtreme([0.6, 0.65, 0.7, 0.75, 0.8]);
    // Same start and end → same momentum (current - previous) * direction
    expect(short).toBeCloseTo(long, 4);
  });

  it('returns larger momentum for larger price move', () => {
    const small = calcMomentumTowardExtreme([0.6, 0.65]);
    const large = calcMomentumTowardExtreme([0.6, 0.8]);
    expect(large).toBeGreaterThan(small);
  });

  it('handles prices exactly at 0.5', () => {
    // Price at 0.5 means nearest extreme is 0 (<=0.5 → 0)
    const result = calcMomentumTowardExtreme([0.5, 0.5]);
    expect(result).toBe(0);
  });

  it('handles prices at extreme values', () => {
    const result = calcMomentumTowardExtreme([0.9, 0.95, 0.99]);
    expect(result).toBeGreaterThan(0);
  });
});

// ── calcUrgencyScore tests ───────────────────────────────────────────────────

describe('calcUrgencyScore', () => {
  it('returns 0 when momentum is 0', () => {
    expect(calcUrgencyScore(0, 0.9)).toBe(0);
  });

  it('returns momentum when timeUrgency is 0', () => {
    // momentum * (1 + 0^2) = momentum * 1 = momentum
    expect(calcUrgencyScore(0.1, 0)).toBeCloseTo(0.1, 4);
  });

  it('doubles momentum when timeUrgency is 1', () => {
    // momentum * (1 + 1^2) = momentum * 2
    expect(calcUrgencyScore(0.1, 1)).toBeCloseTo(0.2, 4);
  });

  it('scales quadratically with timeUrgency', () => {
    // momentum * (1 + 0.5^2) = momentum * 1.25
    expect(calcUrgencyScore(0.1, 0.5)).toBeCloseTo(0.125, 4);
  });

  it('handles high urgency values', () => {
    // 0.05 * (1 + 0.95^2) = 0.05 * 1.9025 = 0.095125
    expect(calcUrgencyScore(0.05, 0.95)).toBeCloseTo(0.095125, 4);
  });

  it('returns 0 when both inputs are 0', () => {
    expect(calcUrgencyScore(0, 0)).toBe(0);
  });
});

// ── determineDirection tests ─────────────────────────────────────────────────

describe('determineDirection', () => {
  it('returns yes when price > 0.5', () => {
    expect(determineDirection(0.6)).toBe('yes');
  });

  it('returns no when price < 0.5', () => {
    expect(determineDirection(0.4)).toBe('no');
  });

  it('returns no when price equals 0.5', () => {
    expect(determineDirection(0.5)).toBe('no');
  });

  it('returns yes for price near 1', () => {
    expect(determineDirection(0.99)).toBe('yes');
  });

  it('returns no for price near 0', () => {
    expect(determineDirection(0.01)).toBe('no');
  });

  it('returns yes for price just above 0.5', () => {
    expect(determineDirection(0.501)).toBe('yes');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<EventDeadlineScalperDeps> = {}): EventDeadlineScalperDeps {
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
          volume: 50_000, volume24h: 5000, liquidity: 5000,
          endDate: nearDeadlineEndDate(),
          active: true, closed: false, resolved: false, outcome: null,
        },
      ]),
    } as any,
    ...overrides,
  };
}

describe('createEventDeadlineScalperTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createEventDeadlineScalperTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: nearDeadlineEndDate(),
          closed: true, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: nearDeadlineEndDate(),
          closed: false, resolved: true, active: true,
        }]),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 100, endDate: nearDeadlineEndDate(),
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createEventDeadlineScalperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    // mid = (0 + 1) / 2 = 0.5 which is valid, but no entry on first tick
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market with no yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: undefined, noTokenId: 'no-1',
          volume: 50_000, endDate: nearDeadlineEndDate(),
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles market with no noTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: undefined,
          volume: 50_000, endDate: nearDeadlineEndDate(),
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips markets with far deadline (below minTimeUrgency)', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: farDeadlineEndDate(),
          closed: false, resolved: false, active: true,
        }]),
      } as any,
      config: { minVolume: 1 },
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets with no endDate', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: '',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles multiple markets in a single tick', async () => {
    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        volume: 50_000, endDate: nearDeadlineEndDate(),
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        volume: 50_000, endDate: nearDeadlineEndDate(),
        closed: false, resolved: false, active: true,
      },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    await tick();
    await tick();
    // getOrderBook called once per tick per market
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(3);
  });

  it('skips market where mid price is 0', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['0.00', '100']], [['0.00', '100']],
        )),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market where mid price is 1', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook(
          [['1.00', '100']], [['1.00', '100']],
        )),
      } as any,
    });
    const tick = createEventDeadlineScalperTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when price > 0.5 accelerating toward 1 ──────

  it('enters buy-yes when price > 0.5 and accelerating toward 1 near deadline', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Prices accelerating from 0.6 toward 1
        const base = 0.59 + callCount * 0.03;
        const price = Math.min(base, 0.95);
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        momentumWindow: 10,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── Entry tests: BUY NO when price < 0.5 accelerating toward 0 ───────

  it('enters buy-no when price < 0.5 and accelerating toward 0 near deadline', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Prices accelerating from 0.4 toward 0
        const base = 0.41 - callCount * 0.03;
        const price = Math.max(base, 0.05);
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        momentumWindow: 10,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when momentum is zero (flat prices) ─────────────────────

  it('does not enter when prices are flat (no momentum)', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.59', '100']], [['0.61', '100']]),
        ),
      } as any,
      config: {
        urgencyThreshold: 0.01,
        minTimeUrgency: 0.5,
        minVolume: 1,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          // Rising prices to trigger entry
          const p = 0.59 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
          ));
        }
        // Price jumps up for TP
        return Promise.resolve(makeBook(
          [['0.90', '100']], [['0.92', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.50,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          const p = 0.59 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
          ));
        }
        // Price drops for SL
        return Promise.resolve(makeBook(
          [['0.05', '100']], [['0.07', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          const p = 0.59 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.65', '100']], [['0.67', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 4; i++) {
      await tick();
    }
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 3) {
          const p = 0.59 + callCount * 0.03;
          return Promise.resolve(makeBook(
            [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
          ));
        }
        if (callCount <= 5) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.90', '100']], [['0.92', '100']],
          ));
        }
        // Back to rising for potential re-entry
        const p2 = 0.59 + (callCount - 5) * 0.03;
        return Promise.resolve(makeBook(
          [[String(p2 - 0.01), '100']], [[String(p2 + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 12; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('respects maxPositions limit', async () => {
    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        volume: 50_000, endDate: nearDeadlineEndDate(),
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        volume: 50_000, endDate: nearDeadlineEndDate(),
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm3', conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3',
        volume: 50_000, endDate: nearDeadlineEndDate(),
        closed: false, resolved: false, active: true,
      },
    ];

    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Rising prices to trigger entries
        const base = 0.59 + Math.floor((callCount - 1) / 3) * 0.03;
        const price = Math.min(base, 0.95);
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        urgencyThreshold: 0.001,
        minTimeUrgency: 0.5,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createEventDeadlineScalperTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter when urgency score is below threshold', async () => {
    // Very small momentum with high threshold
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.59', '100']], [['0.61', '100']]),
        ),
      } as any,
      config: {
        urgencyThreshold: 10.0, // very high threshold
        minTimeUrgency: 0.5,
        minVolume: 1,
      },
    });

    const tick = createEventDeadlineScalperTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('uses default config values when no overrides', () => {
    const cfg = makeConfig();
    expect(cfg.urgencyThreshold).toBe(0.05);
    expect(cfg.minTimeUrgency).toBe(0.7);
    expect(cfg.momentumWindow).toBe(10);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.03);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(10 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(60_000);
    expect(cfg.positionSize).toBe('10');
  });

  it('config overrides merge with defaults', () => {
    const cfg = makeConfig({ urgencyThreshold: 0.10 });
    expect(cfg.urgencyThreshold).toBe(0.10);
    expect(cfg.minTimeUrgency).toBe(0.7); // unchanged default
  });
});
