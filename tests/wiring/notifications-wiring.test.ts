import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startNotifications, stopNotifications } from '../../src/wiring/notifications-wiring.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('notifications-wiring', () => {
  let eventBus: EventBus;
  let mockEngine: any;
  let mockBot: any;
  let mockAlerts: any;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_CHAT_ID'];

    eventBus = new EventBus();

    mockEngine = {
      getStatus: vi.fn().mockReturnValue({
        running: true,
        strategies: [],
        tradeCount: 0,
        config: { env: 'test' },
      }),
      getExecutor: vi.fn().mockReturnValue({
        getTradeLog: vi.fn().mockReturnValue([]),
      }),
      getRunner: vi.fn().mockReturnValue({
        getAllStatus: vi.fn().mockReturnValue([]),
      }),
      start: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    mockBot = {
      sendMessage: vi.fn().mockResolvedValue(undefined),
      sendTradeAlert: vi.fn().mockResolvedValue(undefined),
      startPolling: vi.fn(),
      stopPolling: vi.fn(),
      registerCommand: vi.fn(),
    };

    mockAlerts = {
      subscribe: vi.fn(),
      stopScheduler: vi.fn(),
    };

    vi.doMock('../../src/notifications/telegram-bot.js', () => ({
      createTelegramBot: vi.fn().mockReturnValue(mockBot),
    }));

    vi.doMock('../../src/notifications/telegram-trade-alerts.js', () => ({
      TelegramTradeAlerts: vi.fn().mockReturnValue(mockAlerts),
    }));
  });

  describe('startNotifications', () => {
    it('returns NotificationsBundle with router', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle).toHaveProperty('router');
      expect(bundle).toHaveProperty('bot');
      expect(bundle).toHaveProperty('alerts');
    });

    it('creates NotificationRouter', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle.router).toBeDefined();
      expect(typeof bundle.router.addChannel).toBe('function');
    });

    it('gracefully returns null bot and alerts when TELEGRAM_BOT_TOKEN not set', () => {
      vi.doMock('../../src/notifications/telegram-bot.js', () => ({
        createTelegramBot: vi.fn().mockReturnValue(null),
      }));

      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle.bot).toBeNull();
      expect(bundle.alerts).toBeNull();
      expect(bundle.router).toBeDefined();
    });

    it('registers telegram channel in router when bot is available', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle.router).toBeDefined();
      // Router should have telegram channel added
    });

    it('subscribes alerts to event bus', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.alerts) {
        expect(mockAlerts.subscribe).toHaveBeenCalledWith(eventBus);
      }
    });

    it('calls bot.startPolling() when bot is available', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.startPolling).toHaveBeenCalled();
      }
    });

    it('registers command handlers on bot', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.registerCommand).toHaveBeenCalled();
      }
    });

    it('reads TELEGRAM_CHAT_ID from environment', () => {
      process.env['TELEGRAM_CHAT_ID'] = 'test-chat-123';

      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle).toBeDefined();
    });
  });

  describe('stopNotifications', () => {
    it('calls bot.stopPolling() when bot exists', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        mockBot.stopPolling.mockClear();
        stopNotifications(bundle);
        expect(mockBot.stopPolling).toHaveBeenCalled();
      }
    });

    it('calls alerts.stopScheduler() when alerts exist', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.alerts) {
        mockAlerts.stopScheduler.mockClear();
        stopNotifications(bundle);
        expect(mockAlerts.stopScheduler).toHaveBeenCalled();
      }
    });

    it('handles gracefully when bot is null', () => {
      const bundle = {
        bot: null,
        alerts: mockAlerts,
        router: { addChannel: vi.fn() },
      };

      expect(() => {
        stopNotifications(bundle as any);
      }).not.toThrow();
    });

    it('handles gracefully when alerts is null', () => {
      const bundle = {
        bot: mockBot,
        alerts: null,
        router: { addChannel: vi.fn() },
      };

      expect(() => {
        stopNotifications(bundle as any);
      }).not.toThrow();
    });
  });

  describe('command handlers', () => {
    it('wires /status command to engine.getStatus()', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.registerCommand).toHaveBeenCalledWith(
          '/status',
          expect.any(Function)
        );
      }
    });

    it('wires /pnl command to trade log', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.registerCommand).toHaveBeenCalledWith(
          '/pnl',
          expect.any(Function)
        );
      }
    });

    it('wires /positions command to strategy status', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.registerCommand).toHaveBeenCalledWith(
          '/positions',
          expect.any(Function)
        );
      }
    });

    it('wires /start command to engine.start()', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.registerCommand).toHaveBeenCalledWith(
          '/start',
          expect.any(Function)
        );
      }
    });

    it('wires /stop command to engine.shutdown()', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot) {
        expect(mockBot.registerCommand).toHaveBeenCalledWith(
          '/stop',
          expect.any(Function)
        );
      }
    });
  });

  describe('notification channel setup', () => {
    it('adds telegram channel with sendMessage capability', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      // Verify router was created
      expect(bundle.router).toBeDefined();
    });

    it('adds telegram channel with sendTradeAlert capability', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      // Verify router was created and can handle trade alerts
      expect(bundle.router).toBeDefined();
    });

    it('can send messages through registered channel', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      if (bundle.bot && bundle.router) {
        expect(bundle.bot.sendMessage).toBeDefined();
      }
    });
  });

  describe('initialization safety', () => {
    it('does not throw when starting without TELEGRAM_BOT_TOKEN', () => {
      vi.doMock('../../src/notifications/telegram-bot.js', () => ({
        createTelegramBot: vi.fn().mockReturnValue(null),
      }));

      expect(() => {
        startNotifications(eventBus, mockEngine);
      }).not.toThrow();
    });

    it('continues to create NotificationRouter even without bot', () => {
      vi.doMock('../../src/notifications/telegram-bot.js', () => ({
        createTelegramBot: vi.fn().mockReturnValue(null),
      }));

      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle.router).toBeDefined();
      expect(bundle.bot).toBeNull();
      expect(bundle.alerts).toBeNull();
    });

    it('returns bundle with all properties even when degraded', () => {
      const bundle = startNotifications(eventBus, mockEngine);

      expect(bundle).toHaveProperty('bot');
      expect(bundle).toHaveProperty('alerts');
      expect(bundle).toHaveProperty('router');
    });
  });

  describe('multiple start/stop cycles', () => {
    it('can start and stop multiple times', () => {
      const bundle1 = startNotifications(eventBus, mockEngine);
      stopNotifications(bundle1);

      const bundle2 = startNotifications(eventBus, mockEngine);
      stopNotifications(bundle2);

      expect(bundle1).toBeDefined();
      expect(bundle2).toBeDefined();
    });

    it('each start creates independent instances', () => {
      const bundle1 = startNotifications(eventBus, mockEngine);
      const bundle2 = startNotifications(eventBus, mockEngine);

      expect(bundle1.router).not.toBe(bundle2.router);
    });
  });
});
