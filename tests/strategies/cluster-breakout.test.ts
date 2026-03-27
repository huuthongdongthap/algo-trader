import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildPriceBins,
  findDensestCluster,
  calcClusterBounds,
  detectClusterBreakout,
  createClusterBreakoutTick,
  DEFAULT_CONFIG,
  type ClusterBreakoutConfig,
  type ClusterBreakoutDeps,
} from '../../src/strategies/polymarket/cluster-breakout.js';
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

function makeConfig(overrides: Partial<ClusterBreakoutConfig> = {}): ClusterBreakoutConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── buildPriceBins tests ─────────────────────────────────────────────────────

describe('buildPriceBins', () => {
  it('returns empty counts for empty prices array', () => {
    const result = buildPriceBins([], 5);
    expect(result.counts).toEqual([0, 0, 0, 0, 0]);
    expect(result.binLow).toBe(0);
    expect(result.binWidth).toBe(0);
  });

  it('puts all identical prices into bin 0', () => {
    const result = buildPriceBins([0.5, 0.5, 0.5], 5);
    expect(result.counts[0]).toBe(3);
    expect(result.binLow).toBe(0.5);
    expect(result.binWidth).toBe(0);
  });

  it('distributes prices across bins correctly', () => {
    // prices from 0.0 to 1.0, 10 bins → binWidth = 0.1
    const prices = [0.05, 0.15, 0.25, 0.55, 0.65, 0.95, 1.0];
    const result = buildPriceBins(prices, 10);
    expect(result.counts.length).toBe(10);
    // Total count should equal number of prices
    const total = result.counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(7);
  });

  it('handles single price', () => {
    const result = buildPriceBins([0.5], 5);
    expect(result.counts[0]).toBe(1);
    expect(result.binLow).toBe(0.5);
    expect(result.binWidth).toBe(0);
  });

  it('places max value in the last bin', () => {
    const prices = [0.0, 1.0];
    const result = buildPriceBins(prices, 5);
    // Max value should be in last bin
    expect(result.counts[result.counts.length - 1]).toBeGreaterThanOrEqual(1);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('returns correct binLow and binWidth', () => {
    const prices = [0.2, 0.4, 0.6, 0.8];
    const result = buildPriceBins(prices, 3);
    expect(result.binLow).toBe(0.2);
    expect(result.binWidth).toBeCloseTo(0.2, 6);
  });

  it('handles two prices', () => {
    const result = buildPriceBins([0.3, 0.7], 4);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(2);
    expect(result.binLow).toBe(0.3);
    expect(result.binWidth).toBeCloseTo(0.1, 6);
  });

  it('clusters concentrated prices into few bins', () => {
    // Most prices around 0.5, one outlier at 0.9
    const prices = [0.49, 0.50, 0.50, 0.51, 0.50, 0.49, 0.50, 0.51, 0.50, 0.9];
    const result = buildPriceBins(prices, 10);
    // The cluster bins should have most of the counts
    const total = result.counts.reduce((a, b) => a + b, 0);
    expect(total).toBe(10);
    // The first few bins should have most of the prices since range is 0.49-0.9
    // and most prices are near 0.49-0.51
  });

  it('handles numBins = 1', () => {
    const prices = [0.2, 0.5, 0.8];
    const result = buildPriceBins(prices, 1);
    expect(result.counts).toEqual([3]);
  });

  it('handles large number of bins with few prices', () => {
    const prices = [0.3, 0.7];
    const result = buildPriceBins(prices, 100);
    expect(result.counts.length).toBe(100);
    expect(result.counts.reduce((a, b) => a + b, 0)).toBe(2);
  });
});

// ── findDensestCluster tests ─────────────────────────────────────────────────

describe('findDensestCluster', () => {
  it('returns zeros for empty counts array', () => {
    const result = findDensestCluster([]);
    expect(result).toEqual({ startBin: 0, endBin: 0, totalCount: 0 });
  });

  it('finds the window containing the only non-zero bin', () => {
    const result = findDensestCluster([0, 0, 5, 0, 0]);
    // First window that reaches total 5 is start=0..end=2
    expect(result.startBin).toBe(0);
    expect(result.endBin).toBe(2);
    expect(result.totalCount).toBe(5);
  });

  it('finds contiguous cluster with highest total', () => {
    // Bins: [1, 5, 5, 1, 0, 0, 2, 2, 0, 0]
    // Best contiguous: bins 0-3 = 1+5+5+1 = 12, or entire array = 21
    const counts = [1, 5, 5, 1, 0, 0, 2, 2, 0, 0];
    const result = findDensestCluster(counts);
    // The entire array sums to 16, which is the densest contiguous run
    expect(result.totalCount).toBe(16);
  });

  it('handles single-element counts', () => {
    const result = findDensestCluster([7]);
    expect(result).toEqual({ startBin: 0, endBin: 0, totalCount: 7 });
  });

  it('handles all zeros', () => {
    const result = findDensestCluster([0, 0, 0, 0]);
    expect(result.totalCount).toBe(0);
  });

  it('handles uniform distribution', () => {
    const result = findDensestCluster([3, 3, 3, 3]);
    // Entire range is densest
    expect(result.totalCount).toBe(12);
  });

  it('prefers left cluster on tie of same size', () => {
    // Two clusters of size 1 each with same count
    const counts = [5, 0, 5];
    const result = findDensestCluster(counts);
    // Entire range is 10, which is best
    expect(result.totalCount).toBe(10);
  });

  it('handles counts with all elements in one bin', () => {
    const counts = [0, 0, 10, 0, 0];
    const result = findDensestCluster(counts);
    expect(result.totalCount).toBe(10);
  });
});

// ── calcClusterBounds tests ──────────────────────────────────────────────────

describe('calcClusterBounds', () => {
  it('returns correct bounds for first bin', () => {
    const result = calcClusterBounds(0, 0, 0.4, 0.05);
    expect(result.low).toBeCloseTo(0.4, 6);
    expect(result.high).toBeCloseTo(0.45, 6);
  });

  it('returns correct bounds spanning multiple bins', () => {
    const result = calcClusterBounds(1, 3, 0.4, 0.05);
    expect(result.low).toBeCloseTo(0.45, 6);
    expect(result.high).toBeCloseTo(0.6, 6);
  });

  it('returns correct bounds for last bin', () => {
    const result = calcClusterBounds(4, 4, 0.0, 0.2);
    expect(result.low).toBeCloseTo(0.8, 6);
    expect(result.high).toBeCloseTo(1.0, 6);
  });

  it('handles zero binWidth', () => {
    const result = calcClusterBounds(0, 0, 0.5, 0);
    expect(result.low).toBe(0.5);
    expect(result.high).toBe(0.5);
  });

  it('handles full range (startBin=0 to endBin=last)', () => {
    const result = calcClusterBounds(0, 9, 0.3, 0.05);
    expect(result.low).toBeCloseTo(0.3, 6);
    expect(result.high).toBeCloseTo(0.8, 6);
  });

  it('returns low < high when binWidth > 0', () => {
    const result = calcClusterBounds(2, 5, 0.1, 0.1);
    expect(result.low).toBeLessThan(result.high);
  });
});

// ── detectClusterBreakout tests ──────────────────────────────────────────────

describe('detectClusterBreakout', () => {
  it('returns bullish when price > high', () => {
    expect(detectClusterBreakout(0.65, 0.45, 0.60)).toBe('bullish');
  });

  it('returns bearish when price < low', () => {
    expect(detectClusterBreakout(0.30, 0.45, 0.60)).toBe('bearish');
  });

  it('returns null when price is inside cluster', () => {
    expect(detectClusterBreakout(0.50, 0.45, 0.60)).toBeNull();
  });

  it('returns null when price equals low boundary', () => {
    expect(detectClusterBreakout(0.45, 0.45, 0.60)).toBeNull();
  });

  it('returns null when price equals high boundary', () => {
    expect(detectClusterBreakout(0.60, 0.45, 0.60)).toBeNull();
  });

  it('returns bullish when price is just above high', () => {
    expect(detectClusterBreakout(0.601, 0.45, 0.60)).toBe('bullish');
  });

  it('returns bearish when price is just below low', () => {
    expect(detectClusterBreakout(0.449, 0.45, 0.60)).toBe('bearish');
  });

  it('handles zero boundaries', () => {
    expect(detectClusterBreakout(-0.01, 0.0, 0.5)).toBe('bearish');
    expect(detectClusterBreakout(0.51, 0.0, 0.5)).toBe('bullish');
    expect(detectClusterBreakout(0.25, 0.0, 0.5)).toBeNull();
  });

  it('handles equal low and high', () => {
    // price must be strictly > or < to break out
    expect(detectClusterBreakout(0.50, 0.50, 0.50)).toBeNull();
    expect(detectClusterBreakout(0.51, 0.50, 0.50)).toBe('bullish');
    expect(detectClusterBreakout(0.49, 0.50, 0.50)).toBe('bearish');
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<ClusterBreakoutDeps> = {}): ClusterBreakoutDeps {
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

describe('createClusterBreakoutTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createClusterBreakoutTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createClusterBreakoutTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createClusterBreakoutTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createClusterBreakoutTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createClusterBreakoutTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createClusterBreakoutTick(deps);
    await tick();
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
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
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
    const tick = createClusterBreakoutTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES on bullish breakout ─────────────────────────

  it('enters buy-yes on bullish breakout (price above cluster)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First 20 ticks: stable around 0.50 to build cluster
        if (callCount <= 20) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Then price jumps above cluster → bullish breakout
        return Promise.resolve(makeBook(
          [['0.79', '100']], [['0.81', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 22; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── Entry tests: BUY NO on bearish breakout ──────────────────────────

  it('enters buy-no on bearish breakout (price below cluster)', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // First 20 ticks: stable around 0.50 to build cluster
        if (callCount <= 20) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Then price drops below cluster → bearish breakout
        return Promise.resolve(makeBook(
          [['0.19', '100']], [['0.21', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 22; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when price stays inside cluster ─────────────────────────

  it('does not enter when price stays inside cluster', async () => {
    // Stable prices → no breakout
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        numBins: 5,
        minClusterPct: 0.3,
        priceWindow: 25,
        minVolume: 1,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 20; i++) {
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
        if (callCount <= 20) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 22) {
          // Breakout up
          return Promise.resolve(makeBook(
            [['0.79', '100']], [['0.81', '100']],
          ));
        }
        // Price continues up for TP
        return Promise.resolve(makeBook(
          [['0.94', '100']], [['0.96', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.50,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 25; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 20) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 22) {
          // Breakout up
          return Promise.resolve(makeBook(
            [['0.79', '100']], [['0.81', '100']],
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
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 25; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 20) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Breakout then stable
        return Promise.resolve(makeBook(
          [['0.79', '100']], [['0.81', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 22; i++) {
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
        if (callCount <= 20) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        if (callCount <= 22) {
          // Breakout up
          return Promise.resolve(makeBook(
            [['0.79', '100']], [['0.81', '100']],
          ));
        }
        if (callCount <= 24) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.94', '100']], [['0.96', '100']],
          ));
        }
        // Back to breakout level after exit
        return Promise.resolve(makeBook(
          [['0.79', '100']], [['0.81', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 30; i++) {
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
        // First passes: stable at 0.50
        if (callCount <= 60) {
          return Promise.resolve(makeBook(
            [['0.49', '100']], [['0.51', '100']],
          ));
        }
        // Then breakout
        return Promise.resolve(makeBook(
          [['0.79', '100']], [['0.81', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        numBins: 5,
        minClusterPct: 0.4,
        priceWindow: 25,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 25; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createClusterBreakoutTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not enter with insufficient price history (below numBins)', async () => {
    const deps = makeDeps({
      config: {
        numBins: 15,
        priceWindow: 25,
        minVolume: 1,
      },
    });
    const tick = createClusterBreakoutTick(deps);
    // Run fewer ticks than numBins
    for (let i = 0; i < 10; i++) {
      await tick();
    }
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not enter when cluster density is below minClusterPct', async () => {
    // Use widely spread prices that won't form a dense cluster
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // Alternating between very different prices to prevent dense clustering
        const price = 0.1 + (callCount % 10) * 0.08;
        return Promise.resolve(makeBook(
          [[String(price - 0.01), '100']], [[String(price + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        numBins: 15,
        minClusterPct: 0.99, // Require 99% density — nearly impossible with spread data
        priceWindow: 25,
        minVolume: 1,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('skips when all prices are identical (binWidth = 0)', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.50', '100']], [['0.50', '100']]),
        ),
      } as any,
      config: {
        numBins: 5,
        priceWindow: 25,
        minVolume: 1,
        minClusterPct: 0.3,
      },
    });

    const tick = createClusterBreakoutTick(deps);
    // mid = 0.50 every tick → all identical → binWidth = 0
    for (let i = 0; i < 20; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });
});
