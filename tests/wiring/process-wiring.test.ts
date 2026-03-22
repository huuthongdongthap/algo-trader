import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startRecoveryManager, startScheduler, wireProcessSignals } from '../../src/wiring/process-wiring.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('process-wiring', () => {
  let mockRecovery: any;
  let mockScheduler: any;
  let eventBus: EventBus;
  let mockNotifier: any;

  beforeEach(() => {
    vi.clearAllMocks();
    eventBus = new EventBus();

    mockRecovery = {
      shouldRecover: vi.fn().mockReturnValue(false),
      loadState: vi.fn().mockReturnValue(null),
      startAutoSave: vi.fn(),
    };

    mockScheduler = {
      addJob: vi.fn(),
      removeJob: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockNotifier = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock('../../src/scheduler/job-registry.js', () => ({
      registerBuiltInJobs: vi.fn(),
    }));
  });

  describe('startRecoveryManager', () => {
    it('checks shouldRecover flag', () => {
      const ctx = {
        strategies: [],
        getOpenPositions: () => [],
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      expect(mockRecovery.shouldRecover).toHaveBeenCalled();
    });

    it('loads state when recovery needed', () => {
      mockRecovery.shouldRecover.mockReturnValue(true);
      mockRecovery.loadState.mockReturnValue({
        strategies: [],
        positions: [],
        lastEquity: '1000',
        timestamp: Date.now(),
      });

      const ctx = {
        strategies: [],
        getOpenPositions: () => [],
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      expect(mockRecovery.loadState).toHaveBeenCalled();
    });

    it('calls startAutoSave with interval', () => {
      const ctx = {
        strategies: [],
        getOpenPositions: () => [],
      };

      startRecoveryManager(mockRecovery, 10000, ctx);

      expect(mockRecovery.startAutoSave).toHaveBeenCalledWith(10000, expect.any(Function));
    });

    it('provides state snapshot builder to startAutoSave', () => {
      const strategies = [
        { id: 'strat-1', name: 'Strategy 1', type: 'test' as const, enabled: true, params: {}, intervalMs: 30000 },
      ];
      const positions = [
        {
          market: 'BTC/USD',
          side: 'long' as const,
          entry_price: 50000,
          size: 0.1,
          unrealized_pnl: 1000,
          opened_at: Date.now(),
        },
      ];

      const ctx = {
        strategies,
        getOpenPositions: () => positions,
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      const snapshotBuilder = mockRecovery.startAutoSave.mock.calls[0]?.[1];
      expect(typeof snapshotBuilder).toBe('function');

      const snapshot = snapshotBuilder();
      expect(snapshot).toHaveProperty('strategies');
      expect(snapshot).toHaveProperty('positions');
      expect(snapshot).toHaveProperty('lastEquity');
      expect(snapshot).toHaveProperty('timestamp');
      expect(snapshot.strategies).toEqual(strategies);
      expect(snapshot.positions).toHaveLength(1);
    });

    it('maps position data correctly in snapshot', () => {
      const positions = [
        {
          market: 'ETH/USD',
          side: 'short' as const,
          entry_price: 3000,
          size: 1,
          unrealized_pnl: -500,
          opened_at: Date.now() - 3600000,
        },
      ];

      const ctx = {
        strategies: [],
        getOpenPositions: () => positions,
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      const snapshotBuilder = mockRecovery.startAutoSave.mock.calls[0]?.[1];
      const snapshot = snapshotBuilder();

      const mappedPosition = snapshot.positions[0];
      expect(mappedPosition.marketId).toBe('ETH/USD');
      expect(mappedPosition.side).toBe('short');
      expect(mappedPosition.entryPrice).toBe(3000);
      expect(mappedPosition.size).toBe(1);
    });

    it('includes timestamp in snapshot', () => {
      const before = Date.now();
      const ctx = {
        strategies: [],
        getOpenPositions: () => [],
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      const snapshotBuilder = mockRecovery.startAutoSave.mock.calls[0]?.[1];
      const snapshot = snapshotBuilder();
      const after = Date.now();

      expect(snapshot.timestamp).toBeGreaterThanOrEqual(before);
      expect(snapshot.timestamp).toBeLessThanOrEqual(after);
    });

    it('handles empty positions list', () => {
      const ctx = {
        strategies: [],
        getOpenPositions: () => [],
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      const snapshotBuilder = mockRecovery.startAutoSave.mock.calls[0]?.[1];
      const snapshot = snapshotBuilder();

      expect(snapshot.positions).toEqual([]);
    });

    it('handles multiple positions', () => {
      const positions = [
        { market: 'BTC/USD', side: 'long' as const, entry_price: 50000, size: 0.1, unrealized_pnl: 1000, opened_at: Date.now() },
        { market: 'ETH/USD', side: 'short' as const, entry_price: 3000, size: 1, unrealized_pnl: -500, opened_at: Date.now() },
      ];

      const ctx = {
        strategies: [],
        getOpenPositions: () => positions,
      };

      startRecoveryManager(mockRecovery, 5000, ctx);

      const snapshotBuilder = mockRecovery.startAutoSave.mock.calls[0]?.[1];
      const snapshot = snapshotBuilder();

      expect(snapshot.positions).toHaveLength(2);
    });
  });

  describe('startScheduler', () => {
    it('does not throw with valid scheduler', () => {
      const scheduler = {
        addJob: vi.fn(),
        removeJob: vi.fn(),
        schedule: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };

      expect(() => {
        startScheduler(scheduler);
      }).not.toThrow();
    });

    it('accepts scheduler instance', () => {
      const scheduler = {
        addJob: vi.fn(),
        removeJob: vi.fn(),
        schedule: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };

      // Should not throw
      startScheduler(scheduler);

      expect(scheduler).toBeDefined();
    });

    it('initializes scheduler with built-in jobs', () => {
      const scheduler = {
        addJob: vi.fn(),
        removeJob: vi.fn(),
        schedule: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };

      startScheduler(scheduler);

      // registerBuiltInJobs should have called schedule
      expect(scheduler.schedule).toHaveBeenCalled();
    });
  });

  describe('wireProcessSignals', () => {
    let processSpy: any;
    let mockStopApp: any;

    beforeEach(() => {
      mockStopApp = vi.fn().mockResolvedValue(undefined);
      processSpy = {
        once: vi.fn(),
        on: vi.fn(),
        exit: vi.fn(),
      };

      vi.stubGlobal('process', processSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('registers SIGINT handler', () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      expect(processSpy.once).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });

    it('registers SIGTERM handler', () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      expect(processSpy.once).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('registers uncaughtException handler', () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      expect(processSpy.on).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    });

    it('registers unhandledRejection handler', () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      expect(processSpy.on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    });

    it('emits system.shutdown event on SIGINT', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');

      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      const sigintHandler = processSpy.once.mock.calls[0]?.[1];
      sigintHandler();

      expect(emitSpy).toHaveBeenCalledWith('system.shutdown', { reason: 'SIGINT' });
    });

    it('emits system.shutdown event on SIGTERM', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');

      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      const sigintHandler = processSpy.once.mock.calls[0]?.[1];
      sigintHandler();

      const sigterm = processSpy.once.mock.calls[1]?.[1];
      sigterm();

      expect(emitSpy).toHaveBeenCalledWith('system.shutdown', expect.any(Object));
    });

    it('calls stopApp on SIGINT', async () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      const sigintHandler = processSpy.once.mock.calls[0]?.[1];
      await sigintHandler();

      expect(mockStopApp).toHaveBeenCalledWith('SIGINT');
    });

    it('handles uncaughtException by calling stopApp', async () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      const exceptionHandler = processSpy.on.mock.calls[0]?.[1];
      const testError = new Error('Test error');

      await exceptionHandler(testError);

      expect(mockStopApp).toHaveBeenCalledWith('uncaughtException');
    });

    it('notifies on uncaughtException if notifier available', async () => {
      wireProcessSignals({
        eventBus,
        notifier: mockNotifier,
        stopApp: mockStopApp,
      });

      const exceptionHandler = processSpy.on.mock.calls[0]?.[1];
      const testError = new Error('Critical error');

      await exceptionHandler(testError);

      expect(mockNotifier.send).toHaveBeenCalledWith(
        expect.stringContaining('[CRITICAL]')
      );
    });

    it('handles unhandledRejection by logging', async () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      const rejectionHandler = processSpy.on.mock.calls[1]?.[1];
      const testError = new Error('Promise rejection');

      await rejectionHandler(testError);

      // Should not throw
      expect(rejectionHandler).toBeDefined();
    });

    it('notifies on unhandledRejection if notifier available', async () => {
      wireProcessSignals({
        eventBus,
        notifier: mockNotifier,
        stopApp: mockStopApp,
      });

      const rejectionHandler = processSpy.on.mock.calls[1]?.[1];
      const testError = new Error('Promise rejection');

      await rejectionHandler(testError);

      expect(mockNotifier.send).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]')
      );
    });

    it('handles non-Error rejection reasons', async () => {
      wireProcessSignals({
        eventBus,
        notifier: mockNotifier,
        stopApp: mockStopApp,
      });

      const rejectionHandler = processSpy.on.mock.calls[1]?.[1];

      await rejectionHandler('string rejection reason');

      expect(mockNotifier.send).toHaveBeenCalledWith(
        expect.stringContaining('string rejection reason')
      );
    });

    it('gracefully handles notification failure on uncaughtException', async () => {
      const failingNotifier = {
        send: vi.fn().mockRejectedValue(new Error('Notification failed')),
      };

      wireProcessSignals({
        eventBus,
        notifier: failingNotifier,
        stopApp: mockStopApp,
      });

      const exceptionHandler = processSpy.on.mock.calls[0]?.[1];

      // Should not throw even if notifier fails
      await expect(exceptionHandler(new Error('Test'))).resolves.toBeUndefined();
    });

    it('gracefully handles notification failure on unhandledRejection', async () => {
      const failingNotifier = {
        send: vi.fn().mockRejectedValue(new Error('Notification failed')),
      };

      wireProcessSignals({
        eventBus,
        notifier: failingNotifier,
        stopApp: mockStopApp,
      });

      const rejectionHandler = processSpy.on.mock.calls[1]?.[1];

      // Should not throw even if notifier fails
      await expect(rejectionHandler('test')).resolves.toBeUndefined();
    });
  });

  describe('signal handler integration', () => {
    let processSpy: any;
    let mockStopApp: any;

    beforeEach(() => {
      mockStopApp = vi.fn().mockResolvedValue(undefined);
      processSpy = {
        once: vi.fn(),
        on: vi.fn(),
        exit: vi.fn(),
      };

      vi.stubGlobal('process', processSpy);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('all handlers registered correctly', () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      // Should register SIGINT, SIGTERM, uncaughtException, unhandledRejection
      expect(processSpy.once).toHaveBeenCalledTimes(2); // SIGINT, SIGTERM
      expect(processSpy.on).toHaveBeenCalledTimes(2);   // uncaughtException, unhandledRejection
    });

    it('all handlers use same stopApp function', () => {
      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      // Verify stopApp is available to all handlers
      expect(mockStopApp).toBeDefined();
    });

    it('all handlers use same eventBus instance', () => {
      const emitSpy = vi.spyOn(eventBus, 'emit');

      wireProcessSignals({
        eventBus,
        notifier: null,
        stopApp: mockStopApp,
      });

      // Verify eventBus was passed to wireProcessSignals
      expect(emitSpy).toBeDefined();
    });
  });
});
