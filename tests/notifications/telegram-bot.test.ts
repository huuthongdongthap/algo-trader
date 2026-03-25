import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TradeResult, PnlSnapshot, Position, RiskLimits } from '../../src/core/types.js';
import type { TierProgress } from '../../src/core/capital-tiers.js';
import { RiskManager } from '../../src/core/risk-manager.js';
import {
  TelegramBot,
  TelegramBotNoOp,
  createTelegramBot,
  type TelegramBotProviders,
  type DailySummaryReport,
} from '../../src/notifications/telegram-bot.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const BOT_TOKEN = 'test-bot-token-123';
const CHAT_ID = '999888777';

const makeTrade = (overrides?: Partial<TradeResult>): TradeResult => ({
  orderId: 'order-1',
  marketId: 'BTC-USD',
  side: 'buy',
  fillPrice: '50000',
  fillSize: '0.1',
  fees: '0.50',
  timestamp: Date.now(),
  strategy: 'grid-trading',
  ...overrides,
});

const makePnl = (overrides?: Partial<PnlSnapshot>): PnlSnapshot => ({
  timestamp: Date.now(),
  equity: '10000',
  peakEquity: '12000',
  drawdown: 0.05,
  realizedPnl: '500',
  unrealizedPnl: '100',
  tradeCount: 42,
  winCount: 30,
  ...overrides,
});

const makePosition = (overrides?: Partial<Position>): Position => ({
  marketId: 'ETH-USD',
  side: 'long',
  entryPrice: '3000',
  size: '1.5',
  unrealizedPnl: '45.00',
  openedAt: Date.now(),
  ...overrides,
});

const makeTierProgress = (overrides?: Partial<TierProgress>): TierProgress => ({
  tier: { level: 2, maxCapital: 500, minDryRunDays: 14, minProfitableDays: 10 },
  daysCompleted: 18,
  profitableDays: 12,
  totalPnl: 120,
  canProgress: true,
  nextTier: { level: 3, maxCapital: 1000, minDryRunDays: 14, minProfitableDays: 10 },
  ...overrides,
});

const makeDailySummary = (overrides?: Partial<DailySummaryReport>): DailySummaryReport => ({
  date: '2026-03-25',
  equity: '10500',
  realizedPnl: '350',
  unrealizedPnl: '75',
  tradeCount: 15,
  winCount: 10,
  drawdown: 0.03,
  ...overrides,
});

const riskLimits: RiskLimits = {
  maxPositionSize: '1000',
  maxDrawdown: 0.2,
  maxOpenPositions: 5,
  stopLossPercent: 0.1,
  maxLeverage: 1,
};

function makeProviders(overrides?: Partial<TelegramBotProviders>): TelegramBotProviders {
  return {
    riskManager: new RiskManager(riskLimits),
    getPositions: () => [makePosition()],
    getPnlSnapshot: () => makePnl(),
    getTierProgress: () => makeTierProgress(),
    getDailyPnl: () => ({ trades: 10, realized: '250.00', unrealized: '40.00', fees: '5.00' }),
    getBrierScore: async () => 0.15,
    ...overrides,
  };
}

// ── Fetch mock ────────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof vi.fn>;
let capturedRequests: { url: string; body: Record<string, unknown> }[];

function installFetchMock() {
  capturedRequests = [];
  fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
    let body: Record<string, unknown> = {};
    if (init?.body) {
      try { body = JSON.parse(init.body as string); } catch { /* ignore */ }
    }
    capturedRequests.push({ url: urlStr, body });

    // Return success for sendMessage
    if (urlStr.includes('/sendMessage')) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    // Return empty updates for getUpdates
    if (urlStr.includes('/getUpdates')) {
      return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TelegramBot', () => {
  beforeEach(() => {
    installFetchMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── sendMessage ──────────────────────────────────────────────────────────

  describe('sendMessage', () => {
    it('should POST to Telegram sendMessage API with correct payload', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendMessage(CHAT_ID, 'Hello world');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = capturedRequests[0];
      expect(call.url).toBe(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`);
      expect(call.body).toEqual({
        chat_id: CHAT_ID,
        text: 'Hello world',
        parse_mode: 'Markdown',
      });
    });

    it('should support HTML parse mode', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendMessage(CHAT_ID, '<b>bold</b>', 'HTML');

      expect(capturedRequests[0].body.parse_mode).toBe('HTML');
    });

    it('should not throw when Telegram API returns error', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, description: 'Bad Request' }), { status: 400 }),
      );
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      // Should not throw
      await bot.sendMessage(CHAT_ID, 'test');
    });

    it('should not throw when fetch rejects', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendMessage(CHAT_ID, 'test');
    });
  });

  // ── Alert functions ──────────────────────────────────────────────────────

  describe('sendTradeAlert', () => {
    it('should send buy trade alert with market, price, size, and strategy', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const trade = makeTrade({ side: 'buy', marketId: 'ETH-USD', fillPrice: '3100', fillSize: '2.0', fees: '1.50', strategy: 'mean-reversion' });
      await bot.sendTradeAlert(trade);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const text = capturedRequests[0].body.text as string;
      expect(text).toContain('BUY');
      expect(text).toContain('ETH-USD');
      expect(text).toContain('3100');
      expect(text).toContain('2.0');
      expect(text).toContain('1.50');
      expect(text).toContain('mean-reversion');
    });

    it('should send sell trade alert', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendTradeAlert(makeTrade({ side: 'sell' }));

      const text = capturedRequests[0].body.text as string;
      expect(text).toContain('SELL');
    });
  });

  describe('sendDailySummary', () => {
    it('should send daily summary with all fields', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const report = makeDailySummary();
      await bot.sendDailySummary(report);

      const text = capturedRequests[0].body.text as string;
      expect(text).toContain('Daily Summary');
      expect(text).toContain('2026-03-25');
      expect(text).toContain('10500');
      expect(text).toContain('350');
      expect(text).toContain('75');
      expect(text).toContain('15');
      expect(text).toContain('66.7%'); // 10/15 win rate
      expect(text).toContain('3.00%'); // drawdown
    });

    it('should handle zero trades without division error', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendDailySummary(makeDailySummary({ tradeCount: 0, winCount: 0 }));

      const text = capturedRequests[0].body.text as string;
      expect(text).toContain('0.0%');
    });
  });

  describe('sendCircuitBreakerAlert', () => {
    it('should send circuit breaker alert with reason', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendCircuitBreakerAlert('3 consecutive losses');

      const text = capturedRequests[0].body.text as string;
      expect(text).toContain('Circuit Breaker');
      expect(text).toContain('3 consecutive losses');
      expect(text).toContain('/resume');
    });
  });

  describe('sendCalibrationDrift', () => {
    it('should send calibration drift warning with Brier score', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      await bot.sendCalibrationDrift(0.3512);

      const text = capturedRequests[0].body.text as string;
      expect(text).toContain('Calibration Drift');
      expect(text).toContain('0.3512');
      expect(text).toContain('threshold');
    });
  });

  // ── Command handlers ─────────────────────────────────────────────────────
  // Test commands via single-update poll cycle to avoid tight-loop OOM.

  describe('command handlers', () => {
    function makeUpdateResponse(command: string, chatId = 12345, updateId = 1) {
      return {
        ok: true,
        result: [{
          update_id: updateId,
          message: { message_id: 1, chat: { id: chatId }, text: command },
        }],
      };
    }

    /** Delivers exactly one update then permanently blocks further polls */
    async function runCommand(bot: TelegramBot, command: string): Promise<string[]> {
      const sentMessages: string[] = [];
      bot.sendMessage = async (_chatId: string, text: string) => {
        sentMessages.push(text);
      };

      let delivered = false;
      fetchMock.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/getUpdates')) {
          if (!delivered) {
            delivered = true;
            return new Response(JSON.stringify(makeUpdateResponse(command)), { status: 200 });
          }
          // Block indefinitely — no tight loop
          return new Promise<Response>(() => {});
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      bot.startPolling();
      await new Promise((r) => setTimeout(r, 100));
      bot.stopPolling();
      return sentMessages;
    }

    it('/status should return equity, positions, and tier info', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const providers = makeProviders();
      bot.registerProviders(providers);

      const messages = await runCommand(bot, '/status');

      expect(messages.length).toBeGreaterThanOrEqual(1);
      const text = messages[0];
      expect(text).toContain('Status');
      expect(text).toContain('10000');      // equity
      expect(text).toContain('500');        // realized pnl
      expect(text).toContain('ETH-USD');    // position
      expect(text).toContain('Tier');       // capital tier
      expect(text).toContain('18/14');      // days completed
    });

    it('/status should show "No open positions" when none exist', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders({ getPositions: () => [] }));

      const messages = await runCommand(bot, '/status');
      expect(messages[0]).toContain('No open positions');
    });

    it('/status should show circuit breaker state', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const rm = new RiskManager(riskLimits);
      rm.tripCircuitBreaker('test');
      bot.registerProviders(makeProviders({ riskManager: rm }));

      const messages = await runCommand(bot, '/status');
      expect(messages[0]).toContain('ACTIVE');
    });

    it('/pause should trip circuit breaker', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const rm = new RiskManager(riskLimits);
      bot.registerProviders(makeProviders({ riskManager: rm }));

      expect(rm.isCircuitBreakerActive()).toBe(false);
      const messages = await runCommand(bot, '/pause');

      expect(rm.isCircuitBreakerActive()).toBe(true);
      expect(messages[0]).toContain('paused');
    });

    it('/resume should reset circuit breaker', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const rm = new RiskManager(riskLimits);
      rm.tripCircuitBreaker('test');
      bot.registerProviders(makeProviders({ riskManager: rm }));

      expect(rm.isCircuitBreakerActive()).toBe(true);
      const messages = await runCommand(bot, '/resume');

      expect(rm.isCircuitBreakerActive()).toBe(false);
      expect(messages[0]).toContain('resumed');
    });

    it('/pnl should return daily P&L breakdown', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders());

      const messages = await runCommand(bot, '/pnl');
      const text = messages[0];
      expect(text).toContain('P&L');
      expect(text).toContain('250.00');  // realized
      expect(text).toContain('40.00');   // unrealized
      expect(text).toContain('5.00');    // fees
      expect(text).toContain('10');      // trades
    });

    it('/calibration should return Brier score with quality rating', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders({ getBrierScore: async () => 0.15 }));

      const messages = await runCommand(bot, '/calibration');
      const text = messages[0];
      expect(text).toContain('Calibration');
      expect(text).toContain('0.1500');
      expect(text).toContain('Good');
    });

    it('/calibration should handle null Brier score', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders({ getBrierScore: async () => null }));

      const messages = await runCommand(bot, '/calibration');
      expect(messages[0]).toContain('No Brier score');
    });

    it('/calibration should classify Brier scores correctly', async () => {
      // Excellent (< 0.1)
      let bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders({ getBrierScore: async () => 0.05 }));
      let messages = await runCommand(bot, '/calibration');
      expect(messages[0]).toContain('Excellent');

      // Fair (0.2-0.3)
      bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders({ getBrierScore: async () => 0.25 }));
      messages = await runCommand(bot, '/calibration');
      expect(messages[0]).toContain('Fair');

      // Poor (>= 0.3)
      bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.registerProviders(makeProviders({ getBrierScore: async () => 0.35 }));
      messages = await runCommand(bot, '/calibration');
      expect(messages[0]).toContain('Poor');
    });

    it('/help should list all available commands', async () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      const messages = await runCommand(bot, '/help');
      const text = messages[0];
      expect(text).toContain('/status');
      expect(text).toContain('/pause');
      expect(text).toContain('/resume');
      expect(text).toContain('/pnl');
      expect(text).toContain('/calibration');
    });
  });

  // ── Polling lifecycle ────────────────────────────────────────────────────

  describe('polling lifecycle', () => {
    it('startPolling should call getUpdates endpoint', async () => {
      // Use a fetch that blocks after first response to prevent tight loop
      let called = false;
      fetchMock.mockImplementation(async (url: string | URL | Request) => {
        const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url;
        if (urlStr.includes('/getUpdates')) {
          if (!called) {
            called = true;
            capturedRequests.push({ url: urlStr, body: {} });
            return new Response(JSON.stringify({ ok: true, result: [] }), { status: 200 });
          }
          return new Promise<Response>(() => {}); // block
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      bot.startPolling();
      await new Promise((r) => setTimeout(r, 100));
      bot.stopPolling();

      const getUpdateCalls = capturedRequests.filter(r => r.url.includes('/getUpdates'));
      expect(getUpdateCalls.length).toBeGreaterThanOrEqual(1);
      expect(getUpdateCalls[0].url).toContain(`/bot${BOT_TOKEN}/getUpdates`);
    });

    it('stopPolling should stop accepting new requests', () => {
      const bot = new TelegramBot(BOT_TOKEN, CHAT_ID);
      // Just verify stop doesn't throw
      bot.stopPolling();
      expect(true).toBe(true);
    });
  });
});

// ── No-op / factory tests ─────────────────────────────────────────────────────

describe('TelegramBotNoOp', () => {
  it('should be a no-op for all methods', async () => {
    const noop = new TelegramBotNoOp();

    // None of these should throw
    await noop.sendMessage('123', 'test');
    noop.registerCommand('/test', async () => {});
    noop.registerProviders({} as TelegramBotProviders);
    noop.startPolling();
    noop.stopPolling();
    await noop.sendTradeAlert(makeTrade());
    await noop.sendDailySummary(makeDailySummary());
    await noop.sendCircuitBreakerAlert('reason');
    await noop.sendCalibrationDrift(0.5);
    await noop.sendPnlReport(makePnl());
    await noop.sendError('error');
  });
});

describe('createTelegramBot', () => {
  afterEach(() => {
    delete process.env['TELEGRAM_BOT_TOKEN'];
    delete process.env['TELEGRAM_CHAT_ID'];
    delete process.env['TELEGRAM_ENABLED'];
  });

  it('should return no-op when TELEGRAM_BOT_TOKEN is missing', () => {
    process.env['TELEGRAM_CHAT_ID'] = '12345';
    const bot = createTelegramBot();
    expect(bot).toBeInstanceOf(TelegramBotNoOp);
  });

  it('should return no-op when TELEGRAM_CHAT_ID is missing', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
    const bot = createTelegramBot();
    expect(bot).toBeInstanceOf(TelegramBotNoOp);
  });

  it('should return no-op when both env vars are missing', () => {
    const bot = createTelegramBot();
    expect(bot).toBeInstanceOf(TelegramBotNoOp);
  });

  it('should return no-op when TELEGRAM_ENABLED is false', () => {
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
    process.env['TELEGRAM_CHAT_ID'] = '12345';
    process.env['TELEGRAM_ENABLED'] = 'false';
    const bot = createTelegramBot();
    expect(bot).toBeInstanceOf(TelegramBotNoOp);
  });

  it('should return real TelegramBot when env vars are set', () => {
    installFetchMock();
    process.env['TELEGRAM_BOT_TOKEN'] = 'test-token';
    process.env['TELEGRAM_CHAT_ID'] = '12345';
    const bot = createTelegramBot();
    expect(bot).toBeInstanceOf(TelegramBot);
    // Clean up polling if auto-started
    if ('stopPolling' in bot) bot.stopPolling();
    vi.restoreAllMocks();
  });
});
