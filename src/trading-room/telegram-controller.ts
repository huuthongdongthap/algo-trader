// Telegram bot polling controller — native fetch, no external deps
// Receives commands from phone and dispatches to registered handlers
import { logger } from '../core/logger.js';
import type { TelegramCommandHandler } from './telegram-commands.js';

const TELEGRAM_API = 'https://api.telegram.org';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; username?: string };
    chat: { id: number };
    text?: string;
    date: number;
  };
}

interface GetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

interface SendMessagePayload {
  chat_id: number;
  text: string;
  parse_mode: 'HTML';
}

export class TelegramController {
  private readonly botToken: string;
  private readonly authorizedChatId: number;
  private readonly handlers: Map<string, TelegramCommandHandler>;
  private offset = 0;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(botToken: string, chatId: string, commandHandlers: TelegramCommandHandler[]) {
    this.botToken = botToken;
    this.authorizedChatId = parseInt(chatId, 10);
    this.handlers = new Map(commandHandlers.map((h) => [h.command, h]));
  }

  // Start polling Telegram getUpdates every intervalMs milliseconds
  startPolling(intervalMs = 3000): void {
    if (this.pollingTimer !== null) {
      logger.warn('Polling already running', 'TelegramController');
      return;
    }
    logger.info('Starting Telegram polling', 'TelegramController', { intervalMs });
    // Fire immediately, then on interval
    void this.poll();
    this.pollingTimer = setInterval(() => void this.poll(), intervalMs);
  }

  stopPolling(): void {
    if (this.pollingTimer === null) return;
    clearInterval(this.pollingTimer);
    this.pollingTimer = null;
    logger.info('Stopped Telegram polling', 'TelegramController');
  }

  // Fetch new updates from Telegram using long-poll offset
  private async poll(): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/getUpdates?offset=${this.offset}&timeout=2`;
    try {
      const res = await fetch(url);
      const data = (await res.json()) as GetUpdatesResponse;
      if (!data.ok) {
        logger.warn('getUpdates failed', 'TelegramController');
        return;
      }
      for (const update of data.result) {
        // Advance offset to avoid re-processing
        this.offset = update.update_id + 1;
        if (update.message) {
          await this.processMessage(update.message);
        }
      }
    } catch (err) {
      logger.error('Poll error', 'TelegramController', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Parse and dispatch a single incoming message
  async processMessage(message: NonNullable<TelegramUpdate['message']>): Promise<void> {
    const chatId = message.chat.id;

    // Security: only respond to authorized chat
    if (chatId !== this.authorizedChatId) {
      logger.warn('Unauthorized message', 'TelegramController', { chatId });
      return;
    }

    const text = message.text?.trim();
    if (!text?.startsWith('/')) return; // Ignore non-commands

    // Parse "/command arg1 arg2"
    const parts = text.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1);

    const handler = this.handlers.get(command);
    if (!handler) {
      await this.sendResponse(chatId, `❓ Unknown command: /${command}\nTry /help`);
      return;
    }

    logger.info('Dispatching command', 'TelegramController', { command, args });
    try {
      const response = await handler.handler(args);
      await this.sendResponse(chatId, response);
    } catch (err) {
      logger.error('Command handler error', 'TelegramController', {
        command,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.sendResponse(chatId, `🚨 Error executing /${command}`);
    }
  }

  // Send a reply to a chat
  async sendResponse(chatId: number, text: string): Promise<void> {
    const url = `${TELEGRAM_API}/bot${this.botToken}/sendMessage`;
    const payload: SendMessagePayload = { chat_id: chatId, text, parse_mode: 'HTML' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok: boolean; description?: string };
      if (!data.ok) {
        logger.warn('sendMessage failed', 'TelegramController', { description: data.description });
      }
    } catch (err) {
      logger.error('sendResponse error', 'TelegramController', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
