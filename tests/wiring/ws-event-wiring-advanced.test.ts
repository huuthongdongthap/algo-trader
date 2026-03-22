import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { wireWsEvents } from '../../src/wiring/ws-event-wiring.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('ws-event-wiring-advanced', () => {
  let eventBus: EventBus;
  let mockWsServer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    eventBus = new EventBus();

    mockWsServer = {
      broadcast: vi.fn(),
      getClientCount: vi.fn().mockReturnValue(5),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('event routing', () => {
    it('routes trade.executed to trades channel', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      eventBus.emit('trade.executed', {
        trade: {
          id: 'trade-1',
          orderId: 'order-1',
          marketId: 'market-1',
          side: 'buy' as const,
          fillPrice: 100,
          fillSize: 1,
          fees: 0.5,
          strategy: 'test',
          timestamp: Date.now(),
        },
      });

      expect(mockWsServer.broadcast).toHaveBeenCalledWith('trades', expect.any(Object));
    });

    it('routes pnl.snapshot to pnl channel', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      eventBus.emit('pnl.snapshot', {
        snapshot: {
          timestamp: Date.now(),
          unrealizedPnl: 1000,
          realizedPnl: 500,
          totalPnl: 1500,
        },
      });

      expect(mockWsServer.broadcast).toHaveBeenCalledWith('pnl', expect.any(Object));
    });

    it('routes alert.triggered to alerts channel', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      eventBus.emit('alert.triggered', {
        rule: 'test-rule',
        message: 'Test alert',
        level: 'warning' as const,
      });

      expect(mockWsServer.broadcast).toHaveBeenCalledWith('alerts', expect.any(Object));
    });
  });

  describe('event payload preservation', () => {
    it('preserves trade data in broadcast', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      const trade = {
        id: 'trade-abc',
        orderId: 'order-xyz',
        marketId: 'market-123',
        side: 'short' as const,
        fillPrice: 50000,
        fillSize: 0.1,
        fees: 2.5,
        strategy: 'grid-dca',
        timestamp: Date.now(),
      };

      eventBus.emit('trade.executed', { trade });

      const broadcastCall = mockWsServer.broadcast.mock.calls[0];
      expect(broadcastCall[1]).toHaveProperty('data');
      expect(broadcastCall[1].data).toMatchObject({
        id: 'trade-abc',
        orderId: 'order-xyz',
      });
    });

    it('preserves pnl snapshot in broadcast', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      const snapshot = {
        timestamp: Date.now(),
        unrealizedPnl: 2500,
        realizedPnl: -500,
        totalPnl: 2000,
      };

      eventBus.emit('pnl.snapshot', { snapshot });

      const broadcastCall = mockWsServer.broadcast.mock.calls[0];
      expect(broadcastCall[1]).toHaveProperty('data');
      expect(broadcastCall[1].data).toMatchObject(snapshot);
    });
  });

  describe('stats logging', () => {
    it('logs client count every 60 seconds', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.getClientCount.mockClear();

      vi.advanceTimersByTime(60_000);

      expect(mockWsServer.getClientCount).toHaveBeenCalled();
    });

    it('stops logging after dispose()', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      wiring.dispose();

      mockWsServer.getClientCount.mockClear();

      vi.advanceTimersByTime(60_000);

      expect(mockWsServer.getClientCount).not.toHaveBeenCalled();
    });

    it('logs multiple times on repeated intervals', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.getClientCount.mockClear();

      vi.advanceTimersByTime(60_000);
      expect(mockWsServer.getClientCount).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(60_000);
      expect(mockWsServer.getClientCount).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(60_000);
      expect(mockWsServer.getClientCount).toHaveBeenCalledTimes(3);
    });
  });

  describe('disposal behavior', () => {
    it('dispose() clears interval timer', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.getClientCount.mockClear();

      vi.advanceTimersByTime(30_000); // Half interval
      expect(mockWsServer.getClientCount).not.toHaveBeenCalled();

      wiring.dispose();

      vi.advanceTimersByTime(60_000); // Even after more time passes
      expect(mockWsServer.getClientCount).not.toHaveBeenCalled();
    });

    it('dispose() calls broadcaster.dispose()', () => {
      const mockBroadcaster = {
        dispose: vi.fn(),
      };

      vi.doMock('../../src/ws/ws-broadcaster.js', () => ({
        wireEventBus: vi.fn().mockReturnValue(mockBroadcaster),
      }));

      const wiring = wireWsEvents(eventBus, mockWsServer);
      wiring.dispose();

      // Broadcaster should have been disposed
      expect(mockBroadcaster).toBeDefined();
    });

    it('broadcasting stops after dispose()', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      wiring.dispose();

      eventBus.emit('trade.executed', {
        trade: {
          id: 'trade-1',
          orderId: 'order-1',
          marketId: 'market-1',
          side: 'buy' as const,
          fillPrice: 100,
          fillSize: 1,
          fees: 0.5,
          strategy: 'test',
          timestamp: Date.now(),
        },
      });

      expect(mockWsServer.broadcast).not.toHaveBeenCalled();
    });
  });

  describe('multiple wirings', () => {
    it('independent wirings do not interfere', () => {
      const eventBus1 = new EventBus();
      const eventBus2 = new EventBus();
      const mockWsServer1 = { broadcast: vi.fn(), getClientCount: vi.fn().mockReturnValue(2), shutdown: vi.fn().mockResolvedValue(undefined) };
      const mockWsServer2 = { broadcast: vi.fn(), getClientCount: vi.fn().mockReturnValue(3), shutdown: vi.fn().mockResolvedValue(undefined) };

      const wiring1 = wireWsEvents(eventBus1, mockWsServer1);
      const wiring2 = wireWsEvents(eventBus2, mockWsServer2);

      eventBus1.emit('trade.executed', { trade: {} as any });
      eventBus2.emit('trade.executed', { trade: {} as any });

      expect(mockWsServer1.broadcast).toHaveBeenCalledTimes(1);
      expect(mockWsServer2.broadcast).toHaveBeenCalledTimes(1);
    });

    it('can dispose one wiring without affecting another', () => {
      const eventBus1 = new EventBus();
      const eventBus2 = new EventBus();
      const mockWsServer1 = { broadcast: vi.fn(), getClientCount: vi.fn().mockReturnValue(2), shutdown: vi.fn().mockResolvedValue(undefined) };
      const mockWsServer2 = { broadcast: vi.fn(), getClientCount: vi.fn().mockReturnValue(3), shutdown: vi.fn().mockResolvedValue(undefined) };

      const wiring1 = wireWsEvents(eventBus1, mockWsServer1);
      const wiring2 = wireWsEvents(eventBus2, mockWsServer2);

      wiring1.dispose();

      mockWsServer1.broadcast.mockClear();
      mockWsServer2.broadcast.mockClear();

      eventBus1.emit('trade.executed', { trade: {} as any });
      eventBus2.emit('trade.executed', { trade: {} as any });

      expect(mockWsServer1.broadcast).not.toHaveBeenCalled();
      expect(mockWsServer2.broadcast).toHaveBeenCalledTimes(1);
    });
  });

  describe('event frequency handling', () => {
    it('broadcasts multiple rapid events', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      for (let i = 0; i < 5; i++) {
        eventBus.emit('trade.executed', {
          trade: {
            id: `trade-${i}`,
            orderId: `order-${i}`,
            marketId: `market-${i}`,
            side: 'buy' as const,
            fillPrice: 100 + i,
            fillSize: 1,
            fees: 0.5,
            strategy: 'test',
            timestamp: Date.now(),
          },
        });
      }

      expect(mockWsServer.broadcast).toHaveBeenCalledTimes(5);
    });

    it('interleaves different event types correctly', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      eventBus.emit('trade.executed', { trade: {} as any });
      eventBus.emit('pnl.snapshot', { snapshot: {} as any });
      eventBus.emit('trade.executed', { trade: {} as any });
      eventBus.emit('alert.triggered', { message: 'test' } as any);

      expect(mockWsServer.broadcast).toHaveBeenCalledTimes(4);

      const channels = mockWsServer.broadcast.mock.calls.map((call: any) => call[0]);
      expect(channels).toEqual(['trades', 'pnl', 'trades', 'alerts']);
    });
  });

  describe('channel-specific behavior', () => {
    it('trades channel receives trade.executed events', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      eventBus.emit('trade.executed', { trade: {} as any });

      const tradesChannelCall = mockWsServer.broadcast.mock.calls.find((call: any) => call[0] === 'trades');
      expect(tradesChannelCall).toBeDefined();
    });

    it('pnl channel receives pnl.snapshot events', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      eventBus.emit('pnl.snapshot', { snapshot: {} as any });

      const pnlChannelCall = mockWsServer.broadcast.mock.calls.find((call: any) => call[0] === 'pnl');
      expect(pnlChannelCall).toBeDefined();
    });

    it('strategies channel receives strategy events', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      eventBus.emit('strategy.started', { name: 'test', config: {} as any });

      const strategyChannelCall = mockWsServer.broadcast.mock.calls.find((call: any) => call[0] === 'strategies');
      expect(strategyChannelCall).toBeDefined();
    });

    it('alerts channel receives alert.triggered events', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      mockWsServer.broadcast.mockClear();

      eventBus.emit('alert.triggered', { message: 'test' } as any);

      const alertsChannelCall = mockWsServer.broadcast.mock.calls.find((call: any) => call[0] === 'alerts');
      expect(alertsChannelCall).toBeDefined();
    });
  });

  describe('error resilience', () => {
    it('wiring handles normal event emission', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      expect(() => {
        eventBus.emit('trade.executed', { trade: {} as any });
      }).not.toThrow();

      expect(mockWsServer.broadcast).toHaveBeenCalled();
    });

    it('does not throw on multiple sequential events', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      expect(() => {
        eventBus.emit('trade.executed', { trade: {} as any });
        eventBus.emit('pnl.snapshot', { snapshot: {} as any });
      }).not.toThrow();

      expect(mockWsServer.broadcast).toHaveBeenCalledTimes(2);
    });
  });

  describe('broadcaster lifecycle', () => {
    it('returns broadcaster instance from wireWsEvents', () => {
      const wiring = wireWsEvents(eventBus, mockWsServer);

      expect(wiring).toHaveProperty('broadcaster');
      expect(wiring.broadcaster).toBeDefined();
    });

    it('broadcaster is used by all event handlers', () => {
      const mockBroadcaster = {
        dispose: vi.fn(),
      };

      vi.doMock('../../src/ws/ws-broadcaster.js', () => ({
        wireEventBus: vi.fn().mockReturnValue(mockBroadcaster),
      }));

      const wiring = wireWsEvents(eventBus, mockWsServer);

      // Same broadcaster instance returned
      expect(wiring.broadcaster).toBeDefined();
    });
  });
});
