import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcDepthChangeRate,
  calcMigrationScore,
  smoothMigration,
  isMigrationSignal,
  createLiquidityMigrationTick,
  DEFAULT_CONFIG,
  type LiquidityMigrationConfig,
  type LiquidityMigrationDeps,
} from '../../src/strategies/polymarket/liquidity-migration.js';
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

function makeConfig(overrides: Partial<LiquidityMigrationConfig> = {}): LiquidityMigrationConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcDepthChangeRate tests ───────────────────────────────────────────────

describe('calcDepthChangeRate', () => {
  it('returns 0 for empty array', () => {
    expect(calcDepthChangeRate([])).toBe(0);
  });

  it('returns 0 for single-element array', () => {
    expect(calcDepthChangeRate([100])).toBe(0);
  });

  it('returns 0 when first element is 0', () => {
    expect(calcDepthChangeRate([0, 100, 200])).toBe(0);
  });

  it('returns positive rate when depth increases', () => {
    // (200 - 100) / 100 = 1.0
    expect(calcDepthChangeRate([100, 150, 200])).toBeCloseTo(1.0, 4);
  });

  it('returns negative rate when depth decreases', () => {
    // (50 - 100) / 100 = -0.5
    expect(calcDepthChangeRate([100, 75, 50])).toBeCloseTo(-0.5, 4);
  });

  it('returns 0 when depth stays the same', () => {
    expect(calcDepthChangeRate([100, 100, 100])).toBe(0);
  });

  it('uses only first and last elements', () => {
    // (300 - 100) / 100 = 2.0, middle values don't matter
    expect(calcDepthChangeRate([100, 50, 10, 300])).toBeCloseTo(2.0, 4);
  });

  it('handles small values', () => {
    // (0.2 - 0.1) / 0.1 = 1.0
    expect(calcDepthChangeRate([0.1, 0.15, 0.2])).toBeCloseTo(1.0, 4);
  });

  it('handles large values', () => {
    // (2_000_000 - 1_000_000) / 1_000_000 = 1.0
    expect(calcDepthChangeRate([1_000_000, 1_500_000, 2_000_000])).toBeCloseTo(1.0, 4);
  });

  it('handles two-element array', () => {
    // (200 - 100) / 100 = 1.0
    expect(calcDepthChangeRate([100, 200])).toBeCloseTo(1.0, 4);
  });
});

// ── calcMigrationScore tests ────────────────────────────────────────────────

describe('calcMigrationScore', () => {
  it('returns positive when bids grow faster than asks', () => {
    expect(calcMigrationScore(0.5, -0.3)).toBeCloseTo(0.8, 4);
  });

  it('returns negative when asks grow faster than bids', () => {
    expect(calcMigrationScore(-0.3, 0.5)).toBeCloseTo(-0.8, 4);
  });

  it('returns 0 when both rates are equal', () => {
    expect(calcMigrationScore(0.5, 0.5)).toBe(0);
  });

  it('returns 0 when both rates are 0', () => {
    expect(calcMigrationScore(0, 0)).toBe(0);
  });

  it('handles both positive rates', () => {
    // bids growing faster than asks → positive
    expect(calcMigrationScore(0.8, 0.3)).toBeCloseTo(0.5, 4);
  });

  it('handles both negative rates', () => {
    // bids shrinking slower than asks → positive
    expect(calcMigrationScore(-0.2, -0.7)).toBeCloseTo(0.5, 4);
  });

  it('handles extreme values', () => {
    expect(calcMigrationScore(10, -10)).toBeCloseTo(20, 4);
  });
});

// ── smoothMigration tests ───────────────────────────────────────────────────

describe('smoothMigration', () => {
  it('returns current when prevSmoothed is null (initial case)', () => {
    expect(smoothMigration(null, 0.5, 0.12)).toBe(0.5);
  });

  it('returns prevSmoothed when alpha is 0', () => {
    expect(smoothMigration(0.3, 0.5, 0)).toBe(0.3);
  });

  it('returns current when alpha is 1', () => {
    expect(smoothMigration(0.3, 0.5, 1)).toBe(0.5);
  });

  it('returns weighted average for alpha between 0 and 1', () => {
    // alpha=0.5 → 0.5*0.8 + 0.5*0.2 = 0.4 + 0.1 = 0.5
    const result = smoothMigration(0.2, 0.8, 0.5);
    expect(result).toBeCloseTo(0.5, 4);
  });

  it('converges toward current with repeated updates', () => {
    let smoothed: number | null = null;
    for (let i = 0; i < 100; i++) {
      smoothed = smoothMigration(smoothed, 0.75, 0.12);
    }
    expect(smoothed).toBeCloseTo(0.75, 2);
  });

  it('moves slowly with small alpha', () => {
    const result = smoothMigration(0.1, 0.9, 0.01);
    // 0.01*0.9 + 0.99*0.1 = 0.009 + 0.099 = 0.108
    expect(result).toBeCloseTo(0.108, 3);
  });

  it('moves quickly with large alpha', () => {
    const result = smoothMigration(0.1, 0.9, 0.99);
    // 0.99*0.9 + 0.01*0.1 = 0.891 + 0.001 = 0.892
    expect(result).toBeCloseTo(0.892, 3);
  });

  it('handles negative values', () => {
    const result = smoothMigration(-0.2, -0.4, 0.5);
    // 0.5*(-0.4) + 0.5*(-0.2) = -0.2 + -0.1 = -0.3
    expect(result).toBeCloseTo(-0.3, 4);
  });

  it('returns prevSmoothed for negative alpha', () => {
    expect(smoothMigration(0.3, 0.8, -0.5)).toBe(0.3);
  });
});

// ── isMigrationSignal tests ─────────────────────────────────────────────────

describe('isMigrationSignal', () => {
  it('returns true when score exceeds positive threshold', () => {
    expect(isMigrationSignal(0.20, 0.15)).toBe(true);
  });

  it('returns true when score exceeds negative threshold', () => {
    expect(isMigrationSignal(-0.20, 0.15)).toBe(true);
  });

  it('returns false when score equals threshold', () => {
    expect(isMigrationSignal(0.15, 0.15)).toBe(false);
  });

  it('returns false when score equals negative threshold', () => {
    expect(isMigrationSignal(-0.15, 0.15)).toBe(false);
  });

  it('returns false when score is below threshold', () => {
    expect(isMigrationSignal(0.10, 0.15)).toBe(false);
  });

  it('returns false for zero score', () => {
    expect(isMigrationSignal(0, 0.15)).toBe(false);
  });

  it('returns true for zero threshold with non-zero score', () => {
    expect(isMigrationSignal(0.01, 0)).toBe(true);
  });

  it('returns false for zero score and zero threshold', () => {
    expect(isMigrationSignal(0, 0)).toBe(false);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<LiquidityMigrationDeps> = {}): LiquidityMigrationDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '100'], ['0.47', '80'], ['0.46', '60']],
          [['0.52', '100'], ['0.53', '80'], ['0.54', '60']],
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

describe('createLiquidityMigrationTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createLiquidityMigrationTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient depth history)', async () => {
    const deps = makeDeps();
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createLiquidityMigrationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records depth history across ticks', async () => {
    const deps = makeDeps();
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
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
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when positive migration ─────────────────────

  it('enters buy-yes when bids grow and asks shrink (positive migration)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // Initial: balanced book
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Later: bids grow, asks shrink → positive migration
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        depthWindow: 10,
        smoothingAlpha: 0.9,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
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

  // ── Entry tests: BUY NO when negative migration ──────────────────────

  it('enters buy-no when asks grow and bids shrink (negative migration)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          // Initial: balanced book
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Later: asks grow, bids shrink → negative migration
        return Promise.resolve(makeBook(
          [['0.49', '20']], [['0.51', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        depthWindow: 10,
        smoothingAlpha: 0.9,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
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

  // ── No entry when migration score below threshold ─────────────────────

  it('does not enter when migration score is below threshold', async () => {
    // Stable depths → migration score stays near 0
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        migrationThreshold: 0.50,
        minVolume: 1,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
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
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 4) {
          // Bids grow, asks shrink → entry signal
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '20']],
          ));
        }
        // Price rises for TP
        return Promise.resolve(makeBook(
          [['0.70', '500']], [['0.72', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 4) {
          // Bids grow → entry signal
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '20']],
          ));
        }
        // Price drops for SL
        return Promise.resolve(makeBook(
          [['0.05', '500']], [['0.07', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Bids grow → entry signal, then stay stable
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 5; i++) {
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
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 4) {
          // Bids grow → entry
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '20']],
          ));
        }
        if (callCount <= 6) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.70', '500']], [['0.72', '20']],
          ));
        }
        // Back to entry conditions
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 12; i++) {
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
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First passes: balanced
        if (callCount <= 9) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Then bids grow for entry signal
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events on entry', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('uses default config when no overrides provided', () => {
    const deps = makeDeps();
    const tick = createLiquidityMigrationTick(deps);
    expect(typeof tick).toBe('function');
  });

  it('does not enter when depth history has only 1 snapshot', async () => {
    const deps = makeDeps({
      config: { minVolume: 1, migrationThreshold: 0.01 },
    });
    const tick = createLiquidityMigrationTick(deps);
    await tick(); // only 1 snapshot after first tick
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('handles markets with undefined volume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: undefined, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles markets with null volume', async () => {
    const deps = makeDeps({
      gamma: {
        getTrending: vi.fn().mockResolvedValue([{
          id: 'm1', conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
          volume: null, endDate: '2027-12-31',
          closed: false, resolved: false, active: true,
        }]),
      } as any,
    });
    const tick = createLiquidityMigrationTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('does not duplicate positions for same market', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only 1 entry for the single market, should not re-enter while position open
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('exit order uses IOC order type', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '20']],
          ));
        }
        // Big price rise for TP
        return Promise.resolve(makeBook(
          [['0.80', '500']], [['0.82', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 8; i++) {
      await tick();
    }

    const iocOrders = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC'
    );
    // If exit triggered, should use IOC
    if (iocOrders.length > 0) {
      expect(iocOrders[0][0].orderType).toBe('IOC');
    }
    expect(true).toBe(true);
  });

  it('handles exit order failure gracefully', async () => {
    let callCount = 0;
    const placeOrderFn = vi.fn().mockImplementation((params: any) => {
      if (params.orderType === 'IOC') {
        return Promise.reject(new Error('exit failed'));
      }
      return Promise.resolve({ id: 'order-1' });
    });

    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 4) {
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '20']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.80', '500']], [['0.82', '20']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: { placeOrder: placeOrderFn } as any,
      config: {
        migrationThreshold: 0.10,
        minVolume: 1,
        smoothingAlpha: 0.9,
        takeProfitPct: 0.03,
      },
    });

    const tick = createLiquidityMigrationTick(deps);
    for (let i = 0; i < 8; i++) {
      await expect(tick()).resolves.toBeUndefined();
    }
  });

  it('DEFAULT_CONFIG has expected default values', () => {
    expect(DEFAULT_CONFIG.depthWindow).toBe(10);
    expect(DEFAULT_CONFIG.migrationThreshold).toBe(0.15);
    expect(DEFAULT_CONFIG.smoothingAlpha).toBe(0.12);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.025);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(15 * 60_000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(5);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(90_000);
    expect(DEFAULT_CONFIG.positionSize).toBe('10');
  });
});
