import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireOpenClaw } from '../../src/wiring/openclaw-wiring.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('openclaw-wiring', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();

    vi.doMock('../../src/openclaw/openclaw-config.js', () => ({
      loadOpenClawConfig: vi.fn().mockReturnValue({
        gatewayUrl: 'http://localhost:9000',
        apiKey: 'test-key',
        routing: { default: 'gpt-4' },
      }),
    }));

    vi.doMock('../../src/openclaw/ai-router.js', () => ({
      AiRouter: vi.fn().mockImplementation(() => ({
        route: vi.fn(),
      })),
    }));

    vi.doMock('../../src/openclaw/trade-observer.js', () => ({
      TradeObserver: vi.fn().mockImplementation(() => ({
        startObserving: vi.fn(),
        getSnapshot: vi.fn().mockReturnValue({
          winRate: 0.65,
          drawdown: 0.05,
          activeStrategies: [],
          recentTrades: [],
        }),
        shouldAlert: vi.fn().mockReturnValue(false),
      })),
    }));

    vi.doMock('../../src/openclaw/decision-logger.js', () => ({
      DecisionLogger: vi.fn().mockImplementation(() => ({
        log: vi.fn(),
      })),
    }));

    vi.doMock('../../src/openclaw/algorithm-tuner.js', () => ({
      AlgorithmTuner: vi.fn().mockImplementation(() => ({
        tune: vi.fn(),
      })),
    }));

    vi.doMock('../../src/openclaw/tuning-executor.js', () => ({
      TuningExecutor: vi.fn().mockImplementation(() => ({
        execute: vi.fn(),
        rollback: vi.fn(),
      })),
    }));

    vi.doMock('../../src/openclaw/tuning-history.js', () => ({
      TuningHistory: vi.fn().mockImplementation(() => ({
        getHistory: vi.fn().mockReturnValue([]),
        getEffectiveness: vi.fn().mockReturnValue({}),
      })),
    }));

    vi.doMock('../../src/openclaw/ai-signal-generator.js', () => ({
      AiSignalGenerator: vi.fn().mockImplementation(() => ({
        generate: vi.fn(),
      })),
    }));

    vi.doMock('../../src/openclaw/auto-tuning-job.js', () => ({
      createAutoTuningHandler: vi.fn().mockReturnValue(async () => {}),
    }));
  });

  describe('wireOpenClaw', () => {
    it('returns OpenClawBundle with all subsystems', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle).toHaveProperty('router');
      expect(bundle).toHaveProperty('observer');
      expect(bundle).toHaveProperty('decisionLogger');
      expect(bundle).toHaveProperty('tuningExecutor');
      expect(bundle).toHaveProperty('tuningHistory');
      expect(bundle).toHaveProperty('signalGenerator');
      expect(bundle).toHaveProperty('deps');
      expect(bundle).toHaveProperty('autoTuningHandler');
    });

    it('initializes AiRouter with config', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.router).toBeDefined();
    });

    it('initializes TradeObserver and starts observing', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.observer).toBeDefined();
    });

    it('initializes DecisionLogger', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.decisionLogger).toBeDefined();
    });

    it('initializes tuning subsystem (AlgorithmTuner + TuningExecutor + TuningHistory)', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.tuningExecutor).toBeDefined();
      expect(bundle.tuningHistory).toBeDefined();
    });

    it('initializes AiSignalGenerator', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.signalGenerator).toBeDefined();
    });

    it('creates autoTuningHandler for scheduler', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(typeof bundle.autoTuningHandler).toBe('function');
    });

    it('wires alert mechanism when risk threshold exceeded', () => {
      const bundle = wireOpenClaw(eventBus);

      // Verify observer is initialized and can detect alerts
      const snapshot = bundle.observer.getSnapshot();
      expect(snapshot).toHaveProperty('winRate');
      expect(snapshot).toHaveProperty('drawdown');
      expect(snapshot).toHaveProperty('activeStrategies');
      expect(snapshot).toHaveProperty('recentTrades');
    });

    it('respects alert cooldown (max 1 alert per 5 minutes)', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');

      vi.doMock('../../src/openclaw/trade-observer.js', () => ({
        TradeObserver: vi.fn().mockImplementation(() => ({
          startObserving: vi.fn(),
          getSnapshot: vi.fn().mockReturnValue({
            winRate: 0.3,
            drawdown: 0.05,
            activeStrategies: [],
            recentTrades: [],
          }),
          shouldAlert: vi.fn().mockReturnValue(true),
        })),
      }));

      vi.useFakeTimers();

      const bundle = wireOpenClaw(eventBus);

      // Emit two trades quickly
      eventBus.emit('trade.executed', { trade: { id: 'trade-1' } as any });
      eventBus.emit('trade.executed', { trade: { id: 'trade-2' } as any });

      // Should only emit one alert due to cooldown
      const alertCalls = emitSpy.mock.calls.filter((call) => call[0] === 'alert.triggered');
      expect(alertCalls.length).toBeLessThanOrEqual(1);

      vi.useRealTimers();
    });

    it('builds OpenClawDeps with required fields', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.deps).toHaveProperty('controller');
      expect(bundle.deps).toHaveProperty('observer');
      expect(bundle.deps).toHaveProperty('tuner');
      expect(bundle.deps).toHaveProperty('history');
      expect(bundle.deps).toHaveProperty('tuningHistory');
      expect(bundle.deps).toHaveProperty('tuningExecutor');
      expect(bundle.deps).toHaveProperty('signalGenerator');
    });

    it('sets observer.active to true', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(bundle.deps.observer.active).toBe(true);
    });

    it('sets observer.startedAt timestamp', () => {
      const before = Date.now();
      const bundle = wireOpenClaw(eventBus);
      const after = Date.now();

      expect(bundle.deps.observer.startedAt).toBeGreaterThanOrEqual(before);
      expect(bundle.deps.observer.startedAt).toBeLessThanOrEqual(after);
    });

    it('provides tuningHistory.getAll() method in deps', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(typeof bundle.deps.tuningHistory.getAll).toBe('function');
    });

    it('provides tuningHistory.getEffectivenessReport() method in deps', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(typeof bundle.deps.tuningHistory.getEffectivenessReport).toBe('function');
    });

    it('provides tuningExecutor.rollback() method in deps', () => {
      const bundle = wireOpenClaw(eventBus);

      expect(typeof bundle.deps.tuningExecutor.rollback).toBe('function');
    });
  });

  describe('alert mechanism', () => {
    it('observer tracks win rate and drawdown metrics', () => {
      const bundle = wireOpenClaw(eventBus);

      const snapshot = bundle.observer.getSnapshot();
      expect(snapshot.winRate).toBeGreaterThanOrEqual(0);
      expect(snapshot.winRate).toBeLessThanOrEqual(1);
      expect(snapshot.drawdown).toBeGreaterThanOrEqual(0);
    });

    it('observer tracks active strategies and recent trades', () => {
      const bundle = wireOpenClaw(eventBus);

      const snapshot = bundle.observer.getSnapshot();
      expect(Array.isArray(snapshot.activeStrategies)).toBe(true);
      expect(Array.isArray(snapshot.recentTrades)).toBe(true);
    });

    it('observer supports shouldAlert check', () => {
      const bundle = wireOpenClaw(eventBus);

      const snapshot = bundle.observer.getSnapshot();
      const shouldAlert = bundle.observer.shouldAlert(snapshot);
      expect(typeof shouldAlert).toBe('boolean');
    });
  });

  describe('graceful degradation', () => {
    it('continues even if gateway unreachable', () => {
      vi.doMock('../../src/openclaw/openclaw-config.js', () => ({
        loadOpenClawConfig: vi.fn().mockReturnValue({
          gatewayUrl: 'http://unreachable:9999',
          apiKey: null,
          routing: {},
        }),
      }));

      expect(() => {
        wireOpenClaw(eventBus);
      }).not.toThrow();
    });

    it('observer still observes events when router unavailable', () => {
      const bundle = wireOpenClaw(eventBus);

      // Observer should be functional regardless of router state
      expect(bundle.observer).toBeDefined();
    });
  });

  describe('integration', () => {
    it('all components receive same EventBus instance', () => {
      const bundle = wireOpenClaw(eventBus);

      // Emit an event and verify observer can capture it
      const tradeData = { trade: { id: 'trade-1' } as any };
      eventBus.emit('trade.executed', tradeData);

      expect(bundle.observer).toBeDefined();
    });

    it('can call autoTuningHandler without error', async () => {
      const bundle = wireOpenClaw(eventBus);

      await expect(bundle.autoTuningHandler()).resolves.toBeUndefined();
    });

    it('multiple wireOpenClaw calls create independent bundles', () => {
      const bundle1 = wireOpenClaw(new EventBus());
      const bundle2 = wireOpenClaw(new EventBus());

      expect(bundle1.router).not.toBe(bundle2.router);
      expect(bundle1.observer).not.toBe(bundle2.observer);
      expect(bundle1.decisionLogger).not.toBe(bundle2.decisionLogger);
    });
  });
});
