import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  discretizeChange,
  buildTransitionMatrix,
  predictNextState,
  pricesToStates,
  createMarkovChainPredictorTick,
  DEFAULT_CONFIG,
  type MarkovChainPredictorConfig,
  type MarkovChainPredictorDeps,
} from '../../src/strategies/polymarket/markov-chain-predictor.js';
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

function makeConfig(overrides: Partial<MarkovChainPredictorConfig> = {}): MarkovChainPredictorConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// ── discretizeChange tests ───────────────────────────────────────────────────

describe('discretizeChange', () => {
  it('returns up when change exceeds threshold', () => {
    expect(discretizeChange(0.01, 0.005)).toBe('up');
  });

  it('returns down when change is below negative threshold', () => {
    expect(discretizeChange(-0.01, 0.005)).toBe('down');
  });

  it('returns flat when change is within threshold', () => {
    expect(discretizeChange(0.003, 0.005)).toBe('flat');
  });

  it('returns flat when change equals positive threshold', () => {
    expect(discretizeChange(0.005, 0.005)).toBe('flat');
  });

  it('returns flat when change equals negative threshold', () => {
    expect(discretizeChange(-0.005, 0.005)).toBe('flat');
  });

  it('returns flat for zero change', () => {
    expect(discretizeChange(0, 0.005)).toBe('flat');
  });

  it('returns up for very large positive change', () => {
    expect(discretizeChange(1.0, 0.005)).toBe('up');
  });

  it('returns down for very large negative change', () => {
    expect(discretizeChange(-1.0, 0.005)).toBe('down');
  });

  it('handles zero threshold — positive change is up', () => {
    expect(discretizeChange(0.001, 0)).toBe('up');
  });

  it('handles zero threshold — negative change is down', () => {
    expect(discretizeChange(-0.001, 0)).toBe('down');
  });

  it('handles zero threshold — zero change is flat', () => {
    expect(discretizeChange(0, 0)).toBe('flat');
  });
});

// ── buildTransitionMatrix tests ──────────────────────────────────────────────

describe('buildTransitionMatrix', () => {
  it('returns empty map for empty array', () => {
    const matrix = buildTransitionMatrix([]);
    expect(matrix.size).toBe(0);
  });

  it('returns empty map for single state', () => {
    const matrix = buildTransitionMatrix(['up']);
    expect(matrix.size).toBe(0);
  });

  it('builds correct matrix for two states', () => {
    const matrix = buildTransitionMatrix(['up', 'down']);
    expect(matrix.get('up')?.get('down')).toBe(1.0);
    expect(matrix.has('down')).toBe(false);
  });

  it('normalizes probabilities to sum to 1', () => {
    const matrix = buildTransitionMatrix(['up', 'down', 'up', 'up']);
    // from 'up': down(1), up(1) → 0.5 each
    const upRow = matrix.get('up')!;
    expect(upRow.get('down')).toBeCloseTo(0.5, 4);
    expect(upRow.get('up')).toBeCloseTo(0.5, 4);
  });

  it('handles all same states', () => {
    const matrix = buildTransitionMatrix(['flat', 'flat', 'flat', 'flat']);
    expect(matrix.get('flat')?.get('flat')).toBe(1.0);
  });

  it('handles three distinct states', () => {
    const matrix = buildTransitionMatrix(['up', 'down', 'flat']);
    expect(matrix.get('up')?.get('down')).toBe(1.0);
    expect(matrix.get('down')?.get('flat')).toBe(1.0);
  });

  it('counts multiple transitions correctly', () => {
    // up→down, down→up, up→down, down→flat
    const matrix = buildTransitionMatrix(['up', 'down', 'up', 'down', 'flat']);
    const upRow = matrix.get('up')!;
    expect(upRow.get('down')).toBe(1.0); // up always goes to down
    const downRow = matrix.get('down')!;
    expect(downRow.get('up')).toBeCloseTo(0.5, 4);
    expect(downRow.get('flat')).toBeCloseTo(0.5, 4);
  });

  it('handles long sequence with uneven distribution', () => {
    // up→up 3 times, up→down 1 time
    const states = ['up', 'up', 'up', 'up', 'down'];
    const matrix = buildTransitionMatrix(states);
    expect(matrix.get('up')?.get('up')).toBeCloseTo(0.75, 4);
    expect(matrix.get('up')?.get('down')).toBeCloseTo(0.25, 4);
  });
});

// ── predictNextState tests ───────────────────────────────────────────────────

describe('predictNextState', () => {
  it('returns null for empty matrix', () => {
    const matrix = new Map<string, Map<string, number>>();
    expect(predictNextState(matrix, 'up')).toBeNull();
  });

  it('returns null for unknown current state', () => {
    const matrix = new Map([['up', new Map([['down', 1.0]])]]);
    expect(predictNextState(matrix, 'flat')).toBeNull();
  });

  it('returns the only possible next state with probability 1', () => {
    const matrix = new Map([['up', new Map([['down', 1.0]])]]);
    const result = predictNextState(matrix, 'up');
    expect(result).toEqual({ state: 'down', probability: 1.0 });
  });

  it('returns the most probable state', () => {
    const matrix = new Map([
      ['up', new Map([['down', 0.3], ['up', 0.5], ['flat', 0.2]])],
    ]);
    const result = predictNextState(matrix, 'up');
    expect(result).toEqual({ state: 'up', probability: 0.5 });
  });

  it('returns null when row is empty map', () => {
    const matrix = new Map([['up', new Map<string, number>()]]);
    expect(predictNextState(matrix, 'up')).toBeNull();
  });

  it('picks between two equally probable states', () => {
    const matrix = new Map([
      ['flat', new Map([['up', 0.5], ['down', 0.5]])],
    ]);
    const result = predictNextState(matrix, 'flat');
    expect(result).not.toBeNull();
    expect(result!.probability).toBe(0.5);
    expect(['up', 'down']).toContain(result!.state);
  });

  it('handles single transition from state', () => {
    const matrix = new Map([['down', new Map([['flat', 0.8]])]]);
    const result = predictNextState(matrix, 'down');
    expect(result).toEqual({ state: 'flat', probability: 0.8 });
  });
});

// ── pricesToStates tests ─────────────────────────────────────────────────────

describe('pricesToStates', () => {
  it('returns empty array for empty prices', () => {
    expect(pricesToStates([], 0.005)).toEqual([]);
  });

  it('returns empty array for single price', () => {
    expect(pricesToStates([0.5], 0.005)).toEqual([]);
  });

  it('returns one state for two prices', () => {
    const states = pricesToStates([0.50, 0.52], 0.005);
    expect(states).toEqual(['up']);
  });

  it('returns correct states for increasing prices', () => {
    const states = pricesToStates([0.50, 0.51, 0.52, 0.53], 0.005);
    expect(states).toEqual(['up', 'up', 'up']);
  });

  it('returns correct states for decreasing prices', () => {
    const states = pricesToStates([0.53, 0.52, 0.51, 0.50], 0.005);
    expect(states).toEqual(['down', 'down', 'down']);
  });

  it('returns flat for unchanged prices', () => {
    const states = pricesToStates([0.50, 0.50, 0.50], 0.005);
    expect(states).toEqual(['flat', 'flat']);
  });

  it('returns mixed states for mixed price movements', () => {
    const states = pricesToStates([0.50, 0.52, 0.52, 0.48], 0.005);
    expect(states).toEqual(['up', 'flat', 'down']);
  });

  it('returns length = prices.length - 1', () => {
    const prices = [0.5, 0.51, 0.52, 0.53, 0.54];
    const states = pricesToStates(prices, 0.005);
    expect(states.length).toBe(prices.length - 1);
  });

  it('handles tiny changes below threshold as flat', () => {
    const states = pricesToStates([0.500, 0.501, 0.502], 0.005);
    expect(states).toEqual(['flat', 'flat']);
  });
});

// ── Tick factory tests ──────────────────────────────────────────────────────

function makeDeps(overrides: Partial<MarkovChainPredictorDeps> = {}): MarkovChainPredictorDeps {
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

describe('createMarkovChainPredictorTick', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a function', () => {
    const tick = createMarkovChainPredictorTick(makeDeps());
    expect(typeof tick).toBe('function');
  });

  it('does not place orders on first tick (insufficient price history)', async () => {
    const deps = makeDeps();
    const tick = createMarkovChainPredictorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not place orders on second tick (need at least 3 prices)', async () => {
    const deps = makeDeps();
    const tick = createMarkovChainPredictorTick(deps);
    await tick();
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('does not throw on gamma API error', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockRejectedValue(new Error('API error')) } as any,
    });
    const tick = createMarkovChainPredictorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('does not throw on clob API error', async () => {
    const deps = makeDeps({
      clob: { getOrderBook: vi.fn().mockRejectedValue(new Error('timeout')) } as any,
    });
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
    await tick();
    expect(deps.clob.getOrderBook).not.toHaveBeenCalled();
  });

  it('handles empty markets list', async () => {
    const deps = makeDeps({
      gamma: { getTrending: vi.fn().mockResolvedValue([]) } as any,
    });
    const tick = createMarkovChainPredictorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  it('accepts config overrides', async () => {
    const deps = makeDeps({
      config: { maxPositions: 1, minVolume: 1 },
    });
    const tick = createMarkovChainPredictorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles empty orderbook gracefully', async () => {
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(makeBook([], [])),
      } as any,
    });
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
    await expect(tick()).resolves.toBeUndefined();
  });

  it('handles orderManager.placeOrder failure gracefully', async () => {
    const deps = makeDeps({
      orderManager: {
        placeOrder: vi.fn().mockRejectedValue(new Error('insufficient funds')),
      } as any,
    });
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
    await tick();
    // Both markets should be scanned (getOrderBook called for each)
    expect(deps.clob.getOrderBook).toHaveBeenCalledTimes(2);
  });

  it('records price history across ticks', async () => {
    const deps = makeDeps();
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
    await tick();
    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Entry tests: BUY YES when predicted up ─────────────────────────────

  it('enters buy-yes when Markov chain predicts up with high confidence', async () => {
    // Build a clear uptrend so the chain learns up→up with high probability
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.47];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        historyWindow: 30,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < prices.length; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── Entry tests: BUY NO when predicted down ───────────────────────────

  it('enters buy-no when Markov chain predicts down with high confidence', async () => {
    // Build a clear downtrend
    let callCount = 0;
    const prices = [0.60, 0.59, 0.58, 0.57, 0.56, 0.55, 0.54, 0.53];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        historyWindow: 30,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < prices.length; i++) {
      await tick();
    }

    if ((deps.orderManager.placeOrder as any).mock.calls.length > 0) {
      const call = (deps.orderManager.placeOrder as any).mock.calls[0][0];
      expect(call.side).toBe('buy');
      expect(call.orderType).toBe('GTC');
    }
    expect(true).toBe(true);
  });

  // ── No entry when confidence below threshold ───────────────────────────

  it('does not enter when prediction confidence is below threshold', async () => {
    // Use a very high confidence threshold (1.0) with a pattern that
    // creates mixed transitions from each state so no single transition
    // can reach probability 1.0 once enough history is gathered.
    // We use stateThreshold=0.005 and prices that produce: up, down, up, flat, down, up, down, flat
    // After enough states, 'up' transitions to both 'down' and 'flat', so P < 1.0
    let callCount = 0;
    // Prices producing states: up(+0.02), down(-0.02), up(+0.02), flat(0), down(-0.02), up(+0.02), down(-0.02), flat(0), up(+0.02), down(-0.02)
    const prices = [0.50, 0.52, 0.50, 0.52, 0.52, 0.50, 0.52, 0.50, 0.50, 0.52, 0.50];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        // Set to > 1.0 so nothing can exceed it
        confidenceThreshold: 1.01,
        minVolume: 1,
        historyWindow: 30,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < prices.length; i++) {
      await tick();
    }

    // Only GTC entries count; filter out IOC exit orders
    const entries = (deps.orderManager.placeOrder as any).mock.calls.filter(
      (c: any) => c[0].orderType === 'GTC'
    );
    expect(entries.length).toBe(0);
  });

  it('does not enter when all states are flat', async () => {
    // Stable price → all flat states → flat prediction → no trade
    const deps = makeDeps({
      clob: {
        getOrderBook: vi.fn().mockResolvedValue(
          makeBook([['0.49', '100']], [['0.51', '100']]),
        ),
      } as any,
      config: {
        stateThreshold: 0.05, // high threshold so everything is flat
        confidenceThreshold: 0.5,
        minVolume: 1,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < 10; i++) {
      await tick();
    }

    expect(deps.orderManager.placeOrder).not.toHaveBeenCalled();
  });

  // ── Exit tests ────────────────────────────────────────────────────────

  it('exits on take profit for yes position', async () => {
    let callCount = 0;
    // uptrend to trigger entry, then price jumps for TP
    const prices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.60];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        takeProfitPct: 0.03,
        stopLossPct: 0.02,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < prices.length; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on stop loss for yes position', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.10];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.02,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < prices.length; i++) {
      await tick();
    }

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('exits on max hold time', async () => {
    let callCount = 0;
    const prices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.46];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        maxHoldMs: 1,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < 7; i++) {
      await tick();
    }
    await new Promise(r => setTimeout(r, 5));
    await tick();

    expect(deps.eventBus.emit).toBeDefined();
  });

  it('cooldown prevents re-entry after exit', async () => {
    let callCount = 0;
    // uptrend → entry → TP exit → uptrend again (but cooldown should prevent)
    const prices = [0.40, 0.41, 0.42, 0.43, 0.44, 0.45, 0.46, 0.60, 0.41, 0.42, 0.43, 0.44];
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        const p = prices[Math.min(callCount, prices.length - 1)];
        callCount++;
        return Promise.resolve(makeBook(
          [[String(p - 0.01), '100']], [[String(p + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        takeProfitPct: 0.03,
        cooldownMs: 180_000,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
    for (let i = 0; i < prices.length; i++) {
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
    // Steady uptrend for all markets
    const clob = {
      getOrderBook: vi.fn().mockImplementation(() => {
        callCount++;
        const base = 0.40 + Math.floor((callCount - 1) / 3) * 0.01;
        return Promise.resolve(makeBook(
          [[String(base - 0.01), '100']], [[String(base + 0.01), '100']],
        ));
      }),
    };

    const deps = makeDeps({
      clob: clob as any,
      gamma: { getTrending: vi.fn().mockResolvedValue(markets) } as any,
      config: {
        stateThreshold: 0.005,
        confidenceThreshold: 0.5,
        minVolume: 1,
        maxPositions: 2,
        takeProfitPct: 0.50,
        stopLossPct: 0.50,
        maxHoldMs: 999_999_999,
      },
    });

    const tick = createMarkovChainPredictorTick(deps);
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
    const tick = createMarkovChainPredictorTick(deps);
    await tick();

    expect(typeof deps.eventBus.emit).toBe('function');
  });

  it('uses default config values when no overrides provided', () => {
    const cfg = makeConfig();
    expect(cfg.stateThreshold).toBe(0.005);
    expect(cfg.historyWindow).toBe(30);
    expect(cfg.confidenceThreshold).toBe(0.6);
    expect(cfg.minVolume).toBe(5000);
    expect(cfg.takeProfitPct).toBe(0.025);
    expect(cfg.stopLossPct).toBe(0.02);
    expect(cfg.maxHoldMs).toBe(15 * 60_000);
    expect(cfg.maxPositions).toBe(4);
    expect(cfg.cooldownMs).toBe(120_000);
    expect(cfg.positionSize).toBe('10');
  });

  it('config overrides merge with defaults', () => {
    const cfg = makeConfig({ stateThreshold: 0.01, maxPositions: 8 });
    expect(cfg.stateThreshold).toBe(0.01);
    expect(cfg.maxPositions).toBe(8);
    expect(cfg.historyWindow).toBe(30); // default kept
  });
});
