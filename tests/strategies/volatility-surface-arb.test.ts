import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/core/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  calcImpliedVol,
  calcVolSpread,
  updateEma,
  calcCorrelation,
  daysToExpiry,
  pairKey,
  createVolatilitySurfaceArbTick,
  type VolatilitySurfaceArbDeps,
} from '../../src/strategies/polymarket/volatility-surface-arb.js';
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

function makeEvent(
  markets: Array<{
    id: string;
    conditionId: string;
    yesTokenId: string;
    noTokenId?: string;
    closed?: boolean;
    resolved?: boolean;
    active?: boolean;
    volume24h?: number;
    endDate?: string;
  }>,
) {
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
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: 10000,
      volume24h: m.volume24h ?? 10000,
      liquidity: 5000,
      endDate: m.endDate ?? '2026-12-31',
      active: m.active ?? true,
      closed: m.closed ?? false,
      resolved: m.resolved ?? false,
      outcome: null,
    })),
  };
}

function makeDeps(overrides?: Partial<VolatilitySurfaceArbDeps>): VolatilitySurfaceArbDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getEvents: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

// ── calcImpliedVol ──────────────────────────────────────────────────────────

describe('calcImpliedVol', () => {
  it('returns 0 when daysToExpiry <= 0', () => {
    expect(calcImpliedVol(0.5, 0)).toBe(0);
    expect(calcImpliedVol(0.5, -1)).toBe(0);
  });

  it('returns 0 when price <= 0', () => {
    expect(calcImpliedVol(0, 10)).toBe(0);
    expect(calcImpliedVol(-0.1, 10)).toBe(0);
  });

  it('returns 0 when price >= 1', () => {
    expect(calcImpliedVol(1, 10)).toBe(0);
    expect(calcImpliedVol(1.5, 10)).toBe(0);
  });

  it('computes p*(1-p)/sqrt(dte) for valid inputs', () => {
    const vol = calcImpliedVol(0.5, 4);
    // 0.5*0.5 / sqrt(4) = 0.25/2 = 0.125
    expect(vol).toBeCloseTo(0.125);
  });

  it('is maximal at price=0.5', () => {
    const vol50 = calcImpliedVol(0.5, 10);
    const vol30 = calcImpliedVol(0.3, 10);
    const vol80 = calcImpliedVol(0.8, 10);
    expect(vol50).toBeGreaterThan(vol30);
    expect(vol50).toBeGreaterThan(vol80);
  });
});

// ── calcVolSpread ───────────────────────────────────────────────────────────

describe('calcVolSpread', () => {
  it('returns absolute difference', () => {
    expect(calcVolSpread(0.1, 0.05)).toBeCloseTo(0.05);
  });

  it('is symmetric', () => {
    expect(calcVolSpread(0.1, 0.2)).toBe(calcVolSpread(0.2, 0.1));
  });

  it('returns 0 for equal vols', () => {
    expect(calcVolSpread(0.15, 0.15)).toBe(0);
  });
});

// ── updateEma ───────────────────────────────────────────────────────────────

describe('updateEma', () => {
  it('returns raw value when previous is null', () => {
    expect(updateEma(null, 5, 0.1)).toBe(5);
  });

  it('applies alpha blending for non-null previous', () => {
    // alpha*value + (1-alpha)*prev = 0.1*10 + 0.9*5 = 1 + 4.5 = 5.5
    expect(updateEma(5, 10, 0.1)).toBeCloseTo(5.5);
  });

  it('with alpha=1 returns the new value', () => {
    expect(updateEma(5, 10, 1)).toBe(10);
  });

  it('with alpha=0 returns the old value', () => {
    expect(updateEma(5, 10, 0)).toBe(5);
  });
});

// ── calcCorrelation ─────────────────────────────────────────────────────────

describe('calcCorrelation', () => {
  it('returns 0 for fewer than 3 data points', () => {
    expect(calcCorrelation([1, 2], [3, 4])).toBe(0);
    expect(calcCorrelation([], [])).toBe(0);
  });

  it('returns 1 for perfectly correlated series', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [2, 4, 6, 8, 10];
    expect(calcCorrelation(a, b)).toBeCloseTo(1);
  });

  it('returns -1 for perfectly anti-correlated series', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [10, 8, 6, 4, 2];
    expect(calcCorrelation(a, b)).toBeCloseTo(-1);
  });

  it('returns 0 for uncorrelated series', () => {
    // constant series has zero variance → denom = 0 → returns 0
    const a = [5, 5, 5, 5];
    const b = [1, 2, 3, 4];
    expect(calcCorrelation(a, b)).toBe(0);
  });

  it('uses the shorter array length', () => {
    const a = [1, 2, 3, 4, 5, 6, 7];
    const b = [2, 4, 6];
    // Only first 3 elements used → still perfect correlation
    expect(calcCorrelation(a, b)).toBeCloseTo(1);
  });
});

// ── daysToExpiry ────────────────────────────────────────────────────────────

describe('daysToExpiry', () => {
  it('returns positive days for future date', () => {
    const now = new Date('2026-01-01T00:00:00Z').getTime();
    const dte = daysToExpiry('2026-01-11T00:00:00Z', now);
    expect(dte).toBeCloseTo(10);
  });

  it('returns negative for past date', () => {
    const now = new Date('2026-01-11T00:00:00Z').getTime();
    const dte = daysToExpiry('2026-01-01T00:00:00Z', now);
    expect(dte).toBeCloseTo(-10);
  });

  it('returns 0 when dates are equal', () => {
    const now = new Date('2026-06-15T12:00:00Z').getTime();
    expect(daysToExpiry('2026-06-15T12:00:00Z', now)).toBe(0);
  });
});

// ── pairKey ─────────────────────────────────────────────────────────────────

describe('pairKey', () => {
  it('is order-independent', () => {
    expect(pairKey('aaa', 'bbb')).toBe(pairKey('bbb', 'aaa'));
  });

  it('puts the lexicographically smaller token first', () => {
    expect(pairKey('beta', 'alpha')).toBe('alpha:beta');
  });

  it('handles equal tokens', () => {
    expect(pairKey('x', 'x')).toBe('x:x');
  });
});

// ── createVolatilitySurfaceArbTick integration ──────────────────────────────

describe('createVolatilitySurfaceArbTick', () => {
  it('does nothing when getEvents returns empty array', async () => {
    const deps = makeDeps();
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1', closed: true },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2', closed: true },
    ]);
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1', resolved: true },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2', resolved: true },
    ]);
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips inactive markets', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1', active: false },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2', active: false },
    ]);
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets with insufficient volume', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1', volume24h: 100 },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2', volume24h: 100 },
    ]);
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips event with fewer than 2 active markets', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
    ]);
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('does not enter on the first tick (no prevEma)', async () => {
    // First tick sets EMA but spread > newEma check fails because prevEma is null
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
    ]);
    const getOrderBook = vi.fn()
      .mockResolvedValueOnce(makeBook([['0.30', '100']], [['0.32', '100']])) // yes-1 mid=0.31
      .mockResolvedValueOnce(makeBook([['0.70', '100']], [['0.72', '100']])); // yes-2 mid=0.71
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createVolatilitySurfaceArbTick({
      ...deps,
      config: { spreadThreshold: 0.001, minCorrelation: 0, corrWindow: 3 },
    });
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  function buildEntryDeps(config?: Partial<any>) {
    // Two markets with diverging prices across ticks so spread widens.
    // Tick 1: moderate spread → exceeds threshold, sets EMA baseline.
    // Tick 2+: larger spread → spread > EMA → triggers entry.
    //
    // endDate = '2027-12-31' → ~dte=645 → sqrt(dte)≈25.4
    // Tick 1: yes-1 mid=0.35, yes-2 mid=0.50
    //   vol1=0.35*0.65/25.4≈0.00895, vol2=0.50*0.50/25.4≈0.00984, spread≈0.00089
    // Tick 2: yes-1 mid=0.20, yes-2 mid=0.50
    //   vol1=0.20*0.80/25.4≈0.0063, vol2=0.50*0.50/25.4≈0.00984, spread≈0.00354
    //
    // With spreadThreshold=0.0005 both ticks exceed it.
    // With emaAlpha=0.1: newEma on tick2 = 0.1*0.00354 + 0.9*0.00089 ≈ 0.00116
    //   spread(0.00354) > newEma(0.00116) ✓
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1', endDate: '2027-12-31' },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2', endDate: '2027-12-31' },
    ]);

    let tickNum = 0;
    const getOrderBook = vi.fn().mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1') {
        return Promise.resolve(
          tickNum <= 1
            ? makeBook([['0.34', '100']], [['0.36', '100']]) // mid=0.35
            : makeBook([['0.19', '100']], [['0.21', '100']]) // mid=0.20, ask=0.21
        );
      }
      if (tokenId === 'yes-2') {
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']])); // mid=0.50
      }
      return Promise.resolve(makeBook([], []));
    });

    const deps = makeDeps({
      gamma: {
        getEvents: vi.fn().mockImplementation(() => {
          tickNum++;
          return Promise.resolve([event]);
        }),
      } as any,
      clob: { getOrderBook } as any,
      config: {
        spreadThreshold: 0.0005,
        minCorrelation: 0,
        corrWindow: 3,
        emaAlpha: 0.1,
        ...config,
      },
    });
    return deps;
  }

  it('enters a position on second tick when spread widens', async () => {
    const deps = buildEntryDeps();
    const tick = createVolatilitySurfaceArbTick(deps);

    // Tick 1: builds EMA baseline, no entry
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();

    // Tick 2: spread > EMA (widening) → entry
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    // yes-1 has lower mid (0.30) → lower implied vol → cheaper vol side → bought
    expect(call.tokenId).toBe('yes-1');
    expect(call.side).toBe('buy');
  });

  it('emits trade.executed on entry', async () => {
    const deps = buildEntryDeps();
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    await tick();
    expect(deps.eventBus.emit).toHaveBeenCalledWith(
      'trade.executed',
      expect.objectContaining({
        trade: expect.objectContaining({
          side: 'buy',
          strategy: 'volatility-surface-arb',
        }),
      }),
    );
  });

  it('respects maxPositions', async () => {
    // Prevent unintended exit by setting very wide stop-loss/take-profit
    const deps = buildEntryDeps({ maxPositions: 1, stopLossPct: 0.99, takeProfitPct: 0.99 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick(); // build EMA
    await tick(); // enter position (fills maxPositions=1)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Tick 3: should not enter another since maxPositions=1
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('exits on take-profit', async () => {
    const deps = buildEntryDeps({ takeProfitPct: 0.01 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick(); // build EMA
    await tick(); // enter position on yes-1 at ask=0.31

    // Shift yes-1 mid way up → pnl > 1%
    (deps.clob.getOrderBook as any).mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([['0.44', '100']], [['0.46', '100']])); // mid=0.45 vs entry 0.31
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      return Promise.resolve(makeBook([], []));
    });

    await tick(); // should trigger exit
    // placeOrder called for entry (1) + exit (1) = 2
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits on stop-loss', async () => {
    const deps = buildEntryDeps({ stopLossPct: 0.01 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    await tick(); // entry at ask=0.31

    // Shift yes-1 mid down → loss > 1%
    (deps.clob.getOrderBook as any).mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([['0.14', '100']], [['0.16', '100']])); // mid=0.15 vs entry 0.31
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      return Promise.resolve(makeBook([], []));
    });

    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
  });

  it('exits on max hold time', async () => {
    const deps = buildEntryDeps({ maxHoldMs: 1 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick(); // EMA
    await tick(); // entry at ask=0.31
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Wait for maxHold to expire then tick
    await new Promise(r => setTimeout(r, 10));
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
  });

  it('applies cooldown after exit', async () => {
    const deps = buildEntryDeps({ takeProfitPct: 0.01, cooldownMs: 999_999_999 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick(); // EMA
    await tick(); // entry at ask=0.31

    // Trigger take-profit exit — yes-1 mid jumps to 0.45
    (deps.clob.getOrderBook as any).mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([['0.44', '100']], [['0.46', '100']]));
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      return Promise.resolve(makeBook([], []));
    });
    await tick(); // exit
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Reset prices back to spread scenario — should NOT re-enter due to cooldown
    (deps.clob.getOrderBook as any).mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([['0.29', '100']], [['0.31', '100']]));
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      return Promise.resolve(makeBook([], []));
    });
    await tick();
    // Still 2 — no re-entry due to cooldown
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('emits trade.executed on exit', async () => {
    const deps = buildEntryDeps({ takeProfitPct: 0.01 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    await tick(); // entry at ask=0.31

    // Trigger take-profit — yes-1 mid jumps to 0.45
    (deps.clob.getOrderBook as any).mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([['0.44', '100']], [['0.46', '100']]));
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      return Promise.resolve(makeBook([], []));
    });
    await tick();

    const exitEmit = (deps.eventBus.emit as any).mock.calls.find(
      (c: any[]) => c[1]?.trade?.side === 'sell',
    );
    expect(exitEmit).toBeDefined();
    expect(exitEmit[1].trade.strategy).toBe('volatility-surface-arb');
  });

  it('continues when getOrderBook throws during entry scan', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
    ]);
    const getOrderBook = vi.fn().mockRejectedValue(new Error('network error'));
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    // Should not throw
    await expect(tick()).resolves.toBeUndefined();
  });

  it('continues when getEvents throws', async () => {
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockRejectedValue(new Error('gamma down')) } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('continues when placeOrder throws during entry', async () => {
    const deps = buildEntryDeps();
    (deps.orderManager.placeOrder as any).mockRejectedValue(new Error('order fail'));
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    // Should not throw on entry failure
    await expect(tick()).resolves.toBeUndefined();
  });

  it('continues when getOrderBook throws during exit check', async () => {
    const deps = buildEntryDeps({ takeProfitPct: 0.01 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    await tick(); // entry

    // Make exit book fetch fail
    (deps.clob.getOrderBook as any).mockRejectedValue(new Error('book fail'));
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter when spread is below threshold', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
    ]);
    // Nearly identical mids → tiny vol spread
    const getOrderBook = vi.fn().mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.50', '100']], [['0.52', '100']]));
      return Promise.resolve(makeBook([], []));
    });
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
      clob: { getOrderBook } as any,
      config: { spreadThreshold: 10 }, // impossibly high
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when correlation is too low', async () => {
    const deps = buildEntryDeps({ minCorrelation: 0.999, corrWindow: 3 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    await tick();
    // With only 1-2 price observations correlation check returns 0 (< 0.999)
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets with mid price at boundary (0 or 1)', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
    ]);
    const getOrderBook = vi.fn().mockImplementation((tokenId: string) => {
      if (tokenId === 'yes-1')
        return Promise.resolve(makeBook([], [['1.00', '100']])); // mid=(0+1)/2=0.5 actually... let's use bid=1
      if (tokenId === 'yes-2')
        return Promise.resolve(makeBook([['0.99', '100']], [['1.00', '100']])); // mid=0.995 → rounds to ~1
      return Promise.resolve(makeBook([], []));
    });
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles empty order book gracefully', async () => {
    const event = makeEvent([
      { id: 'm1', conditionId: 'c1', yesTokenId: 'yes-1' },
      { id: 'm2', conditionId: 'c2', yesTokenId: 'yes-2' },
    ]);
    const getOrderBook = vi.fn().mockResolvedValue(makeBook([], []));
    const deps = makeDeps({
      gamma: { getEvents: vi.fn().mockResolvedValue([event]) } as any,
      clob: { getOrderBook } as any,
    });
    const tick = createVolatilitySurfaceArbTick(deps);
    // mid = (0+1)/2 = 0.5 which is valid, but shouldn't throw
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not enter duplicate position for same token', async () => {
    // Wide stop/tp to prevent exit, maxPositions high so it's not the limit
    const deps = buildEntryDeps({ maxPositions: 5, stopLossPct: 0.99, takeProfitPct: 0.99 });
    const tick = createVolatilitySurfaceArbTick(deps);
    await tick(); // build EMA
    await tick(); // first entry on yes-1
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Tick 3: yes-1 already has position → no duplicate for that token
    // (may enter other tokens though)
    const callsBefore = (deps.orderManager.placeOrder as any).mock.calls.length;
    await tick();
    const yes1Entries = (deps.orderManager.placeOrder as any).mock.calls
      .filter((c: any[]) => c[0]?.tokenId === 'yes-1' && c[0]?.orderType === 'GTC');
    expect(yes1Entries.length).toBe(1);
  });

  it('returns a function', () => {
    const deps = makeDeps();
    const tick = createVolatilitySurfaceArbTick(deps);
    expect(typeof tick).toBe('function');
  });
});
