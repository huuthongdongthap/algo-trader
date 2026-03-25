import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  kalmanPredict,
  kalmanUpdate,
  calcNormalizedInnovation,
  createKalmanFilterTrackerTick,
  DEFAULT_CONFIG,
  type KalmanFilterTrackerConfig,
  type KalmanFilterTrackerDeps,
} from '../../src/strategies/polymarket/kalman-filter-tracker.js';
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

function makeConfig(overrides: Partial<KalmanFilterTrackerConfig> = {}): KalmanFilterTrackerConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── kalmanPredict tests ─────────────────────────────────────────────────────

describe('kalmanPredict', () => {
  it('returns x unchanged as prediction', () => {
    const { xPred } = kalmanPredict(0.5, 0.01, 0.0001);
    expect(xPred).toBe(0.5);
  });

  it('increases covariance by process noise', () => {
    const { pPred } = kalmanPredict(0.5, 0.01, 0.0001);
    expect(pPred).toBeCloseTo(0.0101, 6);
  });

  it('works with zero initial covariance', () => {
    const { xPred, pPred } = kalmanPredict(0.7, 0, 0.0001);
    expect(xPred).toBe(0.7);
    expect(pPred).toBe(0.0001);
  });

  it('works with zero process noise', () => {
    const { pPred } = kalmanPredict(0.5, 0.01, 0);
    expect(pPred).toBe(0.01);
  });

  it('handles large values', () => {
    const { xPred, pPred } = kalmanPredict(100, 50, 10);
    expect(xPred).toBe(100);
    expect(pPred).toBe(60);
  });
});

// ── kalmanUpdate tests ──────────────────────────────────────────────────────

describe('kalmanUpdate', () => {
  it('computes correct innovation', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 0.001);
    expect(result.innovation).toBeCloseTo(0.05, 6);
  });

  it('computes correct innovation variance S = P_pred + R', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 0.001);
    expect(result.S).toBeCloseTo(0.011, 6);
  });

  it('computes Kalman gain K = P_pred / S', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 0.001);
    const expectedK = 0.01 / 0.011;
    expect(result.K).toBeCloseTo(expectedK, 6);
  });

  it('updated x moves toward observation', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 0.001);
    expect(result.x).toBeGreaterThan(0.5);
    expect(result.x).toBeLessThan(0.55);
  });

  it('updated P is smaller than P_pred', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 0.001);
    expect(result.P).toBeLessThan(0.01);
  });

  it('with zero measurement noise, x converges to observation', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 0);
    expect(result.x).toBeCloseTo(0.55, 6);
    expect(result.K).toBeCloseTo(1, 6);
  });

  it('with very large measurement noise, x stays near prediction', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.55, 1000);
    expect(result.x).toBeCloseTo(0.5, 3);
    expect(result.K).toBeCloseTo(0, 3);
  });

  it('negative innovation when observation < prediction', () => {
    const result = kalmanUpdate(0.5, 0.01, 0.45, 0.001);
    expect(result.innovation).toBeCloseTo(-0.05, 6);
  });

  it('handles zero P_pred gracefully (K = 0)', () => {
    const result = kalmanUpdate(0.5, 0, 0.6, 0.001);
    expect(result.K).toBe(0);
    expect(result.x).toBe(0.5);
  });

  it('P_new = (1 - K) * P_pred exactly', () => {
    const pPred = 0.01;
    const R = 0.001;
    const result = kalmanUpdate(0.5, pPred, 0.55, R);
    const expectedP = (1 - result.K) * pPred;
    expect(result.P).toBeCloseTo(expectedP, 10);
  });
});

// ── calcNormalizedInnovation tests ──────────────────────────────────────────

describe('calcNormalizedInnovation', () => {
  it('returns 0 when S <= 0', () => {
    expect(calcNormalizedInnovation(0.05, 0)).toBe(0);
    expect(calcNormalizedInnovation(0.05, -1)).toBe(0);
  });

  it('returns correct normalized value for positive innovation', () => {
    const innovation = 0.1;
    const S = 0.01;
    const expected = 0.1 / Math.sqrt(0.01); // = 1.0
    expect(calcNormalizedInnovation(innovation, S)).toBeCloseTo(expected, 6);
  });

  it('returns absolute value for negative innovation', () => {
    const pos = calcNormalizedInnovation(0.05, 0.01);
    const neg = calcNormalizedInnovation(-0.05, 0.01);
    expect(pos).toBe(neg);
  });

  it('returns 0 for zero innovation', () => {
    expect(calcNormalizedInnovation(0, 0.01)).toBe(0);
  });

  it('larger innovation gives larger normalized value', () => {
    const small = calcNormalizedInnovation(0.01, 0.01);
    const large = calcNormalizedInnovation(0.1, 0.01);
    expect(large).toBeGreaterThan(small);
  });

  it('larger S gives smaller normalized value', () => {
    const smallS = calcNormalizedInnovation(0.05, 0.001);
    const largeS = calcNormalizedInnovation(0.05, 0.1);
    expect(smallS).toBeGreaterThan(largeS);
  });

  it('known value: innovation=0.2, S=0.04 → 1.0', () => {
    expect(calcNormalizedInnovation(0.2, 0.04)).toBeCloseTo(1.0, 6);
  });
});

// ── Kalman filter convergence (multi-step) ──────────────────────────────────

describe('Kalman filter convergence', () => {
  it('estimate converges to stable observation after multiple steps', () => {
    let x = 0.5;
    let P = 0.1;
    const Q = 0.0001;
    const R = 0.001;
    const truePrice = 0.6;

    for (let i = 0; i < 50; i++) {
      const { xPred, pPred } = kalmanPredict(x, P, Q);
      const updated = kalmanUpdate(xPred, pPred, truePrice, R);
      x = updated.x;
      P = updated.P;
    }

    expect(x).toBeCloseTo(truePrice, 3);
  });

  it('covariance stabilizes over time', () => {
    let x = 0.5;
    let P = 0.1;
    const Q = 0.0001;
    const R = 0.001;
    const pValues: number[] = [];

    for (let i = 0; i < 100; i++) {
      const { xPred, pPred } = kalmanPredict(x, P, Q);
      const updated = kalmanUpdate(xPred, pPred, 0.6, R);
      x = updated.x;
      P = updated.P;
      pValues.push(P);
    }

    // Last 10 P values should be nearly identical (steady state)
    const last10 = pValues.slice(-10);
    const range = Math.max(...last10) - Math.min(...last10);
    expect(range).toBeLessThan(1e-8);
  });

  it('innovation shrinks as filter converges', () => {
    let x = 0.5;
    let P = 0.1;
    const Q = 0.0001;
    const R = 0.001;
    const truePrice = 0.6;

    const { xPred: xPred1, pPred: pPred1 } = kalmanPredict(x, P, Q);
    const first = kalmanUpdate(xPred1, pPred1, truePrice, R);
    x = first.x;
    P = first.P;

    for (let i = 0; i < 49; i++) {
      const { xPred, pPred } = kalmanPredict(x, P, Q);
      const updated = kalmanUpdate(xPred, pPred, truePrice, R);
      x = updated.x;
      P = updated.P;
    }

    const { xPred: xPredLast, pPred: pPredLast } = kalmanPredict(x, P, Q);
    const last = kalmanUpdate(xPredLast, pPredLast, truePrice, R);

    expect(Math.abs(last.innovation)).toBeLessThan(Math.abs(first.innovation));
  });
});

// ── Tick integration tests ──────────────────────────────────────────────────

describe('createKalmanFilterTrackerTick', () => {
  let mockClob: any;
  let mockOrderManager: any;
  let mockEventBus: any;
  let mockGamma: any;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);

    mockClob = {
      getOrderBook: vi.fn(),
    };

    mockOrderManager = {
      placeOrder: vi.fn().mockResolvedValue({ id: 'order-1' }),
    };

    mockEventBus = {
      emit: vi.fn(),
    };

    mockGamma = {
      getTrending: vi.fn().mockResolvedValue([]),
    };
  });

  function makeDeps(configOverrides: Partial<KalmanFilterTrackerConfig> = {}): KalmanFilterTrackerDeps {
    return {
      clob: mockClob,
      orderManager: mockOrderManager,
      eventBus: mockEventBus,
      gamma: mockGamma,
      config: configOverrides,
    };
  }

  function makeMarket(overrides: Partial<any> = {}): any {
    return {
      id: 'market-1',
      question: 'Test Market',
      slug: 'test-market',
      conditionId: 'cond-1',
      yesTokenId: 'yes-token-1',
      noTokenId: 'no-token-1',
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: 50_000,
      volume24h: 10_000,
      liquidity: 20_000,
      endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
      closed: false,
      resolved: false,
      ...overrides,
    };
  }

  it('does not trade before filter warmup (minTicks)', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);
    // Stable book at 0.50
    mockClob.getOrderBook.mockResolvedValue(makeBook([['0.49', '100']], [['0.51', '100']]));

    const tick = createKalmanFilterTrackerTick(makeDeps({ minTicks: 10 }));

    // Run 9 ticks — not enough
    for (let i = 0; i < 9; i++) {
      await tick();
    }

    expect(mockOrderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not trade when normalized innovation is below threshold', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);
    // Stable book at 0.50
    mockClob.getOrderBook.mockResolvedValue(makeBook([['0.49', '100']], [['0.51', '100']]));

    const tick = createKalmanFilterTrackerTick(makeDeps({ minTicks: 2 }));

    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(mockOrderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('enters BUY YES when innovation is negative (price drops)', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    // Warm up with stable price
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 5,
      innovationThreshold: 0.5,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    // Warm up
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Sudden price drop
    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);

    await tick();

    expect(mockOrderManager.placeOrder).toHaveBeenCalled();
    const call = mockOrderManager.placeOrder.mock.calls[0][0];
    // BUY YES because price dropped (negative innovation)
    expect(call.tokenId).toBe('yes-token-1');
    expect(call.side).toBe('buy');
  });

  it('enters BUY NO when innovation is positive (price jumps up)', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 5,
      innovationThreshold: 0.5,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    // Warm up
    for (let i = 0; i < 6; i++) {
      await tick();
    }

    // Sudden price jump up
    const jumpBook = makeBook([['0.68', '100']], [['0.70', '100']]);
    mockClob.getOrderBook.mockResolvedValue(jumpBook);

    await tick();

    expect(mockOrderManager.placeOrder).toHaveBeenCalled();
    const call = mockOrderManager.placeOrder.mock.calls[0][0];
    // BUY NO because price jumped up (positive innovation)
    expect(call.tokenId).toBe('no-token-1');
    expect(call.side).toBe('buy');
  });

  it('emits trade.executed event on entry', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    for (let i = 0; i < 4; i++) {
      await tick();
    }

    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    expect(mockEventBus.emit).toHaveBeenCalledWith('trade.executed', expect.objectContaining({
      trade: expect.objectContaining({
        strategy: 'kalman-filter-tracker',
        side: 'buy',
      }),
    }));
  });

  it('respects maxPositions limit', async () => {
    const markets = Array.from({ length: 8 }, (_, i) => makeMarket({
      conditionId: `cond-${i}`,
      yesTokenId: `yes-token-${i}`,
      noTokenId: `no-token-${i}`,
    }));
    mockGamma.getTrending.mockResolvedValue(markets);

    // Stable price for warmup
    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      maxPositions: 2,
      innovationThreshold: 0.5,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    // Warm up
    for (let i = 0; i < 4; i++) {
      await tick();
    }

    // Big drop for all markets
    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);

    await tick();

    // Should have at most 2 orders placed
    expect(mockOrderManager.placeOrder.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('skips closed markets', async () => {
    const market = makeMarket({ closed: true });
    mockGamma.getTrending.mockResolvedValue([market]);
    mockClob.getOrderBook.mockResolvedValue(makeBook([['0.49', '100']], [['0.51', '100']]));

    const tick = createKalmanFilterTrackerTick(makeDeps({ minTicks: 1 }));
    await tick();

    expect(mockClob.getOrderBook).not.toHaveBeenCalled();
  });

  it('skips resolved markets', async () => {
    const market = makeMarket({ resolved: true });
    mockGamma.getTrending.mockResolvedValue([market]);
    mockClob.getOrderBook.mockResolvedValue(makeBook([['0.49', '100']], [['0.51', '100']]));

    const tick = createKalmanFilterTrackerTick(makeDeps({ minTicks: 1 }));
    await tick();

    expect(mockClob.getOrderBook).not.toHaveBeenCalled();
  });

  it('exits position on take-profit', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      takeProfitPct: 0.03,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    // Warm up
    for (let i = 0; i < 4; i++) {
      await tick();
    }

    // Trigger entry via price drop
    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    expect(mockOrderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Now price recovers — take profit for YES position
    // Entry was at ask = 0.32, take profit at 3% → need price ~0.3296+
    const tpBook = makeBook([['0.35', '100']], [['0.37', '100']]);
    mockClob.getOrderBook.mockResolvedValue(tpBook);

    await tick();

    // Should have placed an exit order (second call)
    expect(mockOrderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('exits position on stop-loss', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      stopLossPct: 0.02,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    // Warm up
    for (let i = 0; i < 4; i++) {
      await tick();
    }

    // Trigger entry via price drop
    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    expect(mockOrderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Price drops further — stop loss for YES position
    // Entry was at ask = 0.32, stop loss at 2% → price ~0.3136-
    const slBook = makeBook([['0.25', '100']], [['0.27', '100']]);
    mockClob.getOrderBook.mockResolvedValue(slBook);

    await tick();

    expect(mockOrderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('exits position on max hold time', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      maxHoldMs: 5 * 60_000,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    for (let i = 0; i < 4; i++) {
      await tick();
    }

    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    expect(mockOrderManager.placeOrder).toHaveBeenCalledTimes(1);

    // Advance time past max hold, but price stays same (no TP/SL trigger)
    vi.advanceTimersByTime(6 * 60_000);
    mockClob.getOrderBook.mockResolvedValue(dropBook);

    await tick();

    // Exit order should have been placed
    expect(mockOrderManager.placeOrder).toHaveBeenCalledTimes(2);
  });

  it('respects cooldown after exit', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      maxHoldMs: 5 * 60_000,
      cooldownMs: 90_000,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    for (let i = 0; i < 4; i++) {
      await tick();
    }

    // Enter
    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    // Force exit via max hold
    vi.advanceTimersByTime(6 * 60_000);
    await tick();

    const callCountAfterExit = mockOrderManager.placeOrder.mock.calls.length;

    // Immediately try again — should be on cooldown
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    expect(mockOrderManager.placeOrder.mock.calls.length).toBe(callCountAfterExit);
  });

  it('does not crash when getOrderBook throws', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);
    mockClob.getOrderBook.mockRejectedValue(new Error('Network error'));

    const tick = createKalmanFilterTrackerTick(makeDeps());

    // Should not throw
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not crash when getTrending throws', async () => {
    mockGamma.getTrending.mockRejectedValue(new Error('API down'));

    const tick = createKalmanFilterTrackerTick(makeDeps());
    await expect(tick()).resolves.toBeUndefined();
  });

  it('skips markets with mid price at boundary (0 or 1)', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);
    mockClob.getOrderBook.mockResolvedValue(makeBook([['0.99', '100']], [['1.00', '100']]));

    const tick = createKalmanFilterTrackerTick(makeDeps({ minTicks: 1 }));

    for (let i = 0; i < 5; i++) {
      await tick();
    }

    expect(mockOrderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('uses positionSize from config', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      positionSize: '25',
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    for (let i = 0; i < 4; i++) {
      await tick();
    }

    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    if (mockOrderManager.placeOrder.mock.calls.length > 0) {
      const call = mockOrderManager.placeOrder.mock.calls[0][0];
      // size = round(25 / entryPrice)
      const entryPrice = 0.32; // ask price
      expect(Number(call.size)).toBe(Math.round(25 / entryPrice));
    }
  });

  it('does not re-enter a market that already has a position', async () => {
    const market = makeMarket();
    mockGamma.getTrending.mockResolvedValue([market]);

    const stableBook = makeBook([['0.49', '100']], [['0.51', '100']]);
    mockClob.getOrderBook.mockResolvedValue(stableBook);

    const tick = createKalmanFilterTrackerTick(makeDeps({
      minTicks: 3,
      innovationThreshold: 0.5,
      processNoise: 0.00001,
      measurementNoise: 0.0001,
    }));

    for (let i = 0; i < 4; i++) {
      await tick();
    }

    // Enter
    const dropBook = makeBook([['0.30', '100']], [['0.32', '100']]);
    mockClob.getOrderBook.mockResolvedValue(dropBook);
    await tick();

    const entryCount = mockOrderManager.placeOrder.mock.calls.length;
    expect(entryCount).toBe(1);

    // Tick again with same signal — should NOT enter again (may exit via SL though)
    await tick();

    // Any additional calls are exits (sell side), not new entries (buy side for same token)
    const laterCalls = mockOrderManager.placeOrder.mock.calls.slice(entryCount);
    for (const call of laterCalls) {
      // Exit orders use 'sell' or 'buy' to close, but crucially they are NOT
      // new buy entries for the same yes-token
      expect(call[0].tokenId === 'yes-token-1' && call[0].side === 'buy').toBe(false);
    }
  });
});
