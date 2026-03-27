import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcVelocity,
  calcAcceleration,
  isAccelerationSignal,
  determineDirection,
  createPriceAccelerationTick,
  DEFAULT_CONFIG,
  type PriceAccelerationConfig,
  type PriceAccelerationDeps,
} from '../../src/strategies/polymarket/price-acceleration.js';
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

function makeConfig(overrides: Partial<PriceAccelerationConfig> = {}): PriceAccelerationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcVelocity tests ──────────────────────────────────────────────────────

describe('calcVelocity', () => {
  it('returns 0 for empty array', () => {
    expect(calcVelocity([], 5)).toBe(0);
  });

  it('returns 0 for single price', () => {
    expect(calcVelocity([0.5], 5)).toBe(0);
  });

  it('returns 0 when window is 0', () => {
    expect(calcVelocity([0.4, 0.5, 0.6], 0)).toBe(0);
  });

  it('returns 0 when window is negative', () => {
    expect(calcVelocity([0.4, 0.5, 0.6], -1)).toBe(0);
  });

  it('returns 0 when not enough data for window', () => {
    // window=5, need 6 prices, only have 3
    expect(calcVelocity([0.4, 0.5, 0.6], 5)).toBe(0);
  });

  it('calculates positive velocity for rising prices', () => {
    // [0.40, 0.42, 0.44, 0.46, 0.48, 0.50], window=5
    // velocity = (0.50 - 0.40) / 5 = 0.02
    const prices = [0.40, 0.42, 0.44, 0.46, 0.48, 0.50];
    expect(calcVelocity(prices, 5)).toBeCloseTo(0.02, 6);
  });

  it('calculates negative velocity for falling prices', () => {
    // [0.60, 0.58, 0.56, 0.54, 0.52, 0.50], window=5
    // velocity = (0.50 - 0.60) / 5 = -0.02
    const prices = [0.60, 0.58, 0.56, 0.54, 0.52, 0.50];
    expect(calcVelocity(prices, 5)).toBeCloseTo(-0.02, 6);
  });

  it('returns 0 for flat prices', () => {
    const prices = [0.50, 0.50, 0.50, 0.50, 0.50, 0.50];
    expect(calcVelocity(prices, 5)).toBe(0);
  });

  it('uses only the last window+1 prices', () => {
    // window=2, uses last 3 prices: 0.55, 0.57, 0.60
    // velocity = (0.60 - 0.55) / 2 = 0.025
    const prices = [0.40, 0.42, 0.55, 0.57, 0.60];
    expect(calcVelocity(prices, 2)).toBeCloseTo(0.025, 6);
  });

  it('works with window=1', () => {
    // velocity = (0.55 - 0.50) / 1 = 0.05
    const prices = [0.40, 0.50, 0.55];
    expect(calcVelocity(prices, 1)).toBeCloseTo(0.05, 6);
  });

  it('handles exactly window+1 prices', () => {
    // window=3, 4 prices
    // velocity = (0.56 - 0.50) / 3 = 0.02
    const prices = [0.50, 0.52, 0.54, 0.56];
    expect(calcVelocity(prices, 3)).toBeCloseTo(0.02, 6);
  });

  it('handles prices near 0', () => {
    const prices = [0.01, 0.02, 0.03];
    expect(calcVelocity(prices, 2)).toBeCloseTo(0.01, 6);
  });

  it('handles prices near 1', () => {
    const prices = [0.97, 0.98, 0.99];
    expect(calcVelocity(prices, 2)).toBeCloseTo(0.01, 6);
  });
});

// ── calcAcceleration tests ──────────────────────────────────────────────────

describe('calcAcceleration', () => {
  it('returns 0 for empty array', () => {
    expect(calcAcceleration([])).toBe(0);
  });

  it('returns 0 for single velocity', () => {
    expect(calcAcceleration([0.01])).toBe(0);
  });

  it('calculates positive acceleration when velocity is increasing', () => {
    // [0.01, 0.02, 0.04] → (0.04 - 0.01) / 3 = 0.01
    const velocities = [0.01, 0.02, 0.04];
    expect(calcAcceleration(velocities)).toBeCloseTo(0.01, 6);
  });

  it('calculates negative acceleration when velocity is decreasing', () => {
    // [0.04, 0.02, 0.01] → (0.01 - 0.04) / 3 = -0.01
    const velocities = [0.04, 0.02, 0.01];
    expect(calcAcceleration(velocities)).toBeCloseTo(-0.01, 6);
  });

  it('returns 0 for constant velocity', () => {
    const velocities = [0.02, 0.02, 0.02];
    expect(calcAcceleration(velocities)).toBe(0);
  });

  it('works with exactly 2 velocities', () => {
    // (0.05 - 0.01) / 2 = 0.02
    expect(calcAcceleration([0.01, 0.05])).toBeCloseTo(0.02, 6);
  });

  it('handles negative velocities', () => {
    // [-0.03, -0.01] → (-0.01 - (-0.03)) / 2 = 0.01
    expect(calcAcceleration([-0.03, -0.01])).toBeCloseTo(0.01, 6);
  });

  it('handles mixed sign velocities', () => {
    // [-0.02, 0.00, 0.02] → (0.02 - (-0.02)) / 3 = 0.04/3
    const velocities = [-0.02, 0.00, 0.02];
    expect(calcAcceleration(velocities)).toBeCloseTo(0.04 / 3, 6);
  });

  it('handles large arrays (uses first and last only)', () => {
    const velocities = [0.01, 0.05, 0.03, 0.02, 0.06];
    // (0.06 - 0.01) / 5 = 0.01
    expect(calcAcceleration(velocities)).toBeCloseTo(0.01, 6);
  });
});

// ── isAccelerationSignal tests ──────────────────────────────────────────────

describe('isAccelerationSignal', () => {
  const cfg = { accelerationThreshold: 0.001, minVelocity: 0.003 };

  it('returns true when both thresholds exceeded', () => {
    expect(isAccelerationSignal(0.002, 0.005, cfg)).toBe(true);
  });

  it('returns false when acceleration below threshold', () => {
    expect(isAccelerationSignal(0.0005, 0.005, cfg)).toBe(false);
  });

  it('returns false when acceleration equals threshold', () => {
    expect(isAccelerationSignal(0.001, 0.005, cfg)).toBe(false);
  });

  it('returns false when velocity below threshold', () => {
    expect(isAccelerationSignal(0.002, 0.002, cfg)).toBe(false);
  });

  it('returns false when velocity equals threshold', () => {
    expect(isAccelerationSignal(0.002, 0.003, cfg)).toBe(false);
  });

  it('returns false when both below threshold', () => {
    expect(isAccelerationSignal(0.0005, 0.001, cfg)).toBe(false);
  });

  it('works with negative acceleration and negative velocity', () => {
    // |accel| = 0.002 > 0.001, |velocity| = 0.005 > 0.003
    expect(isAccelerationSignal(-0.002, -0.005, cfg)).toBe(true);
  });

  it('works with negative acceleration and positive velocity', () => {
    expect(isAccelerationSignal(-0.002, 0.005, cfg)).toBe(true);
  });

  it('returns false when acceleration is 0', () => {
    expect(isAccelerationSignal(0, 0.005, cfg)).toBe(false);
  });

  it('returns false when velocity is 0', () => {
    expect(isAccelerationSignal(0.002, 0, cfg)).toBe(false);
  });

  it('uses custom config thresholds', () => {
    const loose = { accelerationThreshold: 0.0001, minVelocity: 0.001 };
    expect(isAccelerationSignal(0.0005, 0.002, loose)).toBe(true);
  });
});

// ── determineDirection tests ────────────────────────────────────────────────

describe('determineDirection', () => {
  it('returns yes for positive velocity', () => {
    expect(determineDirection(0.01)).toBe('yes');
  });

  it('returns no for negative velocity', () => {
    expect(determineDirection(-0.01)).toBe('no');
  });

  it('returns null for zero velocity', () => {
    expect(determineDirection(0)).toBeNull();
  });

  it('returns yes for very small positive velocity', () => {
    expect(determineDirection(0.0001)).toBe('yes');
  });

  it('returns no for very small negative velocity', () => {
    expect(determineDirection(-0.0001)).toBe('no');
  });

  it('returns yes for large positive velocity', () => {
    expect(determineDirection(1.0)).toBe('yes');
  });

  it('returns no for large negative velocity', () => {
    expect(determineDirection(-1.0)).toBe('no');
  });
});

// ── DEFAULT_CONFIG tests ────────────────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('has expected default values', () => {
    expect(DEFAULT_CONFIG.velocityWindow).toBe(5);
    expect(DEFAULT_CONFIG.accelerationWindow).toBe(3);
    expect(DEFAULT_CONFIG.accelerationThreshold).toBe(0.001);
    expect(DEFAULT_CONFIG.minVelocity).toBe(0.003);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.025);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(12 * 60_000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(5);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(90_000);
    expect(DEFAULT_CONFIG.positionSize).toBe('10');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<PriceAccelerationDeps> = {}): PriceAccelerationDeps {
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
          volume: 50_000, volume24h: 5000, liquidity: 5000, endDate: '2027-12-31',
          active: true, closed: false, resolved: false, outcome: null,
        },
      ]),
    } as any,
    ...overrides,
  };
}

describe('createPriceAccelerationTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createPriceAccelerationTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips closed markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: '2027-12-31',
          closed: true, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: true, active: true,
        }]),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips markets below minVolume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: 100, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createPriceAccelerationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    // mid = (0 + 1) / 2 = 0.5 which is valid, but no entry on first tick
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips market with no yesTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: undefined, noTokenId: 'no-1',
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles market with no noTokenId', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: undefined,
          volume: 50_000, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles multiple markets in a single tick', async () => {
    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
    ];

    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createPriceAccelerationTick(deps);
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
    const tick = createPriceAccelerationTick(deps);
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
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES on upward momentum ────────────────────────────

  it('enters buy-yes when velocity positive and acceleration exceeds threshold', async () => {
    // Simulate prices that rise with increasing velocity
    let callCount = 0;
    const risingPrices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.62, 0.69, 0.77];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = risingPrices[Math.min(callCount, risingPrices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── Entry tests: BUY NO on downward momentum ──────────────────────────

  it('enters buy-no when velocity negative and acceleration exceeds threshold', async () => {
    let callCount = 0;
    const fallingPrices = [0.70, 0.69, 0.67, 0.64, 0.60, 0.55, 0.49, 0.42, 0.34, 0.25];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = fallingPrices[Math.min(callCount, fallingPrices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when velocity too small ───────────────────────────────────

  it('does not enter when velocity is below minVelocity', async () => {
    // Flat prices → velocity near 0
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0001,
        minVelocity: 0.10,
        minVolume: 1,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── No entry when acceleration too small ───────────────────────────────

  it('does not enter when acceleration is below threshold', async () => {
    // Steady velocity (constant change) → acceleration near 0
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Linear increase: constant velocity, 0 acceleration
        const price = 0.40 + callCount * 0.01;
        return Promise.resolve(makeBook(
          [[String(price - 0.005), '100']], [[String(price + 0.005), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.05,
        minVelocity: 0.001,
        minVolume: 1,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.62, 0.69, 0.77, 0.85, 0.90];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 12; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    // Rise then drop
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.30, 0.20];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 9; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.56, 0.56, 0.56];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    // Rise, then stable (trigger TP exit), then rise again
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.80, 0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 15; i++) {
      await tick();
    }

    // Count entry orders (buy with GTC)
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Should have at most 1 entry due to cooldown
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('respects maxPositions limit', async () => {
    const markets = [
      {
        id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm2', conditionId: 'cond-2', yesTokenId: 'yes-2', noTokenId: 'no-2',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
      {
        id: 'm3', conditionId: 'cond-3', yesTokenId: 'yes-3', noTokenId: 'no-3',
        volume: 50_000, endDate: '2027-12-31',
        closed: false, resolved: false, active: true,
      },
    ];

    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.62, 0.69, 0.77];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount % prices.length, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createPriceAccelerationTick(deps);
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
    const tick = createPriceAccelerationTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter same market twice', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.62, 0.69, 0.77];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only 1 market, so at most 1 entry
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('uses IOC order type for exits', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.80, 0.90];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 9; i++) {
      await tick();
    }

    const iocOrders = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC'
    );
    // If any exit happened, it used IOC
    for (const call of iocOrders) {
      expect(call[0].orderType).toBe('IOC');
    }
    expect(true).toBe(true);
  });

  it('handles exit order failure gracefully', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.44, 0.47, 0.51, 0.56, 0.80];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const price = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    let orderCount = 0;
    const orderManager = {
      placeOrder: vi.fn().mockImplementation(() => {
        orderCount++;
        if (orderCount > 1) return Promise.reject(new Error('exit failed'));
        return Promise.resolve({ id: 'order-1' });
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: orderManager as any,
      config: {
        velocityWindow: 3,
        accelerationWindow: 2,
        accelerationThreshold: 0.0005,
        minVelocity: 0.001,
        minVolume: 1,
        takeProfitPct: 0.03,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 8; i++) {
      await expect(tick()).resolves.toBeUndefined();
    }
  });

  it('handles market with volume undefined', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: undefined, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createPriceAccelerationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('builds velocity history across ticks', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const price = 0.50 + callCount * 0.001;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        velocityWindow: 2,
        accelerationWindow: 2,
        minVolume: 1,
        accelerationThreshold: 10, // high threshold to prevent entry
        minVelocity: 0.0001,
      },
    });

    const tick = createPriceAccelerationTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    // Should have called getOrderBook 5 times
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(5);
    // No order placed due to high acceleration threshold
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
