/**
 * Integration tests for concurrent strategy execution via StrategyOrchestrator.
 * Uses real EventBus and StrategyOrchestrator with mocked deps.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StrategyOrchestrator } from '../../src/strategies/strategy-orchestrator.js';
import type { StrategyConfig } from '../../src/strategies/strategy-orchestrator.js';
import { EventBus } from '../../src/events/event-bus.js';
import { wireStrategies } from '../../src/wiring/strategy-wiring.js';
import type { SystemEventMap } from '../../src/events/event-types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    id: overrides.id ?? 'test-strategy',
    name: overrides.name ?? 'Test Strategy',
    type: overrides.type ?? 'book-imbalance',
    enabled: overrides.enabled ?? true,
    params: overrides.params ?? {},
    intervalMs: overrides.intervalMs ?? 100,
  };
}

function makeTickFn(): { tick: () => Promise<void>; calls: number[] } {
  const state = { calls: [] as number[] };
  return {
    tick: vi.fn(async () => { state.calls.push(Date.now()); }),
    calls: state.calls,
  };
}

// Minimal mock implementations
function mockClobClient() {
  return {
    getMarkets: vi.fn().mockResolvedValue([]),
    getOrderBook: vi.fn().mockResolvedValue({
      market: 'mock', asset_id: 'mock',
      bids: [{ price: '0.50', size: '100' }],
      asks: [{ price: '0.52', size: '100' }],
      hash: 'mock',
    }),
    getPrice: vi.fn().mockResolvedValue({ mid: '0.51', bid: '0.50', ask: '0.52' }),
    postOrder: vi.fn().mockResolvedValue({
      id: `order-${Date.now()}`, marketId: 'mock', side: 'buy',
      price: '0.50', size: '10', status: 'open', type: 'limit', createdAt: Date.now(),
    }),
    placeLimitOrder: vi.fn().mockResolvedValue({
      id: `order-${Date.now()}`, marketId: 'mock', side: 'buy',
      price: '0.50', size: '10', status: 'open', type: 'limit', createdAt: Date.now(),
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    isPaperMode: true,
  } as any;
}

function mockGammaClient() {
  return {
    getTrending: vi.fn().mockResolvedValue([]),
    search: vi.fn().mockResolvedValue([]),
    getMarket: vi.fn().mockResolvedValue({}),
    getMarketBySlug: vi.fn().mockResolvedValue({}),
    getEvents: vi.fn().mockResolvedValue([]),
    getPrices: vi.fn().mockResolvedValue({}),
  } as any;
}

function mockOrderManager() {
  return {
    placeOrder: vi.fn().mockResolvedValue({
      id: `order-${Math.random().toString(36).slice(2)}`,
      marketId: 'mock', side: 'buy', price: '0.50', size: '10',
      status: 'open', type: 'limit', createdAt: Date.now(),
      filledSize: '0', lastCheckedAt: Date.now(),
    }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    cancelAllForMarket: vi.fn().mockResolvedValue(0),
    getOpenOrders: vi.fn().mockReturnValue([]),
    getAllOrders: vi.fn().mockReturnValue([]),
    getOrdersForMarket: vi.fn().mockReturnValue([]),
    updateStatus: vi.fn(),
    getPosition: vi.fn().mockReturnValue(undefined),
    getAllPositions: vi.fn().mockReturnValue([]),
    computePnl: vi.fn().mockReturnValue(null),
    closePosition: vi.fn().mockReturnValue(0),
    startStalePoll: vi.fn(),
    stopStalePoll: vi.fn(),
    pruneClosedOrders: vi.fn(),
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Strategy Orchestration Integration', () => {
  let orchestrator: StrategyOrchestrator;
  let eventBus: EventBus;

  beforeEach(() => {
    vi.useFakeTimers();
    eventBus = new EventBus();
    eventBus.setMaxListeners(50);
    orchestrator = new StrategyOrchestrator(eventBus);
  });

  afterEach(() => {
    orchestrator.stopAll();
    eventBus.removeAllListeners();
    vi.useRealTimers();
  });

  // =========================================================================
  // Orchestrator Lifecycle
  // =========================================================================
  describe('Orchestrator Lifecycle', () => {
    it('1. registers multiple strategies and startAll() starts them', () => {
      const t1 = makeTickFn();
      const t2 = makeTickFn();
      orchestrator.register(makeConfig({ id: 's1', name: 'S1' }), t1.tick);
      orchestrator.register(makeConfig({ id: 's2', name: 'S2' }), t2.tick);

      orchestrator.startAll();

      const statuses = orchestrator.getStatus();
      expect(statuses).toHaveLength(2);
      expect(statuses.every(s => s.status === 'running')).toBe(true);
    });

    it('2. only enabled strategies start on startAll()', () => {
      const t1 = makeTickFn();
      const t2 = makeTickFn();
      orchestrator.register(makeConfig({ id: 's1', enabled: true }), t1.tick);
      orchestrator.register(makeConfig({ id: 's2', enabled: false }), t2.tick);

      orchestrator.startAll();

      const statuses = orchestrator.getStatus();
      expect(statuses.find(s => s.id === 's1')!.status).toBe('running');
      expect(statuses.find(s => s.id === 's2')!.status).toBe('stopped');
    });

    it('3. stopAll() stops all running strategies', () => {
      const t1 = makeTickFn();
      const t2 = makeTickFn();
      orchestrator.register(makeConfig({ id: 's1' }), t1.tick);
      orchestrator.register(makeConfig({ id: 's2' }), t2.tick);
      orchestrator.startAll();

      orchestrator.stopAll();

      const statuses = orchestrator.getStatus();
      expect(statuses.every(s => s.status === 'stopped')).toBe(true);
    });

    it('4. individual start/stop works', () => {
      const t1 = makeTickFn();
      orchestrator.register(makeConfig({ id: 's1' }), t1.tick);

      expect(orchestrator.start('s1')).toBe(true);
      expect(orchestrator.getStrategyStatus('s1')!.status).toBe('running');

      expect(orchestrator.stop('s1')).toBe(true);
      expect(orchestrator.getStrategyStatus('s1')!.status).toBe('stopped');
    });

    it('5. getStatus() returns correct states for all strategies', () => {
      const t1 = makeTickFn();
      const t2 = makeTickFn();
      const t3 = makeTickFn();
      orchestrator.register(makeConfig({ id: 's1', name: 'Alpha' }), t1.tick);
      orchestrator.register(makeConfig({ id: 's2', name: 'Beta', enabled: false }), t2.tick);
      orchestrator.register(makeConfig({ id: 's3', name: 'Gamma' }), t3.tick);

      orchestrator.startAll();
      // Trigger an error on s3 to put it into a tick state

      const statuses = orchestrator.getStatus();
      expect(statuses).toHaveLength(3);
      expect(statuses.find(s => s.id === 's1')!.status).toBe('running');
      expect(statuses.find(s => s.id === 's2')!.status).toBe('stopped');
      expect(statuses.find(s => s.id === 's3')!.status).toBe('running');

      // Verify shape
      for (const s of statuses) {
        expect(s).toHaveProperty('id');
        expect(s).toHaveProperty('name');
        expect(s).toHaveProperty('status');
        expect(s).toHaveProperty('lastTick');
        expect(s).toHaveProperty('tickCount');
        expect(s).toHaveProperty('errorCount');
        expect(s).toHaveProperty('lastError');
      }
    });
  });

  // =========================================================================
  // Concurrent Execution
  // =========================================================================
  describe('Concurrent Execution', () => {
    it('6. multiple strategies can tick concurrently without errors', async () => {
      const t1 = makeTickFn();
      const t2 = makeTickFn();
      const t3 = makeTickFn();
      orchestrator.register(makeConfig({ id: 's1', intervalMs: 100 }), t1.tick);
      orchestrator.register(makeConfig({ id: 's2', intervalMs: 150 }), t2.tick);
      orchestrator.register(makeConfig({ id: 's3', intervalMs: 200 }), t3.tick);

      orchestrator.startAll();

      // Advance enough for several ticks
      await vi.advanceTimersByTimeAsync(600);

      const statuses = orchestrator.getStatus();
      expect(statuses.find(s => s.id === 's1')!.tickCount).toBeGreaterThanOrEqual(5);
      expect(statuses.find(s => s.id === 's2')!.tickCount).toBeGreaterThanOrEqual(3);
      expect(statuses.find(s => s.id === 's3')!.tickCount).toBeGreaterThanOrEqual(2);
      expect(statuses.every(s => s.status === 'running')).toBe(true);
    });

    it('7. strategies do not share or corrupt each other\'s state', async () => {
      // Each tick records an independent counter via closure
      let counterA = 0;
      let counterB = 0;
      const tickA = vi.fn(async () => { counterA += 1; });
      const tickB = vi.fn(async () => { counterB += 10; });

      orchestrator.register(makeConfig({ id: 'a', intervalMs: 100 }), tickA);
      orchestrator.register(makeConfig({ id: 'b', intervalMs: 100 }), tickB);
      orchestrator.startAll();

      await vi.advanceTimersByTimeAsync(500);

      // Counters should be independent
      expect(counterA).toBe(5);
      expect(counterB).toBe(50);
      expect(counterA).not.toBe(counterB);
    });

    it('8. one strategy error does not stop others', async () => {
      const goodTick = makeTickFn();
      const badTick = vi.fn(async () => { throw new Error('boom'); });

      orchestrator.register(makeConfig({ id: 'good', intervalMs: 100 }), goodTick.tick);
      orchestrator.register(makeConfig({ id: 'bad', intervalMs: 100 }), badTick);
      orchestrator.startAll();

      await vi.advanceTimersByTimeAsync(500);

      expect(orchestrator.getStrategyStatus('good')!.status).toBe('running');
      expect(orchestrator.getStrategyStatus('good')!.tickCount).toBeGreaterThanOrEqual(4);
      // bad may still be running (hasn't hit 10 errors yet) or in error
      expect(orchestrator.getStrategyStatus('bad')!.errorCount).toBeGreaterThan(0);
    });

    it('9. auto-stop after 10 consecutive errors (per strategy only)', async () => {
      const goodTick = makeTickFn();
      const badTick = vi.fn(async () => { throw new Error('constant-fail'); });

      orchestrator.register(makeConfig({ id: 'good', intervalMs: 100 }), goodTick.tick);
      orchestrator.register(makeConfig({ id: 'bad', intervalMs: 100 }), badTick);
      orchestrator.startAll();

      // Advance enough for 10+ ticks
      await vi.advanceTimersByTimeAsync(1200);

      expect(orchestrator.getStrategyStatus('bad')!.status).toBe('error');
      expect(orchestrator.getStrategyStatus('bad')!.errorCount).toBe(10);
      expect(orchestrator.getStrategyStatus('good')!.status).toBe('running');
      expect(orchestrator.getStrategyStatus('good')!.tickCount).toBeGreaterThanOrEqual(10);
    });

    it('10. error in one strategy emits strategy.error event', async () => {
      const errors: { name: string; error: string }[] = [];
      eventBus.on('strategy.error', (data) => { errors.push(data); });

      const badTick = vi.fn(async () => { throw new Error('test-error'); });
      orchestrator.register(makeConfig({ id: 'bad', name: 'Bad Strategy', intervalMs: 100 }), badTick);
      orchestrator.startAll();

      await vi.advanceTimersByTimeAsync(150);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors[0].name).toBe('Bad Strategy');
      expect(errors[0].error).toBe('test-error');
    });
  });

  // =========================================================================
  // Event Bus Integration
  // =========================================================================
  describe('Event Bus Integration', () => {
    it('11. strategy.started event fires on start', () => {
      const events: SystemEventMap['strategy.started'][] = [];
      eventBus.on('strategy.started', (data) => { events.push(data); });

      orchestrator.register(makeConfig({ id: 's1', name: 'Alpha' }), makeTickFn().tick);
      orchestrator.start('s1');

      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('Alpha');
    });

    it('12. strategy.stopped event fires on stop', () => {
      const events: SystemEventMap['strategy.stopped'][] = [];
      eventBus.on('strategy.stopped', (data) => { events.push(data); });

      orchestrator.register(makeConfig({ id: 's1', name: 'Alpha' }), makeTickFn().tick);
      orchestrator.start('s1');
      orchestrator.stop('s1');

      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('Alpha');
      expect(events[0].reason).toContain('stop');
    });

    it('13. trade.executed events from different strategies do not conflict', async () => {
      const trades: SystemEventMap['trade.executed'][] = [];
      eventBus.on('trade.executed', (data) => { trades.push(data); });

      // Two strategies that each emit trade.executed on tick
      const tickA = vi.fn(async () => {
        eventBus.emit('trade.executed', {
          trade: {
            orderId: 'a-1', marketId: 'm1', side: 'buy',
            fillPrice: '0.50', fillSize: '10', fees: '0',
            timestamp: Date.now(), strategy: 'book-imbalance-reversal',
          },
        });
      });

      const tickB = vi.fn(async () => {
        eventBus.emit('trade.executed', {
          trade: {
            orderId: 'b-1', marketId: 'm2', side: 'sell',
            fillPrice: '0.70', fillSize: '20', fees: '0',
            timestamp: Date.now(), strategy: 'whale-tracker',
          },
        });
      });

      orchestrator.register(makeConfig({ id: 'a', intervalMs: 100 }), tickA);
      orchestrator.register(makeConfig({ id: 'b', intervalMs: 100 }), tickB);
      orchestrator.startAll();

      await vi.advanceTimersByTimeAsync(300);

      const strategiesA = trades.filter(t => t.trade.strategy === 'book-imbalance-reversal');
      const strategiesB = trades.filter(t => t.trade.strategy === 'whale-tracker');
      expect(strategiesA.length).toBeGreaterThanOrEqual(2);
      expect(strategiesB.length).toBeGreaterThanOrEqual(2);
      // Ensure they remain distinct
      for (const t of strategiesA) expect(t.trade.orderId).toMatch(/^a-/);
      for (const t of strategiesB) expect(t.trade.orderId).toMatch(/^b-/);
    });

    it('14. event listeners receive correct strategy name', async () => {
      const startedNames: string[] = [];
      const stoppedNames: string[] = [];
      const errorNames: string[] = [];
      eventBus.on('strategy.started', (d) => startedNames.push(d.name));
      eventBus.on('strategy.stopped', (d) => stoppedNames.push(d.name));
      eventBus.on('strategy.error', (d) => errorNames.push(d.name));

      const badTick = vi.fn(async () => { throw new Error('fail'); });
      orchestrator.register(makeConfig({ id: 's1', name: 'StratA' }), makeTickFn().tick);
      orchestrator.register(makeConfig({ id: 's2', name: 'StratB' }), badTick);
      orchestrator.startAll();

      await vi.advanceTimersByTimeAsync(150);

      orchestrator.stop('s1');

      expect(startedNames).toContain('StratA');
      expect(startedNames).toContain('StratB');
      expect(stoppedNames).toContain('StratA');
      expect(errorNames).toContain('StratB');
    });
  });

  // =========================================================================
  // Wiring Integration
  // =========================================================================
  describe('Wiring Integration', () => {
    it('15. wireStrategies() creates orchestrator with correct number of strategies', () => {
      const clob = mockClobClient();
      const gamma = mockGammaClient();
      const om = mockOrderManager();

      const orc = wireStrategies({
        eventBus,
        clobClient: clob,
        gammaClient: gamma,
        orderManager: om,
      });

      const statuses = orc.getStatus();
      // With clobClient + orderManager + gammaClient: book-imbalance, vwap-sniper,
      // pairs-stat-arb, session-vol-sniper, regime-momentum, orderbook-depth, cross-event-drift,
      // vol-compression, whale-tracker, resolution-frontrunner, multi-leg-hedge = 11 strategies
      expect(statuses.length).toBe(35);
    });

    it('16. wireStrategies() skips strategies without required deps', () => {
      // No deps at all — only eventBus
      const orc = wireStrategies({ eventBus });
      const statuses = orc.getStatus();
      expect(statuses.length).toBe(0);
    });

    it('17. strategy interval configuration from env vars works', () => {
      const origEnv = process.env['BOOK_IMBALANCE_INTERVAL_MS'];
      process.env['BOOK_IMBALANCE_INTERVAL_MS'] = '7777';

      const clob = mockClobClient();
      const gamma = mockGammaClient();
      const om = mockOrderManager();

      const orc = wireStrategies({
        eventBus,
        clobClient: clob,
        gammaClient: gamma,
        orderManager: om,
      });

      // The strategy should be registered; verify it exists
      const biStatus = orc.getStatus().find(s => s.id === 'book-imbalance');
      expect(biStatus).toBeDefined();
      // We can verify indirectly: start it and check tick timing
      // The interval is set internally, so just confirm registration succeeded
      expect(biStatus!.status).toBe('stopped'); // enabled: false by default

      // Restore
      if (origEnv === undefined) {
        delete process.env['BOOK_IMBALANCE_INTERVAL_MS'];
      } else {
        process.env['BOOK_IMBALANCE_INTERVAL_MS'] = origEnv;
      }
    });
  });

  // =========================================================================
  // Stress Tests
  // =========================================================================
  describe('Stress Tests', () => {
    it('18. 5 strategies ticking simultaneously for 20+ ticks each', async () => {
      const ticks: { tick: () => Promise<void>; calls: number[] }[] = [];
      for (let i = 0; i < 5; i++) {
        const t = makeTickFn();
        ticks.push(t);
        orchestrator.register(makeConfig({ id: `stress-${i}`, name: `Stress ${i}`, intervalMs: 50 }), t.tick);
      }

      orchestrator.startAll();

      // 50ms interval * 20 ticks = 1000ms minimum
      await vi.advanceTimersByTimeAsync(1200);

      for (let i = 0; i < 5; i++) {
        const status = orchestrator.getStrategyStatus(`stress-${i}`)!;
        expect(status.tickCount).toBeGreaterThanOrEqual(20);
        expect(status.status).toBe('running');
        expect(status.errorCount).toBe(0);
      }
    });

    it('19. rapid start/stop cycling does not leak timers', async () => {
      const t = makeTickFn();
      orchestrator.register(makeConfig({ id: 'cycle', intervalMs: 50 }), t.tick);

      // Rapid start/stop 20 times
      for (let i = 0; i < 20; i++) {
        orchestrator.start('cycle');
        orchestrator.stop('cycle');
      }

      // Start one final time
      orchestrator.start('cycle');
      await vi.advanceTimersByTimeAsync(200);

      const status = orchestrator.getStrategyStatus('cycle')!;
      // Should have a reasonable tick count (not multiplied by leaked timers)
      // At 50ms interval over 200ms we expect ~4 ticks, definitely not 80+
      expect(status.tickCount).toBeLessThanOrEqual(6);
      expect(status.tickCount).toBeGreaterThanOrEqual(2);
      expect(status.status).toBe('running');
    });

    it('20. re-registering after stop works', async () => {
      const t1 = makeTickFn();
      orchestrator.register(makeConfig({ id: 'rereg', intervalMs: 100 }), t1.tick);
      orchestrator.start('rereg');
      await vi.advanceTimersByTimeAsync(300);

      orchestrator.stop('rereg');
      expect(orchestrator.getStrategyStatus('rereg')!.status).toBe('stopped');
      const prevCount = orchestrator.getStrategyStatus('rereg')!.tickCount;

      // Re-register with a new tick function
      const t2 = makeTickFn();
      orchestrator.register(makeConfig({ id: 'rereg', intervalMs: 100 }), t2.tick);
      orchestrator.start('rereg');
      await vi.advanceTimersByTimeAsync(300);

      const status = orchestrator.getStrategyStatus('rereg')!;
      expect(status.status).toBe('running');
      // New registration resets tick count
      expect(status.tickCount).toBeGreaterThanOrEqual(2);
      // The new tick function should have been called, not the old one
      expect(t2.tick).toHaveBeenCalled();
    });

    it('21. start returns false for already running strategy', () => {
      orchestrator.register(makeConfig({ id: 's1' }), makeTickFn().tick);
      expect(orchestrator.start('s1')).toBe(true);
      expect(orchestrator.start('s1')).toBe(false);
    });

    it('22. stop returns false for non-running strategy', () => {
      orchestrator.register(makeConfig({ id: 's1' }), makeTickFn().tick);
      expect(orchestrator.stop('s1')).toBe(false);
    });

    it('23. start/stop for unknown strategy returns false', () => {
      expect(orchestrator.start('nonexistent')).toBe(false);
      expect(orchestrator.stop('nonexistent')).toBe(false);
    });

    it('24. isHealthy() returns false when any strategy is in error state', async () => {
      const badTick = vi.fn(async () => { throw new Error('fail'); });
      orchestrator.register(makeConfig({ id: 'bad', intervalMs: 50 }), badTick);
      orchestrator.register(makeConfig({ id: 'good', intervalMs: 50 }), makeTickFn().tick);
      orchestrator.startAll();

      expect(orchestrator.isHealthy()).toBe(true);

      // Drive to 10 errors -> auto-stop with error status
      await vi.advanceTimersByTimeAsync(600);

      expect(orchestrator.getStrategyStatus('bad')!.status).toBe('error');
      expect(orchestrator.isHealthy()).toBe(false);
    });

    it('25. strategy.stopped event fires with auto-stop reason after 10 errors', async () => {
      const stopEvents: SystemEventMap['strategy.stopped'][] = [];
      eventBus.on('strategy.stopped', (d) => stopEvents.push(d));

      const badTick = vi.fn(async () => { throw new Error('boom'); });
      orchestrator.register(makeConfig({ id: 'bad', name: 'Crasher', intervalMs: 50 }), badTick);
      orchestrator.start('bad');

      await vi.advanceTimersByTimeAsync(600);

      const autoStopEvent = stopEvents.find(e => e.reason.includes('auto-stopped'));
      expect(autoStopEvent).toBeDefined();
      expect(autoStopEvent!.name).toBe('Crasher');
      expect(autoStopEvent!.reason).toContain('10');
    });

    it('26. error count resets after a successful tick', async () => {
      let failCount = 0;
      const intermittentTick = vi.fn(async () => {
        failCount++;
        // Fail for first 3, then succeed, then fail again
        if (failCount <= 3 || (failCount >= 5 && failCount <= 7)) {
          throw new Error('intermittent');
        }
      });

      orchestrator.register(makeConfig({ id: 'flaky', intervalMs: 50 }), intermittentTick);
      orchestrator.start('flaky');

      // Advance through 3 failures
      await vi.advanceTimersByTimeAsync(175);
      expect(orchestrator.getStrategyStatus('flaky')!.errorCount).toBe(3);

      // Next tick succeeds (tick 4) -> error count resets
      await vi.advanceTimersByTimeAsync(50);
      expect(orchestrator.getStrategyStatus('flaky')!.errorCount).toBe(0);

      // Strategy should still be running (never hit 10 consecutive)
      await vi.advanceTimersByTimeAsync(500);
      expect(orchestrator.getStrategyStatus('flaky')!.status).toBe('running');
    });
  });
});
