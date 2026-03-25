// Telegram Bot API integration — native fetch, no external deps
// Handles sendMessage, long-poll command dispatch, and alert functions
import type { TradeResult, PnlSnapshot, Position } from '../core/types.js';
import type { RiskManager } from '../core/risk-manager.js';
import type { TierProgress } from '../core/capital-tiers.js';
import { logger } from '../core/logger.js';
import { TelegramPoller } from './telegram-poller.js';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramSendResponse {
  ok: boolean;
  description?: string;
}

type CommandHandler = (chatId: string, args: string[]) => Promise<void>;

// ── Dependency providers (injected via registerProviders) ─────────────────

export interface TelegramBotProviders {
  riskManager: RiskManager;
  getPositions: () => Position[];
  getPnlSnapshot: () => PnlSnapshot;
  getTierProgress: () => TierProgress;
  getDailyPnl: () => { trades: number; realized: string; unrealized: string; fees: string };
  getBrierScore: () => Promise<number | null>;
}

// ── DailySummaryReport ────────────────────────────────────────────────────

export interface DailySummaryReport {
  date: string;
  equity: string;
  realizedPnl: string;
  unrealizedPnl: string;
  tradeCount: number;
  winCount: number;
  drawdown: number;
}

// ── TelegramBot ────────────────────────────────────────────────────────────

export class TelegramBot {
  private readonly botToken: string;
  private readonly defaultChatId: string;
  private readonly poller: TelegramPoller;
  private providers: TelegramBotProviders | null = null;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.defaultChatId = chatId;
    this.poller = new TelegramPoller(botToken);
    this.registerDefaultCommands();
  }

  /** Inject runtime dependencies for command handlers */
  registerProviders(providers: TelegramBotProviders): void {
    this.providers = providers;
    this.registerMonitoringCommands();
  }

  // ── Messaging ────────────────────────────────────────────────────────────

  async sendMessage(
    chatId: string,
    text: string,
    parseMode: 'Markdown' | 'HTML' = 'Markdown',
  ): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
      });
      const data = (await res.json()) as TelegramSendResponse;
      if (!data.ok) {
        logger.warn('Telegram API error', 'TelegramBot', { description: data.description });
      }
    } catch (err) {
      // Non-critical — never crash the app
      logger.error('Telegram send failed', 'TelegramBot', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // ── Commands ─────────────────────────────────────────────────────────────

  /** Register a slash-command handler, e.g. '/status' */
  registerCommand(command: string, handler: CommandHandler): void {
    this.poller.registerCommand(command, handler);
  }

  // ── Polling lifecycle ─────────────────────────────────────────────────────

  startPolling(): void {
    this.poller.start();
  }

  stopPolling(): void {
    this.poller.stop();
  }

  // ── Alert functions ────────────────────────────────────────────────────────

  async sendTradeAlert(trade: TradeResult): Promise<void> {
    const side = trade.side === 'buy' ? '🟢 BUY' : '🔴 SELL';
    const text = [
      `*${side}* \`${trade.marketId}\` @ \`$${trade.fillPrice}\``,
      `Size: \`${trade.fillSize}\` | Fees: \`${trade.fees}\``,
      `Strategy: \`${trade.strategy}\``,
      `_${new Date(trade.timestamp).toISOString()}_`,
    ].join('\n');
    await this.sendMessage(this.defaultChatId, text);
  }

  async sendDailySummary(report: DailySummaryReport): Promise<void> {
    const winRate =
      report.tradeCount > 0
        ? ((report.winCount / report.tradeCount) * 100).toFixed(1)
        : '0.0';
    const drawdownPct = (report.drawdown * 100).toFixed(2);
    const text = [
      `*📊 Daily Summary* — ${report.date}`,
      `Equity: \`${report.equity}\``,
      `Realized P&L: \`${report.realizedPnl}\` | Unrealized: \`${report.unrealizedPnl}\``,
      `Trades: \`${report.tradeCount}\` | Win rate: \`${winRate}%\` | Drawdown: \`${drawdownPct}%\``,
    ].join('\n');
    await this.sendMessage(this.defaultChatId, text);
  }

  async sendCircuitBreakerAlert(reason: string): Promise<void> {
    const text = [
      `*🚨 Circuit Breaker Tripped*`,
      `Reason: ${reason}`,
      `_Trading is paused. Use /resume to restart._`,
      `_${new Date().toISOString()}_`,
    ].join('\n');
    await this.sendMessage(this.defaultChatId, text);
  }

  async sendCalibrationDrift(brier: number): Promise<void> {
    const text = [
      `*⚠️ Calibration Drift Warning*`,
      `Brier score: \`${brier.toFixed(4)}\``,
      `_Score exceeds acceptable threshold. Review model predictions._`,
      `_${new Date().toISOString()}_`,
    ].join('\n');
    await this.sendMessage(this.defaultChatId, text);
  }

  async sendPnlReport(pnl: PnlSnapshot): Promise<void> {
    const drawdownPct = (pnl.drawdown * 100).toFixed(2);
    const winRate =
      pnl.tradeCount > 0
        ? ((pnl.winCount / pnl.tradeCount) * 100).toFixed(1)
        : '0.0';
    const text = [
      `*📊 P&L Report*`,
      `Equity: \`${pnl.equity}\` | Peak: \`${pnl.peakEquity}\``,
      `Drawdown: \`${drawdownPct}%\` | Realized: \`${pnl.realizedPnl}\``,
      `Trades: \`${pnl.tradeCount}\` | Win rate: \`${winRate}%\``,
      `_${new Date(pnl.timestamp).toISOString()}_`,
    ].join('\n');
    await this.sendMessage(this.defaultChatId, text);
  }

  async sendError(error: string): Promise<void> {
    const text = `*🚨 Error*\n\`${error}\`\n_${new Date().toISOString()}_`;
    await this.sendMessage(this.defaultChatId, text);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private registerDefaultCommands(): void {
    this.poller.registerCommand('/help', async (chatId) => {
      const text = [
        '*Available commands:*',
        '`/status` — Current P&L, positions, capital tier',
        '`/pause` — Pause trading (trip circuit breaker)',
        '`/resume` — Resume trading (reset circuit breaker)',
        '`/pnl` — Today\'s P&L breakdown',
        '`/calibration` — Current Brier score',
        '`/help` — This message',
      ].join('\n');
      await this.sendMessage(chatId, text);
    });
  }

  private registerMonitoringCommands(): void {
    const p = this.providers!;

    // /status — current P&L, open positions, capital tier
    this.poller.registerCommand('/status', async (chatId) => {
      const pnl = p.getPnlSnapshot();
      const positions = p.getPositions();
      const tier = p.getTierProgress();
      const cbActive = p.riskManager.isCircuitBreakerActive();

      const positionLines = positions.length > 0
        ? positions.map(
            (pos) => `  \`${pos.marketId}\` ${pos.side} ${pos.size} @ ${pos.entryPrice} (PnL: ${pos.unrealizedPnl})`,
          ).join('\n')
        : '  _No open positions_';

      const text = [
        `*📈 Status*`,
        `Equity: \`${pnl.equity}\` | Realized: \`${pnl.realizedPnl}\``,
        `Drawdown: \`${(pnl.drawdown * 100).toFixed(2)}%\``,
        `Circuit breaker: ${cbActive ? '🔴 ACTIVE' : '🟢 OK'}`,
        ``,
        `*Positions (${positions.length}):*`,
        positionLines,
        ``,
        `*Capital Tier:* ${tier.tier.level} (max $${tier.tier.maxCapital})`,
        `Days: ${tier.daysCompleted}/${tier.tier.minDryRunDays} | Profitable: ${tier.profitableDays}/${tier.tier.minProfitableDays}`,
        tier.canProgress ? `_Ready to progress to tier ${tier.nextTier?.level}_` : '',
      ].filter(Boolean).join('\n');

      await this.sendMessage(chatId, text);
    });

    // /pause — trip circuit breaker
    this.poller.registerCommand('/pause', async (chatId) => {
      p.riskManager.tripCircuitBreaker('Manual pause via Telegram');
      await this.sendMessage(chatId, '*⏸ Trading paused.*\nCircuit breaker tripped manually.\nUse /resume to restart.');
    });

    // /resume — reset circuit breaker
    this.poller.registerCommand('/resume', async (chatId) => {
      p.riskManager.resetCircuitBreaker();
      await this.sendMessage(chatId, '*▶️ Trading resumed.*\nCircuit breaker reset.');
    });

    // /pnl — today's P&L breakdown
    this.poller.registerCommand('/pnl', async (chatId) => {
      const daily = p.getDailyPnl();
      const pnl = p.getPnlSnapshot();
      const winRate =
        pnl.tradeCount > 0
          ? ((pnl.winCount / pnl.tradeCount) * 100).toFixed(1)
          : '0.0';

      const text = [
        `*📊 Today's P&L*`,
        `Trades: \`${daily.trades}\``,
        `Realized: \`${daily.realized}\``,
        `Unrealized: \`${daily.unrealized}\``,
        `Fees: \`${daily.fees}\``,
        `Win rate: \`${winRate}%\``,
        `Equity: \`${pnl.equity}\` | Peak: \`${pnl.peakEquity}\``,
      ].join('\n');

      await this.sendMessage(chatId, text);
    });

    // /calibration — current Brier score
    this.poller.registerCommand('/calibration', async (chatId) => {
      const brier = await p.getBrierScore();
      if (brier === null) {
        await this.sendMessage(chatId, '*📐 Calibration*\n_No Brier score data available._');
        return;
      }
      const quality =
        brier < 0.1 ? '🟢 Excellent' :
        brier < 0.2 ? '🟡 Good' :
        brier < 0.3 ? '🟠 Fair' : '🔴 Poor';

      const text = [
        `*📐 Calibration*`,
        `Brier score: \`${brier.toFixed(4)}\``,
        `Quality: ${quality}`,
      ].join('\n');

      await this.sendMessage(chatId, text);
    });
  }
}

// ── No-op Proxy ──────────────────────────────────────────────────────────────

/** No-op stub that satisfies the TelegramBot interface when env vars are missing */
class TelegramBotNoOp {
  async sendMessage(_chatId: string, _text: string): Promise<void> {}
  registerCommand(_command: string, _handler: CommandHandler): void {}
  registerProviders(_providers: TelegramBotProviders): void {}
  startPolling(): void {}
  stopPolling(): void {}
  async sendTradeAlert(_trade: TradeResult): Promise<void> {}
  async sendDailySummary(_report: DailySummaryReport): Promise<void> {}
  async sendCircuitBreakerAlert(_reason: string): Promise<void> {}
  async sendCalibrationDrift(_brier: number): Promise<void> {}
  async sendPnlReport(_pnl: PnlSnapshot): Promise<void> {}
  async sendError(_error: string): Promise<void> {}
}

// ── Factory ────────────────────────────────────────────────────────────────

/** Build TelegramBot from env vars. Returns no-op stub if not configured. */
export function createTelegramBot(): TelegramBot | TelegramBotNoOp {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  const chatId = process.env['TELEGRAM_CHAT_ID'];
  const enabled = process.env['TELEGRAM_ENABLED'] !== 'false';

  if (!enabled || !token || !chatId) {
    logger.warn(
      'Telegram not configured — returning no-op (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)',
      'TelegramBot',
    );
    return new TelegramBotNoOp();
  }

  return new TelegramBot(token, chatId);
}

// Legacy alias — keeps any existing imports working
export { TelegramBot as TelegramNotifier };
export { TelegramBotNoOp };
