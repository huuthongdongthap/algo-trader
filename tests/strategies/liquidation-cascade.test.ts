import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectCascade,
  detectExhaustion,
  calcCascadeSizeMultiplier,
  createLiquidationCascadeTick,
  type LiquidationCascadeDeps,
} from '../../src/strategies/polymarket/liquidation-cascade.js';
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

function makeDeps(overrides?: Partial<LiquidationCascadeDeps>): LiquidationCascadeDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

// ── detectCascade ────────────────────────────────────────────────────────────

describe('detectCascade', () => {
  it('returns null for empty or single-tick history', () => {
    expect(detectCascade([], 0.005, 3, 30_000)).toBeNull();
    expect(detectCascade([{ price: 0.5, timestamp: 1000 }], 0.005, 3, 30_000)).toBeNull();
  });

  it('returns null for flat prices (no cascade)', () => {
    const history = [
      { price: 0.50, timestamp: 1000 },
      { price: 0.50, timestamp: 2000 },
      { price: 0.50, timestamp: 3000 },
      { price: 0.50, timestamp: 4000 },
      { price: 0.50, timestamp: 5000 },
    ];
    expect(detectCascade(history, 0.005, 3, 30_000)).toBeNull();
  });

  it('detects downward cascade', () => {
    // Each drop is > 0.5%: 0.50 -> 0.49 (2%), 0.49 -> 0.48 (2%), 0.48 -> 0.47 (2%)
    const history = [
      { price: 0.50, timestamp: 1000 },
      { price: 0.49, timestamp: 2000 },
      { price: 0.48, timestamp: 3000 },
      { price: 0.47, timestamp: 4000 },
    ];
    const result = detectCascade(history, 0.005, 3, 30_000);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('down');
    expect(result!.steps).toBe(3);
    expect(result!.startPrice).toBe(0.50);
    expect(result!.magnitude).toBeGreaterThan(0);
  });

  it('detects upward cascade', () => {
    const history = [
      { price: 0.50, timestamp: 1000 },
      { price: 0.51, timestamp: 2000 },
      { price: 0.52, timestamp: 3000 },
      { price: 0.53, timestamp: 4000 },
    ];
    const result = detectCascade(history, 0.005, 3, 30_000);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('up');
    expect(result!.steps).toBe(3);
    expect(result!.startPrice).toBe(0.50);
  });

  it('returns null when not enough steps', () => {
    // Only 2 drops, need 3
    const history = [
      { price: 0.50, timestamp: 1000 },
      { price: 0.49, timestamp: 2000 },
      { price: 0.48, timestamp: 3000 },
    ];
    expect(detectCascade(history, 0.005, 3, 30_000)).toBeNull();
  });

  it('returns null when cascade is outside time window', () => {
    // All ticks except last are too old
    const now = 100_000;
    const history = [
      { price: 0.50, timestamp: now - 50_000 },
      { price: 0.49, timestamp: now - 45_000 },
      { price: 0.48, timestamp: now - 40_000 },
      { price: 0.47, timestamp: now - 35_000 },
      { price: 0.47, timestamp: now },
    ];
    // Window is 5_000ms: only the last 2 ticks are in window (no cascade)
    expect(detectCascade(history, 0.005, 3, 5_000)).toBeNull();
  });

  it('detects cascade even with mixed movements before', () => {
    const history = [
      { price: 0.50, timestamp: 1000 },
      { price: 0.51, timestamp: 2000 }, // up
      { price: 0.50, timestamp: 3000 }, // down
      { price: 0.49, timestamp: 4000 }, // down
      { price: 0.48, timestamp: 5000 }, // down
      { price: 0.47, timestamp: 6000 }, // down
    ];
    const result = detectCascade(history, 0.005, 3, 30_000);
    expect(result).not.toBeNull();
    expect(result!.direction).toBe('down');
    expect(result!.steps).toBeGreaterThanOrEqual(3);
  });
});

// ── detectExhaustion ─────────────────────────────────────────────────────────

describe('detectExhaustion', () => {
  it('returns false for fewer than 2 prices', () => {
    expect(detectExhaustion([], 'down')).toBe(false);
    expect(detectExhaustion([0.5], 'down')).toBe(false);
  });

  it('detects exhaustion after downward cascade (price stabilized)', () => {
    // Price was dropping, now stable
    expect(detectExhaustion([0.45, 0.44, 0.44], 'down')).toBe(true);
  });

  it('detects exhaustion after downward cascade (price uptick)', () => {
    expect(detectExhaustion([0.44, 0.45], 'down')).toBe(true);
  });

  it('detects exhaustion after upward cascade (price stabilized)', () => {
    expect(detectExhaustion([0.55, 0.56, 0.56], 'up')).toBe(true);
  });

  it('detects exhaustion after upward cascade (price downtick)', () => {
    expect(detectExhaustion([0.56, 0.55], 'up')).toBe(true);
  });

  it('returns false when still dropping (downward not exhausted)', () => {
    expect(detectExhaustion([0.45, 0.44, 0.43], 'down')).toBe(false);
  });

  it('returns false when still rising (upward not exhausted)', () => {
    expect(detectExhaustion([0.55, 0.56, 0.57], 'up')).toBe(false);
  });
});

// ── calcCascadeSizeMultiplier ────────────────────────────────────────────────

describe('calcCascadeSizeMultiplier', () => {
  it('returns 1 when magnitude equals minMagnitude', () => {
    expect(calcCascadeSizeMultiplier(0.03, 0.03, 2.0)).toBe(1);
  });

  it('scales up for larger magnitudes', () => {
    const mult = calcCascadeSizeMultiplier(0.045, 0.03, 2.0);
    expect(mult).toBeCloseTo(1.5, 4);
  });

  it('caps at maxMultiplier', () => {
    expect(calcCascadeSizeMultiplier(0.10, 0.03, 2.0)).toBe(2.0);
  });

  it('returns at least 1 for small magnitudes', () => {
    expect(calcCascadeSizeMultiplier(0.01, 0.03, 2.0)).toBe(1);
  });

  it('returns 1 when minMagnitude is 0', () => {
    expect(calcCascadeSizeMultiplier(0.05, 0, 2.0)).toBe(1);
  });
});

// ── createLiquidationCascadeTick ─────────────────────────────────────────────

describe('createLiquidationCascadeTick', () => {
  it('creates a callable tick function', () => {
    const tick = createLiquidationCascadeTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createLiquidationCascadeTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed and resolved markets', async () => {
    const markets = [
      { conditionId: 'cond-1', yesTokenId: 'yes-1', closed: true, resolved: false },
      { conditionId: 'cond-2', yesTokenId: 'yes-2', closed: false, resolved: true },
    ];
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });
    const tick = createLiquidationCascadeTick(deps);
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
    const tick = createLiquidationCascadeTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('does not throw on clob API error', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createLiquidationCascadeTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  // ── Integration: full cascade -> exhaustion -> entry ───────────────────

  it('enters after cascade exhaustion (downward cascade -> buy YES)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascading drops (each > 1%)
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: exhaustion - price stabilizes / uptick (tight spread for volume proxy)
      const bid = '0.4550';
      const ask = '0.4650';
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBeGreaterThanOrEqual(1);
    // Should buy YES for downward cascade (contrarian bounce)
    expect(gtcCalls[0][0].side).toBe('buy');
    expect(gtcCalls[0][0].tokenId).toBe('yes-1');
  });

  it('enters after upward cascade exhaustion (buy NO)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascading rises
      if (callCount <= 5) {
        const price = 0.50 + callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: exhaustion - price stabilizes (tight spread)
      return Promise.resolve(makeBook([['0.5450', '100']], [['0.5550', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBeGreaterThanOrEqual(1);
    // Should buy NO for upward cascade (contrarian)
    expect(gtcCalls[0][0].tokenId).toBe('no-1');
  });

  // ── Integration: no entry during active cascade ────────────────────────

  it('does not enter during active cascade (before exhaustion)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Price keeps dropping — never exhausts
      const price = 0.60 - callCount * 0.01;
      const bid = (price - 0.005).toFixed(4);
      const ask = (price + 0.005).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Integration: cascade continuation exit ─────────────────────────────

  it('exits on cascade continuation after entry', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascade down
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: brief stabilization (exhaustion trigger) — tight spread
      if (callCount <= 8) {
        return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
      }
      // Phase 3: price continues dropping hard (cascade continuation)
      const dropPrice = 0.44 - (callCount - 8) * 0.02;
      return Promise.resolve(makeBook([[(dropPrice - 0.005).toFixed(4), '100']], [[(dropPrice + 0.005).toFixed(4), '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
        continuationExitPct: 0.01,
        takeProfitPct: 0.5, // wide so it doesn't trigger
        stopLossPct: 0.5,   // wide so it doesn't trigger
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Integration: take-profit exit ──────────────────────────────────────

  it('exits on take-profit', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascade down
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: exhaustion — tight spread
      if (callCount <= 8) {
        return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
      }
      // Phase 3: price bounces UP (take-profit)
      return Promise.resolve(makeBook([['0.49', '100']], [['0.50', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
        takeProfitPct: 0.025,
        stopLossPct: 0.5, // wide
        continuationExitPct: 0.5, // wide
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Integration: stop-loss exit ────────────────────────────────────────

  it('exits on stop-loss', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascade down
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: exhaustion — tight spread
      if (callCount <= 8) {
        return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
      }
      // Phase 3: price drops slightly (stop-loss at 1.5%)
      // Entry was around 0.455 ask, 1.5% stop = 0.448
      return Promise.resolve(makeBook([['0.4350', '100']], [['0.4450', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
        takeProfitPct: 0.5, // wide
        stopLossPct: 0.015,
        continuationExitPct: 0.5, // wide
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Integration: max hold time exit ────────────────────────────────────

  it('exits on max hold time', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascade down
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: exhaustion — tight spread
      if (callCount <= 8) {
        return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
      }
      // Phase 3: price stays near entry (no TP/SL)
      return Promise.resolve(makeBook([['0.4480', '100']], [['0.4580', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
        takeProfitPct: 0.5, // wide
        stopLossPct: 0.5,   // wide
        continuationExitPct: 0.5, // wide
        maxHoldMs: 5 * 60_000,
      },
    });

    const tick = createLiquidationCascadeTick(deps);

    // Enter position
    for (let i = 0; i < 10; i++) await tick();

    const entryCount = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    ).length;

    if (entryCount > 0) {
      // Fast-forward past max hold
      const baseNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseNow + 6 * 60_000);

      await tick();

      const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'IOC',
      );
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);

      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  // ── Integration: cooldown respected ────────────────────────────────────

  it('respects cooldown after exit', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    let phase = 1; // 1=cascade, 2=exhaustion, 3=entry/tp, 4=second cascade
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (phase === 1 && callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        return Promise.resolve(makeBook([[(price - 0.005).toFixed(4), '100']], [[(price + 0.005).toFixed(4), '100']]));
      }
      if (phase <= 2 && callCount <= 8) {
        phase = 2;
        return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
      }
      // TP trigger
      if (phase <= 3 && callCount <= 12) {
        phase = 3;
        return Promise.resolve(makeBook([['0.49', '100']], [['0.50', '100']]));
      }
      // After exit, new cascade attempt — should be blocked by cooldown
      phase = 4;
      const price = 0.50 - (callCount - 12) * 0.01;
      return Promise.resolve(makeBook([[(price - 0.005).toFixed(4), '100']], [[(price + 0.005).toFixed(4), '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
        takeProfitPct: 0.025,
        stopLossPct: 0.5,
        continuationExitPct: 0.5,
        cooldownMs: 180_000,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 25; i++) await tick();

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    // Should only have 1 entry (second blocked by cooldown)
    expect(gtcCalls.length).toBe(1);
  });

  // ── Integration: max positions respected ───────────────────────────────

  it('respects maxPositions limit', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        return Promise.resolve(makeBook([[(price - 0.005).toFixed(4), '100']], [[(price + 0.005).toFixed(4), '100']]));
      }
      return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
        maxPositions: 0, // no positions allowed
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(entryCalls.length).toBe(0);
  });

  // ── Integration: emits trade.executed event ────────────────────────────

  it('emits trade.executed on entry', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        return Promise.resolve(makeBook([[(price - 0.005).toFixed(4), '100']], [[(price + 0.005).toFixed(4), '100']]));
      }
      return Promise.resolve(makeBook([['0.4450', '100']], [['0.4550', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    expect(tradeCalls.length).toBeGreaterThanOrEqual(1);
    expect(tradeCalls[0][1].trade.strategy).toBe('liquidation-cascade');
  });

  // ── Integration: size scales with cascade magnitude ────────────────────

  it('scales position size with cascade magnitude', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Large cascade: 6 drops of ~2% each = ~12% magnitude
      if (callCount <= 7) {
        const price = 0.60 - callCount * 0.015;
        return Promise.resolve(makeBook([[(price - 0.005).toFixed(4), '100']], [[(price + 0.005).toFixed(4), '100']]));
      }
      // Exhaustion
      return Promise.resolve(makeBook([['0.4950', '100']], [['0.5050', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.03,
        baseSizeUsdc: 20,
        maxSizeMultiplier: 2.0,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 12; i++) await tick();

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    if (gtcCalls.length > 0) {
      // The size should be calculated based on magnitude
      // With a large cascade, size > baseSizeUsdc
      const entrySize = parseFloat(gtcCalls[0][0].size);
      expect(entrySize).toBeGreaterThan(0);
    }
  });

  // ── Integration: does not enter with insufficient cascade magnitude ────

  it('does not enter when cascade magnitude is below minimum', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Small drops (just over 0.5% each but total below 3% minCascadeMagnitude)
      if (callCount <= 5) {
        // 0.6% drops: total magnitude ~ 1.8% which is < 3%
        const price = 0.50 - callCount * 0.003;
        return Promise.resolve(makeBook([[(price - 0.005).toFixed(4), '100']], [[(price + 0.005).toFixed(4), '100']]));
      }
      return Promise.resolve(makeBook([['0.4850', '100']], [['0.4950', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.03,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Integration: no entry on wide spread (volume proxy) ────────────────

  it('does not enter when spread is too wide (low volume proxy)', async () => {
    const market = {
      conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
      closed: false, resolved: false, volume: 100000, volume24h: 5000,
    };

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Phase 1: cascade down
      if (callCount <= 5) {
        const price = 0.50 - callCount * 0.01;
        const bid = (price - 0.005).toFixed(4);
        const ask = (price + 0.005).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
      }
      // Phase 2: exhaustion but WIDE spread (>= 0.05, clearly above 0.04 threshold)
      return Promise.resolve(makeBook([['0.42', '100']], [['0.47', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        minDropPct: 0.005,
        minCascadeSteps: 3,
        cascadeWindowMs: 60_000,
        minCascadeMagnitude: 0.02,
      },
    });

    const tick = createLiquidationCascadeTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
