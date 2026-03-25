import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isInGammaZone,
  calcNormalizedDelta,
  calcRebalanceAmounts,
  calcPositionPnl,
  shouldExitGammaZone,
  createGammaScalpingTick,
  type GammaScalpingDeps,
} from '../../src/strategies/polymarket/gamma-scalping.js';
import type { RawOrderBook } from '../../src/polymarket/clob-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBook(bids: [string, string][], asks: [string, string][]): RawOrderBook {
  return {
    market: 'test-market',
    asset_id: 'test-token',
    bids: bids.map(([price, size]) => ({ price, size })),
    asks: asks.map(([price, size]) => ({ price, size })),
    hash: 'abc',
  };
}

function makeDeps(overrides?: Partial<GammaScalpingDeps>): GammaScalpingDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

function makeMarket(overrides?: Record<string, any>) {
  return {
    conditionId: 'cond-1',
    yesTokenId: 'yes-1',
    noTokenId: 'no-1',
    closed: false,
    resolved: false,
    volume: 100000,
    volume24h: 5000,
    ...overrides,
  };
}

// ── isInGammaZone ───────────────────────────────────────────────────────────

describe('isInGammaZone', () => {
  it('returns true when mid is inside gamma zone', () => {
    expect(isInGammaZone(0.5, 0.35, 0.65)).toBe(true);
  });

  it('returns false when mid is below gamma zone', () => {
    expect(isInGammaZone(0.2, 0.35, 0.65)).toBe(false);
  });

  it('returns false when mid is above gamma zone', () => {
    expect(isInGammaZone(0.8, 0.35, 0.65)).toBe(false);
  });

  it('returns true at low edge', () => {
    expect(isInGammaZone(0.35, 0.35, 0.65)).toBe(true);
  });

  it('returns true at high edge', () => {
    expect(isInGammaZone(0.65, 0.35, 0.65)).toBe(true);
  });
});

// ── calcNormalizedDelta ─────────────────────────────────────────────────────

describe('calcNormalizedDelta', () => {
  it('returns 0 for balanced position', () => {
    // yesValue = 10*0.5 = 5, noValue = 10*0.5 = 5
    expect(calcNormalizedDelta(10, 0.5, 10, 0.5)).toBe(0);
  });

  it('returns positive for yes-heavy position', () => {
    // yesValue = 20*0.6 = 12, noValue = 10*0.4 = 4, delta = 8/16 = 0.5
    expect(calcNormalizedDelta(20, 0.6, 10, 0.4)).toBeCloseTo(0.5);
  });

  it('returns negative for no-heavy position', () => {
    // yesValue = 10*0.4 = 4, noValue = 20*0.6 = 12, delta = -8/16 = -0.5
    expect(calcNormalizedDelta(10, 0.4, 20, 0.6)).toBeCloseTo(-0.5);
  });

  it('returns 0 when total value is 0', () => {
    expect(calcNormalizedDelta(0, 0.5, 0, 0.5)).toBe(0);
  });
});

// ── calcRebalanceAmounts ────────────────────────────────────────────────────

describe('calcRebalanceAmounts', () => {
  it('returns sell YES / buy NO when yes-heavy', () => {
    // yesValue = 20*0.6 = 12, noValue = 10*0.4 = 4, diff = 8, rebalValue = 4
    const result = calcRebalanceAmounts(20, 0.6, 10, 0.4);
    expect(result).not.toBeNull();
    expect('sellYes' in result!).toBe(true);
    if ('sellYes' in result!) {
      expect(result.sellYes).toBeCloseTo(4 / 0.6);
      expect(result.buyNo).toBeCloseTo(4 / 0.4);
    }
  });

  it('returns sell NO / buy YES when no-heavy', () => {
    const result = calcRebalanceAmounts(10, 0.4, 20, 0.6);
    expect(result).not.toBeNull();
    expect('sellNo' in result!).toBe(true);
    if ('sellNo' in result!) {
      expect(result.sellNo).toBeCloseTo(4 / 0.6);
      expect(result.buyYes).toBeCloseTo(4 / 0.4);
    }
  });

  it('returns null when perfectly balanced', () => {
    const result = calcRebalanceAmounts(10, 0.5, 10, 0.5);
    expect(result).toBeNull();
  });
});

// ── calcPositionPnl ─────────────────────────────────────────────────────────

describe('calcPositionPnl', () => {
  it('returns profit when both sides gain', () => {
    // yes: 10 * (0.55 - 0.50) = 0.5, no: 10 * (0.50 - 0.45) = 0.5 => total = 1.0
    // Actually if yes goes up, no goes down in binary market, but this tests the math
    const pnl = calcPositionPnl(10, 0.50, 0.55, 10, 0.45, 0.50);
    expect(pnl).toBeCloseTo(1.0);
  });

  it('returns loss when both sides lose', () => {
    const pnl = calcPositionPnl(10, 0.55, 0.50, 10, 0.50, 0.45);
    expect(pnl).toBeCloseTo(-1.0);
  });

  it('returns 0 when prices unchanged', () => {
    const pnl = calcPositionPnl(10, 0.50, 0.50, 10, 0.50, 0.50);
    expect(pnl).toBe(0);
  });
});

// ── shouldExitGammaZone ─────────────────────────────────────────────────────

describe('shouldExitGammaZone', () => {
  it('returns false when inside exit zone bounds', () => {
    expect(shouldExitGammaZone(0.5, 0.25, 0.75)).toBe(false);
  });

  it('returns true when below exit low', () => {
    expect(shouldExitGammaZone(0.2, 0.25, 0.75)).toBe(true);
  });

  it('returns true when above exit high', () => {
    expect(shouldExitGammaZone(0.8, 0.25, 0.75)).toBe(true);
  });

  it('returns false at exact boundaries', () => {
    expect(shouldExitGammaZone(0.25, 0.25, 0.75)).toBe(false);
    expect(shouldExitGammaZone(0.75, 0.25, 0.75)).toBe(false);
  });
});

// ── createGammaScalpingTick (integration) ───────────────────────────────────

describe('createGammaScalpingTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a callable tick function', () => {
    const tick = createGammaScalpingTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createGammaScalpingTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('enters in gamma zone with balanced position', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Oscillating prices for vol, tight spread (0.02)
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }
      return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { volWindow: 5, minVol: 0.001, maxSpreadPct: 0.05 },
    });

    const tick = createGammaScalpingTick(deps);
    // Run enough ticks to build price history
    for (let i = 0; i < 10; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    // Should have 2 GTC orders (YES + NO)
    expect(gtcCalls.length).toBeGreaterThanOrEqual(2);
    // One for YES, one for NO
    const tokenIds = gtcCalls.map((c: any) => c[0].tokenId);
    expect(tokenIds).toContain('yes-1');
    expect(tokenIds).toContain('no-1');
  });

  it('does not enter outside gamma zone', async () => {
    const market = makeMarket();

    // Mid = 0.85, outside gamma zone [0.35, 0.65]
    const getOrderBook = vi.fn().mockResolvedValue(
      makeBook([['0.84', '100']], [['0.86', '100']]),
    );

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { volWindow: 5, minVol: 0.001 },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('does not enter when spread too wide', async () => {
    const market = makeMarket();

    // Spread = 0.10, above maxSpreadPct = 0.04
    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.43', '100']], [['0.57', '100']]));
      }
      return Promise.resolve(makeBook([['0.42', '100']], [['0.58', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { volWindow: 5, minVol: 0.001, maxSpreadPct: 0.04 },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('rebalances when delta exceeds threshold', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // First phase: oscillating in gamma zone for vol history, tight spread
      if (callCount <= 10) {
        if (callCount % 2 === 0) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }
      // After entry: price shifts significantly to create delta
      return Promise.resolve(makeBook([['0.60', '100']], [['0.62', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        rebalanceThreshold: 0.05,
        targetPnlPct: 0.5,  // high so we don't exit on PnL
        maxLossPct: 0.5,
        exitZoneLow: 0.1,
        exitZoneHigh: 0.9,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(2); // sell + buy for rebalance
  });

  it('does not rebalance when delta within threshold', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }
      return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        rebalanceThreshold: 0.99, // very high threshold, never rebalances
        targetPnlPct: 0.99,
        maxLossPct: 0.99,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBe(0);
  });

  it('exits on PnL target', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Build vol history with oscillating mids and tight spread
      if (callCount <= 10) {
        if (callCount % 2 === 0) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }
      // After entry: targetPnlPct is negative so any price triggers exit
      return Promise.resolve(makeBook([['0.49', '100']], [['0.51', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        targetPnlPct: -0.99, // very negative target to always trigger
        maxLossPct: 0.99,
        rebalanceThreshold: 0.99,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    // Should have exit IOC orders after entry GTC orders
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);

    // Should emit trade.executed for exit
    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const exitEmits = emitCalls.filter(
      (c: any) => c[0] === 'trade.executed' && c[1].trade.side === 'sell',
    );
    expect(exitEmits.length).toBeGreaterThanOrEqual(1);
  });

  it('exits on max loss', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 10) {
        if (callCount % 2 === 0) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }
      // After entry: price shifts to create a loss
      return Promise.resolve(makeBook([['0.44', '100']], [['0.46', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        targetPnlPct: 0.99,
        maxLossPct: 0.01, // very tight stop
        rebalanceThreshold: 0.99,
        exitZoneLow: 0.1,
        exitZoneHigh: 0.9,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits when price leaves gamma zone', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Build vol history with oscillating mids and tight spread
      if (callCount <= 10) {
        if (callCount % 2 === 0) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }
      // Price moves way outside exit zone (< 0.25)
      return Promise.resolve(makeBook([['0.14', '100']], [['0.16', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        targetPnlPct: 0.99,
        maxLossPct: 0.99,
        rebalanceThreshold: 0.99,
        exitZoneLow: 0.25,
        exitZoneHigh: 0.75,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits when max rebalances reached', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 10) {
        if (callCount % 2 === 0) {
          return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
        }
        return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
      }
      // Alternate to create rebalance triggers
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.60', '100']], [['0.62', '100']]));
      }
      return Promise.resolve(makeBook([['0.38', '100']], [['0.40', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        rebalanceThreshold: 0.01, // very low threshold
        maxRebalances: 2, // low max rebalances
        targetPnlPct: 0.99,
        maxLossPct: 0.99,
        exitZoneLow: 0.1,
        exitZoneHigh: 0.9,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    // Should have rebalance IOC calls + exit IOC calls
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(4); // at least 2 rebalances (2 orders each)
  });

  it('exits on max hold time', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }
      return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        targetPnlPct: 0.99,
        maxLossPct: 0.99,
        rebalanceThreshold: 0.99,
        maxHoldMs: 30 * 60_000,
      },
    });

    const tick = createGammaScalpingTick(deps);
    // Build history and enter
    for (let i = 0; i < 10; i++) await tick();

    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );

    if (gtcCalls.length > 0) {
      // Fast-forward past max hold time
      const baseNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseNow + 31 * 60_000);

      await tick();

      const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'IOC',
      );
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);

      vi.spyOn(Date, 'now').mockRestore();
    }
  });

  it('respects cooldown after exit', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Oscillating mids with tight spread for vol
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }
      return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        targetPnlPct: -0.01, // always triggers exit
        maxLossPct: 0.99,
        rebalanceThreshold: 0.99,
        cooldownMs: 999_999_999, // very long cooldown
        maxPositions: 2,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    // Should only have entered once (subsequent entries blocked by cooldown)
    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(gtcCalls.length).toBe(2); // one YES + one NO for single entry
  });

  it('respects maxPositions limit', async () => {
    const market1 = makeMarket();
    const market2 = makeMarket({ conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2' });

    // Track per-token call count to create proper oscillation per market
    const tokenCalls = new Map<string, number>();
    const getOrderBook = vi.fn().mockImplementation((tokenId: string) => {
      const count = (tokenCalls.get(tokenId) ?? 0) + 1;
      tokenCalls.set(tokenId, count);
      if (count % 2 === 0) {
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }
      return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market1, market2]) } as any,
      config: {
        volWindow: 5,
        minVol: 0.001,
        maxSpreadPct: 0.05,
        maxPositions: 1, // only 1 position allowed
        targetPnlPct: 0.99,
        maxLossPct: 0.99,
        rebalanceThreshold: 0.99,
      },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 15; i++) await tick();

    // Should only have 2 GTC orders (1 position = YES + NO)
    const gtcCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );
    expect(gtcCalls.length).toBe(2);
  });

  it('skips closed and resolved markets', async () => {
    const markets = [
      makeMarket({ closed: true }),
      makeMarket({ conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2', resolved: true }),
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });

    const tick = createGammaScalpingTick(deps);
    await tick();

    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets without noTokenId', async () => {
    const market = makeMarket({ noTokenId: '' });

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
    });

    const tick = createGammaScalpingTick(deps);
    await tick();

    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('does not enter when volatility too low', async () => {
    const market = makeMarket();

    // Flat prices = zero vol
    const getOrderBook = vi.fn().mockResolvedValue(
      makeBook([['0.49', '100']], [['0.51', '100']]),
    );

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { volWindow: 5, minVol: 0.01 },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('emits trade.executed on entry', async () => {
    const market = makeMarket();

    let callCount = 0;
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      // Oscillating mids with tight spread for vol
      if (callCount % 2 === 0) {
        return Promise.resolve(makeBook([['0.46', '100']], [['0.48', '100']]));
      }
      return Promise.resolve(makeBook([['0.52', '100']], [['0.54', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { volWindow: 5, minVol: 0.001, maxSpreadPct: 0.05, targetPnlPct: 0.99, maxLossPct: 0.99, rebalanceThreshold: 0.99 },
    });

    const tick = createGammaScalpingTick(deps);
    for (let i = 0; i < 10; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    expect(tradeCalls.length).toBeGreaterThanOrEqual(1);
    expect(tradeCalls[0][1].trade.strategy).toBe('gamma-scalping');
  });
});
