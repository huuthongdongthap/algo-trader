// Telegram Bot API integration — native fetch, no external deps
import type { TradeResult, PnlSnapshot } from '../core/types.js';
import { logger } from '../core/logger.js';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramResponse {
  ok: boolean;
  description?: string;
}

interface SendMessagePayload {
  chat_id: string;
  text: string;
  parse_mode?: 'HTML' | 'Markdown';
}

export class TelegramNotifier {
  private readonly botToken: string;
  private readonly chatId: string;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  async sendMessage(text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const payload: SendMessagePayload = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML',
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = (await res.json()) as TelegramResponse;
      if (!data.ok) {
        logger.warn('Telegram API error', 'TelegramNotifier', { description: data.description });
      }
    } catch (err) {
      // Never crash — Telegram is non-critical
      logger.error('Telegram send failed', 'TelegramNotifier', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async sendTradeAlert(trade: TradeResult): Promise<void> {
    const sideEmoji = trade.side === 'buy' ? '🟢' : '🔴';
    const text = [
      `<b>${sideEmoji} Trade Executed</b>`,
      `Market: <code>${trade.marketId}</code>`,
      `Side: ${trade.side.toUpperCase()}`,
      `Fill Price: ${trade.fillPrice}`,
      `Fill Size: ${trade.fillSize}`,
      `Fees: ${trade.fees}`,
      `Strategy: ${trade.strategy}`,
      `Time: ${new Date(trade.timestamp).toISOString()}`,
    ].join('\n');

    await this.sendMessage(text);
  }

  async sendPnlReport(pnl: PnlSnapshot): Promise<void> {
    const drawdownPct = (pnl.drawdown * 100).toFixed(2);
    const winRate =
      pnl.tradeCount > 0 ? ((pnl.winCount / pnl.tradeCount) * 100).toFixed(1) : '0.0';

    const text = [
      `<b>📊 P&L Report</b>`,
      `Equity: <code>${pnl.equity}</code>`,
      `Peak Equity: ${pnl.peakEquity}`,
      `Drawdown: ${drawdownPct}%`,
      `Realized PnL: ${pnl.realizedPnl}`,
      `Unrealized PnL: ${pnl.unrealizedPnl}`,
      `Trades: ${pnl.tradeCount} (Win rate: ${winRate}%)`,
      `Time: ${new Date(pnl.timestamp).toISOString()}`,
    ].join('\n');

    await this.sendMessage(text);
  }

  async sendError(error: string): Promise<void> {
    const text = [
      `<b>🚨 Error Alert</b>`,
      `Time: ${new Date().toISOString()}`,
      `Error: <code>${error}</code>`,
    ].join('\n');

    await this.sendMessage(text);
  }
}
