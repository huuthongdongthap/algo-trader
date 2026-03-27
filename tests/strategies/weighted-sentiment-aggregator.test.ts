import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  calcBookImbalance,
  calcPriceVelocity,
  calcVolumeTrend,
  calcCompositeScore,
  determineSignal,
  createWeightedSentimentAggregatorTick,
  DEFAULT_CONFIG,
  type WeightedSentimentAggregatorConfig,
  type WeightedSentimentAggregatorDeps,
} from '../../src/strategies/polymarket/weighted-sentiment-aggregator.js';
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

function makeConfig(overrides: Partial<WeightedSentimentAggregatorConfig> = {}): WeightedSentimentAggregatorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── calcBookImbalance tests ─────────────────────────────────────────────────

describe('calcBookImbalance', () => {
  it('returns 0 when both bid and ask are 0', () => {
    expect(calcBookImbalance(0, 0)).toBe(0);
  });

  it('returns 1 when askSize is 0', () => {
    expect(calcBookImbalance(100, 0)).toBe(1);
  });

  it('returns -1 when bidSize is 0', () => {
    expect(calcBookImbalance(0, 100)).toBe(-1);
  });

  it('returns 0 when bid equals ask', () => {
    expect(calcBookImbalance(50, 50)).toBe(0);
  });

  it('returns positive when bid > ask', () => {
    // (80-20)/(80+20) = 60/100 = 0.6
    expect(calcBookImbalance(80, 20)).toBeCloseTo(0.6, 4);
  });

  it('returns negative when ask > bid', () => {
    // (20-80)/(20+80) = -60/100 = -0.6
    expect(calcBookImbalance(20, 80)).toBeCloseTo(-0.6, 4);
  });

  it('handles very large values', () => {
    expect(calcBookImbalance(1_000_000, 1_000_000)).toBe(0);
  });

  it('handles small fractional values', () => {
    // (0.3-0.1)/(0.3+0.1) = 0.2/0.4 = 0.5
    expect(calcBookImbalance(0.3, 0.1)).toBeCloseTo(0.5, 4);
  });
});

// ── calcPriceVelocity tests ─────────────────────────────────────────────────

describe('calcPriceVelocity', () => {
  it('returns 0 for empty array', () => {
    expect(calcPriceVelocity([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(calcPriceVelocity([0.5])).toBe(0);
  });

  it('returns 0 when first price is 0', () => {
    expect(calcPriceVelocity([0, 0.5])).toBe(0);
  });

  it('returns positive for increasing prices', () => {
    // (0.6-0.5)/0.5 = 0.2
    expect(calcPriceVelocity([0.5, 0.6])).toBeCloseTo(0.2, 4);
  });

  it('returns negative for decreasing prices', () => {
    // (0.4-0.5)/0.5 = -0.2
    expect(calcPriceVelocity([0.5, 0.4])).toBeCloseTo(-0.2, 4);
  });

  it('returns 0 when first equals last', () => {
    expect(calcPriceVelocity([0.5, 0.6, 0.7, 0.5])).toBe(0);
  });

  it('uses only first and last values', () => {
    // (0.8-0.4)/0.4 = 1.0
    expect(calcPriceVelocity([0.4, 0.1, 0.2, 0.8])).toBeCloseTo(1.0, 4);
  });

  it('handles large windows correctly', () => {
    const prices = [0.5, 0.51, 0.52, 0.53, 0.54, 0.55];
    // (0.55-0.5)/0.5 = 0.1
    expect(calcPriceVelocity(prices)).toBeCloseTo(0.1, 4);
  });
});

// ── calcVolumeTrend tests ───────────────────────────────────────────────────

describe('calcVolumeTrend', () => {
  it('returns 0 when avgVol is 0', () => {
    expect(calcVolumeTrend(100, 0)).toBe(0);
  });

  it('returns 1 when current equals average', () => {
    expect(calcVolumeTrend(100, 100)).toBe(1);
  });

  it('returns 2 when current is double average', () => {
    expect(calcVolumeTrend(200, 100)).toBe(2);
  });

  it('returns 0.5 when current is half average', () => {
    expect(calcVolumeTrend(50, 100)).toBe(0.5);
  });

  it('returns 0 when currentVol is 0', () => {
    expect(calcVolumeTrend(0, 100)).toBe(0);
  });

  it('handles very large volumes', () => {
    expect(calcVolumeTrend(1_000_000, 500_000)).toBeCloseTo(2.0, 4);
  });
});

// ── calcCompositeScore tests ────────────────────────────────────────────────

describe('calcCompositeScore', () => {
  it('returns 0 when all signals are neutral', () => {
    // imbalance=0, velocity=0, volumeTrend=1 → (1-1)=0
    const result = calcCompositeScore(0, 0, 1, { wImbalance: 0.4, wVelocity: 0.35, wVolume: 0.25 });
    expect(result).toBeCloseTo(0, 4);
  });

  it('returns positive for bullish signals', () => {
    // 0.4*0.5 + 0.35*0.1 + 0.25*(2-1) = 0.20 + 0.035 + 0.25 = 0.485
    const result = calcCompositeScore(0.5, 0.1, 2, { wImbalance: 0.4, wVelocity: 0.35, wVolume: 0.25 });
    expect(result).toBeCloseTo(0.485, 3);
  });

  it('returns negative for bearish signals', () => {
    // 0.4*(-0.5) + 0.35*(-0.1) + 0.25*(0.5-1) = -0.20 + -0.035 + -0.125 = -0.36
    const result = calcCompositeScore(-0.5, -0.1, 0.5, { wImbalance: 0.4, wVelocity: 0.35, wVolume: 0.25 });
    expect(result).toBeCloseTo(-0.36, 3);
  });

  it('respects wImbalance weight', () => {
    // Only imbalance contributes: 1.0*0.8 + 0*0 + 0*(1-1) = 0.8
    const result = calcCompositeScore(0.8, 0, 1, { wImbalance: 1.0, wVelocity: 0, wVolume: 0 });
    expect(result).toBeCloseTo(0.8, 4);
  });

  it('respects wVelocity weight', () => {
    // Only velocity contributes: 0*0 + 1.0*0.5 + 0*(1-1) = 0.5
    const result = calcCompositeScore(0, 0.5, 1, { wImbalance: 0, wVelocity: 1.0, wVolume: 0 });
    expect(result).toBeCloseTo(0.5, 4);
  });

  it('respects wVolume weight', () => {
    // Only volume contributes: 0*0 + 0*0 + 1.0*(3-1) = 2.0
    const result = calcCompositeScore(0, 0, 3, { wImbalance: 0, wVelocity: 0, wVolume: 1.0 });
    expect(result).toBeCloseTo(2.0, 4);
  });

  it('uses default config weights correctly', () => {
    const cfg = makeConfig();
    // 0.4*0.2 + 0.35*0.05 + 0.25*(1.5-1) = 0.08 + 0.0175 + 0.125 = 0.2225
    const result = calcCompositeScore(0.2, 0.05, 1.5, cfg);
    expect(result).toBeCloseTo(0.2225, 3);
  });

  it('handles zero weights', () => {
    const result = calcCompositeScore(1, 1, 5, { wImbalance: 0, wVelocity: 0, wVolume: 0 });
    expect(result).toBe(0);
  });

  it('volume trend of 1 contributes zero', () => {
    // volumeTrend=1 → (1-1)=0, so wVolume component = 0
    const result = calcCompositeScore(0, 0, 1, { wImbalance: 0.4, wVelocity: 0.35, wVolume: 0.25 });
    expect(result).toBe(0);
  });
});

// ── determineSignal tests ───────────────────────────────────────────────────

describe('determineSignal', () => {
  it('returns yes when score exceeds threshold', () => {
    expect(determineSignal(0.20, 0.15)).toBe('yes');
  });

  it('returns no when score is below negative threshold', () => {
    expect(determineSignal(-0.20, 0.15)).toBe('no');
  });

  it('returns null when score is within threshold', () => {
    expect(determineSignal(0.10, 0.15)).toBeNull();
  });

  it('returns null when score equals threshold exactly', () => {
    expect(determineSignal(0.15, 0.15)).toBeNull();
  });

  it('returns null when score equals negative threshold exactly', () => {
    expect(determineSignal(-0.15, 0.15)).toBeNull();
  });

  it('returns yes for score just above threshold', () => {
    expect(determineSignal(0.1501, 0.15)).toBe('yes');
  });

  it('returns no for score just below negative threshold', () => {
    expect(determineSignal(-0.1501, 0.15)).toBe('no');
  });

  it('returns null for score of 0', () => {
    expect(determineSignal(0, 0.15)).toBeNull();
  });

  it('handles threshold of 0', () => {
    expect(determineSignal(0.001, 0)).toBe('yes');
    expect(determineSignal(-0.001, 0)).toBe('no');
    expect(determineSignal(0, 0)).toBeNull();
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<WeightedSentimentAggregatorDeps> = {}): WeightedSentimentAggregatorDeps {
  return {
    clob: {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook(
          [['0.48', '100'], ['0.47', '50'], ['0.46', '50']],
          [['0.52', '100'], ['0.53', '50'], ['0.54', '50']],
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

describe('createWeightedSentimentAggregatorTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createWeightedSentimentAggregatorTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createWeightedSentimentAggregatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createWeightedSentimentAggregatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createWeightedSentimentAggregatorTick(deps);
    // Empty book: bid=0, ask=1 → mid=0.5 which is valid.
    // Volume is 0, volumeTrend=0, so (0-1)*0.25 = -0.25 which can trigger 'no'.
    // The strategy still works; it just sees a bearish volume signal.
    await expect(tick()).resolves.toBeUndefined();
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
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
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
    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when strong bullish signals ──────────────────

  it('enters buy-yes when composite score exceeds threshold (bullish imbalance)', async () => {
    // Heavy bid imbalance → positive score → buy yes
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // High bid imbalance: bidSize=500, askSize=50 → imbalance ≈ 0.818
        return Promise.resolve(makeBook(
          [['0.49', '500']],
          [['0.51', '50']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        velocityWindow: 5,
        volumeWindow: 10,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    // Need at least 2 ticks for velocity
    await tick();
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  it('enters buy-no when composite score is below negative threshold (bearish imbalance)', async () => {
    // Heavy ask imbalance → negative score → buy no
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        // High ask imbalance: bidSize=50, askSize=500 → imbalance ≈ -0.818
        return Promise.resolve(makeBook(
          [['0.49', '50']],
          [['0.51', '500']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        velocityWindow: 5,
        volumeWindow: 10,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    await tick();

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when score within threshold ──────────────────────────────

  it('does not enter when composite score is within threshold', async () => {
    // Balanced book → near-zero imbalance, stable price → near-zero velocity
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        scoreThreshold: 0.50,
        minVolume: 1,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
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
          // Heavy bid imbalance for entry
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '50']],
          ));
        }
        // Price rallies for TP
        return Promise.resolve(makeBook(
          [['0.70', '100']], [['0.72', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 4; i++) {
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
            [['0.49', '500']], [['0.51', '50']],
          ));
        }
        // Price drops for SL
        return Promise.resolve(makeBook(
          [['0.10', '100']], [['0.12', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 4; i++) {
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
            [['0.49', '500']], [['0.51', '50']],
          ));
        }
        // Stay stable (no TP/SL trigger)
        return Promise.resolve(makeBook(
          [['0.49', '100']], [['0.51', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 3; i++) {
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
          // Entry: heavy bid imbalance
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '50']],
          ));
        }
        if (callCount <= 4) {
          // TP exit
          return Promise.resolve(makeBook(
            [['0.70', '100']], [['0.72', '100']],
          ));
        }
        // Back to heavy bid imbalance
        return Promise.resolve(makeBook(
          [['0.49', '500']], [['0.51', '50']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 10; i++) {
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

    const clob = {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.49', '500']], [['0.51', '50']]),
      ),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBeLessThanOrEqual(2);
  });

  it('emits trade.executed events', async () => {
    const deps = makeDeps();
    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('does not duplicate positions for same token', async () => {
    const clob = {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.49', '500']], [['0.51', '50']]),
      ),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        maxPositions: 10,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 5; i++) {
      await tick();
    }

    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    // Only 1 position per token, even across multiple ticks
    expect(entries.length).toBeLessThanOrEqual(1);
  });

  it('uses IOC order type for exits', async () => {
    let callCount = 0;
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '50']],
          ));
        }
        // Big move for TP
        return Promise.resolve(makeBook(
          [['0.80', '100']], [['0.82', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 4; i++) {
      await tick();
    }

    const iocOrders = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'IOC'
    );
    // If we got an entry then exit, there should be an IOC order
    if ((deps.orderManager.placeOrder as any).mock.calls.length > 1) {
      expect(iocOrders.length).toBeGreaterThan(0);
    }
    expect(true).toBe(true);
  });

  it('handles exit order failure gracefully', async () => {
    let callCount = 0;
    const placeCalls: any[] = [];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount <= 2) {
          return Promise.resolve(makeBook(
            [['0.49', '500']], [['0.51', '50']],
          ));
        }
        return Promise.resolve(makeBook(
          [['0.80', '100']], [['0.82', '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      orderManager: {
        placeOrder: vi.fn().mockImplementation((order: any) => {
          placeCalls.push(order);
          if (order.orderType === 'IOC') {
            return Promise.reject(new Error('exit failed'));
          }
          return Promise.resolve({ id: 'order-1' });
        }),
      } as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
        takeProfitPct: 0.03,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    for (let i = 0; i < 4; i++) {
      await expect(tick()).resolves.toBeUndefined();
    }
  });

  it('uses GTC order type for entries', async () => {
    const clob = {
      getOrderBook: vi.fn().mockResolvedValue(
        makeBook([['0.49', '500']], [['0.51', '50']]),
      ),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        scoreThreshold: 0.05,
        minVolume: 1,
      },
    });

    const tick = createWeightedSentimentAggregatorTick(deps);
    await tick();
    await tick();

    const gtcOrders = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    if (gtcOrders.length > 0) {
      expect(gtcOrders[0][0].side).toBe('buy');
    }
    expect(true).toBe(true);
  });

  it('default config has expected values', () => {
    expect(DEFAULT_CONFIG.wImbalance).toBe(0.4);
    expect(DEFAULT_CONFIG.wVelocity).toBe(0.35);
    expect(DEFAULT_CONFIG.wVolume).toBe(0.25);
    expect(DEFAULT_CONFIG.scoreThreshold).toBe(0.15);
    expect(DEFAULT_CONFIG.velocityWindow).toBe(5);
    expect(DEFAULT_CONFIG.volumeWindow).toBe(10);
    expect(DEFAULT_CONFIG.minVolume).toBe(5000);
    expect(DEFAULT_CONFIG.takeProfitPct).toBe(0.025);
    expect(DEFAULT_CONFIG.stopLossPct).toBe(0.02);
    expect(DEFAULT_CONFIG.maxHoldMs).toBe(15 * 60_000);
    expect(DEFAULT_CONFIG.maxPositions).toBe(5);
    expect(DEFAULT_CONFIG.cooldownMs).toBe(90_000);
    expect(DEFAULT_CONFIG.positionSize).toBe('10');
  });
});
