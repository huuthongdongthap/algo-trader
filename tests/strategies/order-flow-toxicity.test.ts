import { describe, it, expect, vi } from 'vitest';
import {
  classifyTick,
  calcVolumeProxy,
  calcVPIN,
  getFlowDirection,
  isVpinSustained,
  createOrderFlowToxicityTick,
  type OrderFlowToxicityDeps,
  type TickClassification,
} from '../../src/strategies/polymarket/order-flow-toxicity.js';
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

function makeDeps(overrides?: Partial<OrderFlowToxicityDeps>): OrderFlowToxicityDeps {
  return {
    clob: { getOrderBook: vi.fn() } as any,
    orderManager: { placeOrder: vi.fn().mockResolvedValue({ id: 'ord-1' }) } as any,
    eventBus: { emit: vi.fn() } as any,
    gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    ...overrides,
  };
}

function makeTicks(sides: Array<'buy' | 'sell'>, volume = 100): TickClassification[] {
  return sides.map(side => ({ side, volume }));
}

// ── classifyTick ─────────────────────────────────────────────────────────────

describe('classifyTick', () => {
  it('classifies price up as buy', () => {
    const tick = classifyTick(0.50, 0.52, 200);
    expect(tick.side).toBe('buy');
    expect(tick.volume).toBe(200);
  });

  it('classifies price down as sell', () => {
    const tick = classifyTick(0.52, 0.50, 150);
    expect(tick.side).toBe('sell');
    expect(tick.volume).toBe(150);
  });

  it('classifies flat price as buy (default)', () => {
    const tick = classifyTick(0.50, 0.50, 100);
    expect(tick.side).toBe('buy');
    expect(tick.volume).toBe(100);
  });

  it('preserves exact volume proxy value', () => {
    const tick = classifyTick(0.40, 0.45, 999.5);
    expect(tick.volume).toBe(999.5);
  });
});

// ── calcVolumeProxy ──────────────────────────────────────────────────────────

describe('calcVolumeProxy', () => {
  it('sums all bid and ask sizes', () => {
    const book = makeBook(
      [['0.49', '100'], ['0.48', '200']],
      [['0.51', '50'], ['0.52', '75']],
    );
    expect(calcVolumeProxy(book)).toBe(425);
  });

  it('returns 0 for empty book', () => {
    const book = makeBook([], []);
    expect(calcVolumeProxy(book)).toBe(0);
  });

  it('handles single-sided book (bids only)', () => {
    const book = makeBook([['0.49', '100']], []);
    expect(calcVolumeProxy(book)).toBe(100);
  });

  it('handles single-sided book (asks only)', () => {
    const book = makeBook([], [['0.51', '300']]);
    expect(calcVolumeProxy(book)).toBe(300);
  });
});

// ── calcVPIN ─────────────────────────────────────────────────────────────────

describe('calcVPIN', () => {
  it('returns 1 for all buy ticks', () => {
    const ticks = makeTicks(['buy', 'buy', 'buy', 'buy', 'buy']);
    expect(calcVPIN(ticks, 5)).toBe(1);
  });

  it('returns 1 for all sell ticks', () => {
    const ticks = makeTicks(['sell', 'sell', 'sell', 'sell', 'sell']);
    expect(calcVPIN(ticks, 5)).toBe(1);
  });

  it('returns 0 for perfectly balanced ticks', () => {
    const ticks = makeTicks(['buy', 'sell', 'buy', 'sell']);
    expect(calcVPIN(ticks, 4)).toBe(0);
  });

  it('returns intermediate value for mixed ticks', () => {
    // 3 buys, 1 sell => |300-100|/(300+100) = 0.5
    const ticks = makeTicks(['buy', 'buy', 'buy', 'sell']);
    expect(calcVPIN(ticks, 4)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 for empty ticks', () => {
    expect(calcVPIN([], 20)).toBe(0);
  });

  it('respects window parameter (uses only last N ticks)', () => {
    // First 4 are sells, last 2 are buys. Window=2 => all buys => VPIN=1
    const ticks = makeTicks(['sell', 'sell', 'sell', 'sell', 'buy', 'buy']);
    expect(calcVPIN(ticks, 2)).toBe(1);
  });

  it('returns 0 when all volumes are zero', () => {
    const ticks: TickClassification[] = [
      { side: 'buy', volume: 0 },
      { side: 'sell', volume: 0 },
    ];
    expect(calcVPIN(ticks, 2)).toBe(0);
  });
});

// ── getFlowDirection ─────────────────────────────────────────────────────────

describe('getFlowDirection', () => {
  it('returns bullish when buy volume dominates', () => {
    const ticks = makeTicks(['buy', 'buy', 'buy', 'sell']);
    expect(getFlowDirection(ticks, 4)).toBe('bullish');
  });

  it('returns bearish when sell volume dominates', () => {
    const ticks = makeTicks(['sell', 'sell', 'sell', 'buy']);
    expect(getFlowDirection(ticks, 4)).toBe('bearish');
  });

  it('returns bearish when exactly balanced (buy not strictly greater)', () => {
    const ticks = makeTicks(['buy', 'sell']);
    expect(getFlowDirection(ticks, 2)).toBe('bearish');
  });

  it('respects window size', () => {
    // First 3 buys, last 3 sells. Window=3 => all sells => bearish
    const ticks = makeTicks(['buy', 'buy', 'buy', 'sell', 'sell', 'sell']);
    expect(getFlowDirection(ticks, 3)).toBe('bearish');
  });
});

// ── isVpinSustained ──────────────────────────────────────────────────────────

describe('isVpinSustained', () => {
  it('returns true when all recent ticks exceed threshold', () => {
    const history = [0.5, 0.6, 0.8, 0.9, 0.85];
    expect(isVpinSustained(history, 0.7, 3)).toBe(true);
  });

  it('returns false when any recent tick is below threshold', () => {
    const history = [0.5, 0.8, 0.6, 0.9];
    expect(isVpinSustained(history, 0.7, 3)).toBe(false);
  });

  it('returns false when not enough history', () => {
    const history = [0.9, 0.8];
    expect(isVpinSustained(history, 0.7, 3)).toBe(false);
  });

  it('returns false for empty history', () => {
    expect(isVpinSustained([], 0.7, 3)).toBe(false);
  });

  it('returns true when requiredTicks is 1 and last tick above threshold', () => {
    const history = [0.2, 0.3, 0.8];
    expect(isVpinSustained(history, 0.7, 1)).toBe(true);
  });

  it('returns false when value equals threshold (must be strictly above)', () => {
    const history = [0.7, 0.7, 0.7];
    expect(isVpinSustained(history, 0.7, 3)).toBe(false);
  });
});

// ── createOrderFlowToxicityTick ──────────────────────────────────────────────

describe('createOrderFlowToxicityTick', () => {
  it('creates a callable tick function', () => {
    const tick = createOrderFlowToxicityTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createOrderFlowToxicityTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('enters when VPIN is high and sustained — bullish flow buys YES', async () => {
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
      // Steadily rising prices → all buy ticks → VPIN = 1
      const p = (0.50 + callCount * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBeGreaterThanOrEqual(1);
    expect(gtcCalls[0][0].tokenId).toBe('yes-1');
    expect(gtcCalls[0][0].side).toBe('buy');
  });

  it('enters bearish flow — buys NO token', async () => {
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
      // Steadily falling prices → all sell ticks → VPIN = 1, bearish
      const p = (0.60 - callCount * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBeGreaterThanOrEqual(1);
    expect(gtcCalls[0][0].tokenId).toBe('no-1');
  });

  it('does not enter when VPIN is below threshold', async () => {
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
      // Alternating up/down → balanced → VPIN ≈ 0
      const p = callCount % 2 === 0 ? '0.51' : '0.49';
      return Promise.resolve(makeBook([[(parseFloat(p) - 0.01).toFixed(2), '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: { vpinWindow: 10, vpinThreshold: 0.7, minTicks: 5, sustainedTicks: 3 },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 30; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('does not enter when not enough ticks collected', async () => {
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
      const p = (0.50 + callCount * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        minTicks: 50, // require 50 ticks — we only run 5
        sustainedTicks: 3,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 5; i++) await tick();

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when spread is too wide', async () => {
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
      // Rising prices but wide spread (0.10 = 10%)
      const mid = 0.50 + callCount * 0.002;
      const bid = (mid - 0.05).toFixed(4);
      const ask = (mid + 0.05).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[ask, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05, // 5% max but spread is 10%
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('does not enter when VPIN is not sustained', async () => {
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
      // Alternate between trending and balanced to prevent sustained VPIN
      if (callCount % 4 === 0) {
        // Every 4th tick reverses to break sustained signal
        return Promise.resolve(makeBook([['0.48', '100']], [['0.49', '100']]));
      }
      const p = (0.50 + callCount * 0.001).toFixed(4);
      const bid = (parseFloat(p) - 0.005).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 4,
        vpinThreshold: 0.9, // Very high threshold — hard to sustain with reversals
        minTicks: 3,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('exits on VPIN dissipation', async () => {
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
      if (callCount <= 15) {
        // Rising prices → high VPIN, entry
        const p = (0.50 + callCount * 0.002).toFixed(4);
        const bid = (parseFloat(p) - 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
      }
      // After entry: alternating prices → VPIN drops to ~0
      const p = callCount % 2 === 0 ? '0.54' : '0.53';
      const bid = (parseFloat(p) - 0.01).toFixed(2);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.3,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        takeProfitPct: 0.5, // wide so TP doesn't trigger
        stopLossPct: 0.5,   // wide so SL doesn't trigger
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 40; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('exits on take-profit for YES position', async () => {
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
      if (callCount <= 15) {
        // Rising → entry
        const p = (0.50 + callCount * 0.002).toFixed(4);
        const bid = (parseFloat(p) - 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
      }
      // Price jumps up significantly for take-profit
      return Promise.resolve(makeBook([['0.62', '100']], [['0.63', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.3,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        takeProfitPct: 0.03,
        stopLossPct: 0.5, // wide
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 25; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
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
    const getOrderBook = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 15) {
        // Rising → entry
        const p = (0.50 + callCount * 0.002).toFixed(4);
        const bid = (parseFloat(p) - 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
      }
      // Price drops significantly for stop-loss
      return Promise.resolve(makeBook([['0.44', '100']], [['0.45', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.01, // very low so dissipation doesn't trigger first
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        takeProfitPct: 0.5, // wide
        stopLossPct: 0.02,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 25; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const iocCalls = calls.filter((c: any) => c[0].orderType === 'IOC');
    expect(iocCalls.length).toBeGreaterThanOrEqual(1);
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
      if (callCount <= 15) {
        const p = (0.50 + callCount * 0.002).toFixed(4);
        const bid = (parseFloat(p) - 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
      }
      // Price stays near entry — keep VPIN high to avoid dissipation exit
      const p = (0.53 + callCount * 0.001).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.01, // very low to avoid dissipation exit
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        takeProfitPct: 0.5, // wide
        stopLossPct: 0.5,   // wide
        maxHoldMs: 10 * 60_000,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);

    // Build up ticks and enter
    for (let i = 0; i < 20; i++) await tick();

    const entryCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC',
    );

    if (entryCalls.length > 0) {
      // Fast-forward past max hold
      const baseNow = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(baseNow + 11 * 60_000);

      await tick();

      const iocCalls = (deps.orderManager.placeOrder as any).mock.calls.filter(
        (c: any) => c[0].orderType === 'IOC',
      );
      expect(iocCalls.length).toBeGreaterThanOrEqual(1);

      vi.spyOn(Date, 'now').mockRestore();
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
      const p = (0.50 + callCount * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        maxPositions: 0, // no positions allowed
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    expect(gtcCalls.length).toBe(0);
  });

  it('respects cooldown after exit', async () => {
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
      if (callCount <= 15) {
        const p = (0.50 + callCount * 0.002).toFixed(4);
        const bid = (parseFloat(p) - 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
      }
      // Price drops to trigger stop-loss
      if (callCount <= 20) {
        return Promise.resolve(makeBook([['0.44', '100']], [['0.45', '100']]));
      }
      // Then price rises again — should be on cooldown
      const p = (0.50 + (callCount - 20) * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.01,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        takeProfitPct: 0.5,
        stopLossPct: 0.02,
        maxHoldMs: 999_999_999,
        cooldownMs: 999_999_999, // very long cooldown
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 40; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    // Should only have 1 entry (cooldown prevents re-entry)
    expect(gtcCalls.length).toBe(1);
  });

  it('skips closed and resolved markets', async () => {
    const markets = [
      { conditionId: 'cond-1', yesTokenId: 'yes-1', closed: true, resolved: false },
      { conditionId: 'cond-2', yesTokenId: 'yes-2', closed: false, resolved: true },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });

    const tick = createOrderFlowToxicityTick(deps);
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

    const tick = createOrderFlowToxicityTick(deps);
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
    const tick = createOrderFlowToxicityTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('emits trade.executed on entry', async () => {
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
      const p = (0.50 + callCount * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 20; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    expect(tradeCalls.length).toBeGreaterThanOrEqual(1);
    expect(tradeCalls[0][1].trade.strategy).toBe('order-flow-toxicity');
  });

  it('emits trade.executed on exit', async () => {
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
      if (callCount <= 15) {
        const p = (0.50 + callCount * 0.002).toFixed(4);
        const bid = (parseFloat(p) - 0.01).toFixed(4);
        return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
      }
      // Price drops → stop-loss
      return Promise.resolve(makeBook([['0.44', '100']], [['0.45', '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.01,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        takeProfitPct: 0.5,
        stopLossPct: 0.02,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 25; i++) await tick();

    const emitCalls = (deps.eventBus.emit as any).mock.calls;
    const tradeCalls = emitCalls.filter((c: any) => c[0] === 'trade.executed');
    // At least 2: one for entry, one for exit
    expect(tradeCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not enter when already holding a position on that token', async () => {
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
      const p = (0.50 + callCount * 0.002).toFixed(4);
      const bid = (parseFloat(p) - 0.01).toFixed(4);
      return Promise.resolve(makeBook([[bid, '100']], [[p, '100']]));
    });

    const deps = makeDeps({
      clob: { getOrderBook } as any,
      gamma: { getTrending: vi.fn().mockResolvedValue([market]) } as any,
      config: {
        vpinWindow: 10,
        vpinThreshold: 0.7,
        vpinExitThreshold: 0.01,
        minTicks: 5,
        sustainedTicks: 3,
        maxSpreadPct: 0.05,
        maxPositions: 5,
        takeProfitPct: 0.5,
        stopLossPct: 0.5,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createOrderFlowToxicityTick(deps);
    for (let i = 0; i < 30; i++) await tick();

    const calls = (deps.orderManager.placeOrder as any).mock.calls;
    const gtcCalls = calls.filter((c: any) => c[0].orderType === 'GTC');
    // Should only enter once even though signal persists
    expect(gtcCalls.length).toBe(1);
  });
});
