import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcDaysToExpiry,
  calcTheta,
  isInDeadZone,
  getDirection,
  isThetaAccelerating,
  scalePositionSize,
  createExpiryThetaDecayTick,
  DEFAULT_CONFIG,
  type ExpiryThetaDecayConfig,
  type ExpiryThetaDecayDeps,
} from '../../src/strategies/polymarket/expiry-theta-decay.js';
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

function makeMarket(overrides: Record<string, any> = {}) {
  return {
    id: 'm1',
    question: 'Will X happen?',
    slug: 'will-x-happen',
    conditionId: 'cond-1',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    yesPrice: 0.60,
    noPrice: 0.40,
    volume: 100000,
    volume24h: 10000,
    liquidity: 50000,
    endDate: '',
    active: true,
    closed: false,
    resolved: false,
    outcome: null,
    ...overrides,
  };
}

/** Return an ISO date string N days from now. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

// ── calcDaysToExpiry tests ──────────────────────────────────────────────────

describe('calcDaysToExpiry', () => {
  it('returns positive days for a future date', () => {
    const now = new Date('2026-03-25T00:00:00Z').getTime();
    const result = calcDaysToExpiry('2026-03-30T00:00:00Z', now);
    expect(result).toBeCloseTo(5, 5);
  });

  it('returns negative days for a past date', () => {
    const now = new Date('2026-03-25T00:00:00Z').getTime();
    const result = calcDaysToExpiry('2026-03-20T00:00:00Z', now);
    expect(result).toBeCloseTo(-5, 5);
  });

  it('returns Infinity for an invalid date string', () => {
    expect(calcDaysToExpiry('not-a-date')).toBe(Infinity);
  });

  it('returns 0 when endDate equals now', () => {
    const now = new Date('2026-03-25T12:00:00Z').getTime();
    expect(calcDaysToExpiry('2026-03-25T12:00:00Z', now)).toBe(0);
  });

  it('uses Date.now() as default when now is not supplied', () => {
    const futureDate = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const result = calcDaysToExpiry(futureDate);
    expect(result).toBeCloseTo(3, 0);
  });
});

// ── calcTheta tests ─────────────────────────────────────────────────────────

describe('calcTheta', () => {
  it('calculates theta for price > 0.5', () => {
    // price=0.7, daysToExpiry=4 → distanceFromEdge=0.7, theta=0.7/sqrt(4)=0.35
    expect(calcTheta(0.7, 4)).toBeCloseTo(0.35, 5);
  });

  it('calculates theta for price < 0.5', () => {
    // price=0.3, daysToExpiry=4 → distanceFromEdge=1-0.3=0.7, theta=0.7/sqrt(4)=0.35
    expect(calcTheta(0.3, 4)).toBeCloseTo(0.35, 5);
  });

  it('returns Infinity when daysToExpiry is 0', () => {
    expect(calcTheta(0.6, 0)).toBe(Infinity);
  });

  it('returns Infinity when daysToExpiry is negative', () => {
    expect(calcTheta(0.6, -1)).toBe(Infinity);
  });

  it('returns higher theta for fewer days', () => {
    const thetaFar = calcTheta(0.7, 10);
    const thetaNear = calcTheta(0.7, 2);
    expect(thetaNear).toBeGreaterThan(thetaFar);
  });

  it('calculates theta for price exactly 0.5', () => {
    // price=0.5 → not > 0.5, so distanceFromEdge=1-0.5=0.5
    // theta=0.5/sqrt(1)=0.5
    expect(calcTheta(0.5, 1)).toBeCloseTo(0.5, 5);
  });

  it('calculates theta for price near 1', () => {
    // price=0.95, days=1 → distanceFromEdge=0.95, theta=0.95/1=0.95
    expect(calcTheta(0.95, 1)).toBeCloseTo(0.95, 5);
  });
});

// ── isInDeadZone tests ──────────────────────────────────────────────────────

describe('isInDeadZone', () => {
  it('returns true when price is inside the dead zone', () => {
    expect(isInDeadZone(0.50, 0.45, 0.55)).toBe(true);
  });

  it('returns false when price is above the dead zone', () => {
    expect(isInDeadZone(0.60, 0.45, 0.55)).toBe(false);
  });

  it('returns false when price is below the dead zone', () => {
    expect(isInDeadZone(0.40, 0.45, 0.55)).toBe(false);
  });

  it('returns true when price is on the low boundary', () => {
    expect(isInDeadZone(0.45, 0.45, 0.55)).toBe(true);
  });

  it('returns true when price is on the high boundary', () => {
    expect(isInDeadZone(0.55, 0.45, 0.55)).toBe(true);
  });
});

// ── getDirection tests ──────────────────────────────────────────────────────

describe('getDirection', () => {
  it('returns yes when price is above deadZoneHigh', () => {
    expect(getDirection(0.60, 0.45, 0.55)).toBe('yes');
  });

  it('returns no when price is below deadZoneLow', () => {
    expect(getDirection(0.40, 0.45, 0.55)).toBe('no');
  });

  it('returns null when price is in the dead zone', () => {
    expect(getDirection(0.50, 0.45, 0.55)).toBeNull();
  });

  it('returns null when price is on the high boundary', () => {
    expect(getDirection(0.55, 0.45, 0.55)).toBeNull();
  });

  it('returns null when price is on the low boundary', () => {
    expect(getDirection(0.45, 0.45, 0.55)).toBeNull();
  });

  it('returns yes for price just above deadZoneHigh', () => {
    expect(getDirection(0.5501, 0.45, 0.55)).toBe('yes');
  });

  it('returns no for price just below deadZoneLow', () => {
    expect(getDirection(0.4499, 0.45, 0.55)).toBe('no');
  });
});

// ── isThetaAccelerating tests ───────────────────────────────────────────────

describe('isThetaAccelerating', () => {
  it('returns false for empty history', () => {
    expect(isThetaAccelerating([])).toBe(false);
  });

  it('returns false for 1 entry', () => {
    expect(isThetaAccelerating([{ theta: 0.1, timestamp: 1 }])).toBe(false);
  });

  it('returns false for 2 entries (insufficient data)', () => {
    expect(isThetaAccelerating([
      { theta: 0.1, timestamp: 1 },
      { theta: 0.2, timestamp: 2 },
    ])).toBe(false);
  });

  it('returns true when latest theta exceeds average of earlier readings', () => {
    // earlier avg = (0.10 + 0.12) / 2 = 0.11, latest = 0.15 > 0.11 → true
    expect(isThetaAccelerating([
      { theta: 0.10, timestamp: 1 },
      { theta: 0.12, timestamp: 2 },
      { theta: 0.15, timestamp: 3 },
    ])).toBe(true);
  });

  it('returns false when latest theta is below average (decelerating)', () => {
    // earlier avg = (0.20 + 0.18) / 2 = 0.19, latest = 0.10 < 0.19 → false
    expect(isThetaAccelerating([
      { theta: 0.20, timestamp: 1 },
      { theta: 0.18, timestamp: 2 },
      { theta: 0.10, timestamp: 3 },
    ])).toBe(false);
  });

  it('returns false when latest theta equals average exactly', () => {
    // earlier avg = (0.10 + 0.20) / 2 = 0.15, latest = 0.15 → not > → false
    expect(isThetaAccelerating([
      { theta: 0.10, timestamp: 1 },
      { theta: 0.20, timestamp: 2 },
      { theta: 0.15, timestamp: 3 },
    ])).toBe(false);
  });
});

// ── scalePositionSize tests ─────────────────────────────────────────────────

describe('scalePositionSize', () => {
  it('returns base size when theta equals threshold', () => {
    expect(scalePositionSize(12, 0.08, 0.08, 2.0)).toBe(12);
  });

  it('returns base size when theta is below threshold', () => {
    expect(scalePositionSize(12, 0.05, 0.08, 2.0)).toBe(12);
  });

  it('scales up when theta exceeds threshold', () => {
    // theta=0.16, threshold=0.08, scale=min(0.16/0.08, 2.0)=min(2, 2)=2
    expect(scalePositionSize(12, 0.16, 0.08, 2.0)).toBeCloseTo(24, 5);
  });

  it('caps scale at maxScale', () => {
    // theta=0.32, threshold=0.08, scale=min(0.32/0.08, 2.0)=min(4, 2)=2
    expect(scalePositionSize(12, 0.32, 0.08, 2.0)).toBeCloseTo(24, 5);
  });

  it('scales proportionally between threshold and max', () => {
    // theta=0.12, threshold=0.08, scale=min(0.12/0.08, 2.0)=min(1.5, 2)=1.5
    expect(scalePositionSize(12, 0.12, 0.08, 2.0)).toBeCloseTo(18, 5);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ExpiryThetaDecayDeps> = {}): ExpiryThetaDecayDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.59', '100'], ['0.58', '100']],
          [['0.61', '100'], ['0.62', '100']],
        ),
      ),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-xxx' }),
    } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: {
      getTrending: vi.fn().mockResolvedValue([
        makeMarket({ endDate: daysFromNow(7) }),
      ]),
    } as any,
    ...overrides,
  };
}

describe('createExpiryThetaDecayTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createExpiryThetaDecayTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw when tick is called', async () => {
    const tick = createExpiryThetaDecayTick(makeDeps());
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not place orders with no markets', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7), closed: true }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7), resolved: true }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without endDate', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: undefined }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    // endDate=undefined → calcDaysToExpiry returns Infinity → > maxDaysToExpiry → skip
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets too far from expiry (> maxDaysToExpiry)', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(30) }),
        ]),
      } as any,
      config: { maxDaysToExpiry: 14 },
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets too close to expiry (< minDaysToExpiry)', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(0.5) }),
        ]),
      } as any,
      config: { minDaysToExpiry: 1 },
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets in the dead zone', async () => {
    // mid = (0.49 + 0.51) / 2 = 0.50, which is in dead zone [0.45, 0.55]
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips when theta is below threshold', async () => {
    // Use a very high thetaThreshold to force skip
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.56', '100']], [['0.58', '100']]),
        ),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
      config: { thetaThreshold: 10.0 },
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips when theta is not accelerating (fewer than 3 history entries)', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick(); // 1 history entry
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips with only 2 history entries (still not accelerating)', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters BUY YES when price > deadZoneHigh with accelerating theta', async () => {
    // Increase mid price each tick to create theta acceleration
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          // Third tick: higher price → higher theta → acceleration
          return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick(); // history: 1 entry
    await tick(); // history: 2 entries
    await tick(); // history: 3 entries — should accelerate and enter

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.tokenId).toBe('yes-1');
    expect(call.orderType).toBe('GTC');
  });

  it('enters BUY NO when price < deadZoneLow with accelerating theta', async () => {
    // mid < 0.45 → direction=no; increase distance from edge for acceleration
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.39', '100']], [['0.41', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.38', '100']], [['0.40', '100']]));
          // Third tick: lower price → more distance from edge → higher theta
          return Promise.resolve(makeBook([['0.35', '100']], [['0.37', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    expect(call.side).toBe('buy');
    expect(call.tokenId).toBe('no-1');
  });

  it('exits on take-profit', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          // Ticks 1-3: entry phase with increasing theta
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          if (tickCount === 3) return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
          // Tick 4: exit phase — price up significantly for take profit
          // Entry was at ask=0.64. TP at 5% → need mid > 0.64 * 1.05 = 0.672
          return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
      config: { takeProfitPct: 0.05 },
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // exit — take profit
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
    expect(exitCall.orderType).toBe('IOC');
  });

  it('exits on stop-loss', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          if (tickCount === 3) return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
          // Tick 4: price drops — entry at 0.64, SL at 3% → need mid < 0.64 * 0.97 = 0.6208
          return Promise.resolve(makeBook([['0.55', '100']], [['0.57', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
      config: { stopLossPct: 0.03 },
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // exit — stop loss
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
    const exitCall = (deps.orderManager.placeOrder as any).mock.calls[1][0];
    expect(exitCall.side).toBe('sell');
  });

  it('exits on max hold time', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          // Remaining ticks: same price so no TP/SL trigger
          return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
      config: { maxHoldMs: 1 }, // 1ms → triggers immediately
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Wait a tiny bit to exceed maxHoldMs
    await new Promise(r => setTimeout(r, 5));
    await tick(); // exit — max hold time
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('enforces cooldown after exit', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          if (tickCount === 3) return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
          if (tickCount === 4) {
            // Price up for TP exit
            return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
          }
          // After exit: same accelerating prices, but should be on cooldown
          return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
      config: { takeProfitPct: 0.05, cooldownMs: 120_000 },
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // TP exit
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);

    // Try to re-enter — should be on cooldown
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2); // no new orders
  });

  it('respects maxPositions limit', async () => {
    const markets = [
      makeMarket({ conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1', endDate: daysFromNow(7) }),
      makeMarket({ conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2', endDate: daysFromNow(7) }),
      makeMarket({ conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3', endDate: daysFromNow(7) }),
      makeMarket({ conditionId: 'cond-4', yesTokenId: 'yes-4', noTokenId: 'no-4', endDate: daysFromNow(7) }),
    ];

    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          // Increase price each tick batch to create theta acceleration
          if (tickCount <= 4) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount <= 8) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
        }),
      } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: { maxPositions: 2 },
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick(); // build history for all 4 markets
    await tick();
    await tick(); // entry — should only enter 2 positions

    // At most 2 entry orders placed (maxPositions=2)
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('scales position size with theta magnitude', async () => {
    // Use a high price (far from edge) and short days → high theta → scaling
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.78', '100']], [['0.80', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.80', '100']], [['0.82', '100']]));
          return Promise.resolve(makeBook([['0.84', '100']], [['0.86', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(2) }),
        ]),
      } as any,
      config: {
        thetaThreshold: 0.08,
        maxPositionScale: 2.0,
        positionSize: '12',
      },
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry

    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
    const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
    // Verify size is greater than base (12/price), meaning scaling was applied
    const baseQty = 12 / 0.86; // base size / ask price
    const actualQty = parseFloat(call.size);
    expect(actualQty).toBeGreaterThan(Math.round(baseQty));
  });

  it('emits trade.executed event on entry', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();

    expect(deps.eventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        strategy: 'expiry-theta-decay',
        side: 'buy',
      }),
    }));
  });

  it('emits trade.executed event on exit', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          if (tickCount === 3) return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
          return Promise.resolve(makeBook([['0.69', '100']], [['0.71', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
      config: { takeProfitPct: 0.05 },
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    await tick(); // exit

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const exitEmit = emitCalls.find(
      (c: any) => c[0] === 'trade.executed' && c[1]?.trade?.side === 'sell',
    );
    expect(exitEmit).toBeDefined();
    expect(exitEmit[1].trade.strategy).toBe('expiry-theta-decay');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips markets with missing yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7), yesTokenId: undefined }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets with missing noTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7), noTokenId: undefined }),
        ]),
      } as any,
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips markets with low volume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7), volume24h: 100 }),
        ]),
      } as any,
      config: { minVolume: 5000 },
    });
    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not re-enter a market that already has a position', async () => {
    let tickCount = 0;
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockImplementation(() => {
          tickCount++;
          if (tickCount === 1) return Promise.resolve(makeBook([['0.58', '100']], [['0.60', '100']]));
          if (tickCount === 2) return Promise.resolve(makeBook([['0.59', '100']], [['0.61', '100']]));
          // Keep returning the same price to avoid TP/SL
          return Promise.resolve(makeBook([['0.62', '100']], [['0.64', '100']]));
        }),
      } as any,
      gamma: {
        getTrending: vi.fn().mockResolvedValue([
          makeMarket({ endDate: daysFromNow(7) }),
        ]),
      } as any,
    });

    const tick = createExpiryThetaDecayTick(deps);
    await tick();
    await tick();
    await tick(); // entry
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);

    await tick(); // should not re-enter same market
    await tick();
    expect(deps.orderManager.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('uses default config when no config override is provided', async () => {
    const deps = makeDeps();
    delete (deps as any).config;
    const tick = createExpiryThetaDecayTick(deps);
    // Should not throw — uses DEFAULT_CONFIG
    await expect(tick()).resolves.toBeUndefined();
  });
});
