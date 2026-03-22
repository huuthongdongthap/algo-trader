import { describe, it, expect, beforeEach, vi } from 'vitest';
import { wireTradeEvents, wireStrategyEvents, wireSystemEvents } from '../../src/wiring/event-wiring.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('event-wiring', () => {
  let eventBus: EventBus;
  let mockAudit: any;
  let mockPortfolio: any;
  let mockNotifications: any;
  let mockMetering: any;

  beforeEach(() => {
    eventBus = new EventBus();
    vi.clearAllMocks();

    mockAudit = {
      logEvent: vi.fn(),
    };

    mockPortfolio = {
      addTrade: vi.fn(),
      getTrades: vi.fn().mockReturnValue([]),
    };

    mockNotifications = {
      send: vi.fn().mockResolvedValue(undefined),
      sendTradeAlert: vi.fn().mockResolvedValue(undefined),
    };

    mockMetering = {
      recordCall: vi.fn(),
    };
  });

  describe('wireTradeEvents', () => {
    it('registers trade.executed and trade.failed handlers', () => {
      const onSpy = vi.spyOn(eventBus, 'on');

      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      expect(onSpy).toHaveBeenCalledWith('trade.executed', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('trade.failed', expect.any(Function));
    });

    it('logs trade.executed event to audit', () => {
      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      const trade = {
        orderId: 'order-1',
        marketId: 'market-123',
        side: 'buy' as const,
        fillPrice: 100,
        fillSize: 1,
        fees: 0.5,
        strategy: 'polymarket-arb',
        timestamp: Date.now(),
      };

      eventBus.emit('trade.executed', { trade });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'trade',
          action: 'trade.executed',
          details: expect.objectContaining({
            orderId: 'order-1',
            marketId: 'market-123',
          }),
        })
      );
    });

    it('adds trade to portfolio on trade.executed', () => {
      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      const trade = {
        orderId: 'order-1',
        marketId: 'market-123',
        side: 'buy' as const,
        fillPrice: 100,
        fillSize: 1,
        fees: 0.5,
        strategy: 'polymarket-arb',
        timestamp: Date.now(),
      };

      eventBus.emit('trade.executed', { trade });

      expect(mockPortfolio.addTrade).toHaveBeenCalledWith(trade);
    });

    it('sends trade alert on trade.executed', () => {
      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      const trade = {
        orderId: 'order-1',
        marketId: 'market-123',
        side: 'buy' as const,
        fillPrice: 100,
        fillSize: 1,
        fees: 0.5,
        strategy: 'polymarket-arb',
        timestamp: Date.now(),
      };

      eventBus.emit('trade.executed', { trade });

      expect(mockNotifications.sendTradeAlert).toHaveBeenCalledWith(trade);
    });

    it('records metering call on trade.executed', () => {
      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      const trade = {
        orderId: 'order-1',
        marketId: 'market-123',
        side: 'buy' as const,
        fillPrice: 100,
        fillSize: 1,
        fees: 0.5,
        strategy: 'test-strategy',
        timestamp: Date.now(),
      };

      eventBus.emit('trade.executed', { trade });

      expect(mockMetering.recordCall).toHaveBeenCalledWith('test-strategy', 'trade.executed', 0);
    });

    it('logs trade.failed event to audit only', () => {
      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      mockAudit.logEvent.mockClear();

      const error = 'Insufficient balance';
      const request = { marketId: 'market-123' };

      eventBus.emit('trade.failed', { error, request });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'trade',
          action: 'trade.failed',
        })
      );

      expect(mockPortfolio.addTrade).not.toHaveBeenCalled();
      expect(mockNotifications.sendTradeAlert).not.toHaveBeenCalled();
    });
  });

  describe('wireStrategyEvents', () => {
    it('registers strategy lifecycle event handlers', () => {
      const onSpy = vi.spyOn(eventBus, 'on');

      wireStrategyEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      expect(onSpy).toHaveBeenCalledWith('strategy.started', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('strategy.stopped', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('strategy.error', expect.any(Function));
    });

    it('logs and notifies on strategy.started', () => {
      wireStrategyEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      const config = { id: 'test-strat', name: 'Test Strategy', type: 'test' as const, enabled: true, params: {}, intervalMs: 30000 };

      eventBus.emit('strategy.started', { name: 'Test Strategy', config });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'config',
          action: 'strategy.started',
        })
      );

      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.stringContaining('Strategy started: Test Strategy')
      );
    });

    it('logs and notifies on strategy.stopped', () => {
      wireStrategyEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      mockAudit.logEvent.mockClear();
      mockNotifications.send.mockClear();

      eventBus.emit('strategy.stopped', { name: 'Test Strategy', reason: 'manual stop' });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'config',
          action: 'strategy.stopped',
        })
      );

      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.stringContaining('Strategy stopped: Test Strategy — manual stop')
      );
    });

    it('logs and notifies on strategy.error', () => {
      wireStrategyEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      mockAudit.logEvent.mockClear();
      mockNotifications.send.mockClear();

      eventBus.emit('strategy.error', { name: 'Test Strategy', error: 'Connection timeout' });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'system',
          action: 'strategy.error',
        })
      );

      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.stringContaining('Strategy error [Test Strategy]: Connection timeout')
      );
    });
  });

  describe('wireSystemEvents', () => {
    it('registers system lifecycle event handlers', () => {
      const onSpy = vi.spyOn(eventBus, 'on');

      wireSystemEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      expect(onSpy).toHaveBeenCalledWith('system.startup', expect.any(Function));
      expect(onSpy).toHaveBeenCalledWith('system.shutdown', expect.any(Function));
    });

    it('logs and notifies on system.startup', () => {
      wireSystemEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      eventBus.emit('system.startup', { version: '0.1.0', timestamp: Date.now() });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'system',
          action: 'system.startup',
          details: expect.objectContaining({
            version: '0.1.0',
          }),
        })
      );

      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.stringContaining('System started — v0.1.0')
      );
    });

    it('logs and notifies on system.shutdown', () => {
      wireSystemEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      mockAudit.logEvent.mockClear();
      mockNotifications.send.mockClear();

      eventBus.emit('system.shutdown', { reason: 'manual shutdown' });

      expect(mockAudit.logEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'system',
          action: 'system.shutdown',
          details: expect.objectContaining({
            reason: 'manual shutdown',
          }),
        })
      );

      expect(mockNotifications.send).toHaveBeenCalledWith(
        expect.stringContaining('System shutting down — manual shutdown')
      );
    });
  });

  describe('multiple event wiring', () => {
    it('can wire all three event groups independently', () => {
      const onSpy = vi.spyOn(eventBus, 'on');

      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      wireStrategyEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      wireSystemEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      // Verify all handlers registered (2 + 3 + 2 = 7)
      expect(onSpy).toHaveBeenCalledTimes(7);
    });

    it('does not interfere when wiring events sequentially', () => {
      wireTradeEvents(eventBus, {
        audit: mockAudit,
        portfolio: mockPortfolio,
        notifications: mockNotifications,
        metering: mockMetering,
      });

      const trade = {
        orderId: 'order-1',
        marketId: 'market-123',
        side: 'buy' as const,
        fillPrice: 100,
        fillSize: 1,
        fees: 0.5,
        strategy: 'test-strategy',
        timestamp: Date.now(),
      };

      eventBus.emit('trade.executed', { trade });

      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockPortfolio.addTrade).toHaveBeenCalledTimes(1);

      wireStrategyEvents(eventBus, {
        audit: mockAudit,
        notifications: mockNotifications,
      });

      mockAudit.logEvent.mockClear();
      mockPortfolio.addTrade.mockClear();

      eventBus.emit('strategy.started', { name: 'Test Strategy', config: {} as any });

      expect(mockAudit.logEvent).toHaveBeenCalledTimes(1);
      expect(mockPortfolio.addTrade).not.toHaveBeenCalled();
    });
  });
});
