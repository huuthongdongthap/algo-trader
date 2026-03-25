// Notifications wiring — bootstraps Telegram bot + email + trade alerts into app lifecycle
// Wires: TelegramBot polling, TelegramTradeAlerts event subscriptions, email channel
import type { EventBus } from '../events/event-bus.js';
import type { TradingEngine } from '../engine/engine.js';
import { createTelegramBot, TelegramBot } from '../notifications/telegram-bot.js';
import { TelegramTradeAlerts } from '../notifications/telegram-trade-alerts.js';
import { NotificationRouter } from '../notifications/notification-router.js';
import { EmailSender } from '../notifications/email-sender.js';
import { logger } from '../core/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface NotificationsBundle {
  bot: TelegramBot | null;
  alerts: TelegramTradeAlerts | null;
  router: NotificationRouter;
}

// ── Bootstrap ──────────────────────────────────────────────────────────────

/**
 * Initialise Telegram bot + alert subscriber.
 * Safe to call even if TELEGRAM_BOT_TOKEN is not set — logs warning and continues.
 */
export function startNotifications(
  eventBus: EventBus,
  engine: TradingEngine,
): NotificationsBundle {
  const router = new NotificationRouter();
  const botOrNoOp = createTelegramBot();

  if (!(botOrNoOp instanceof TelegramBot)) {
    return { bot: null, alerts: null, router };
  }
  const bot = botOrNoOp;

  const chatId = process.env['TELEGRAM_CHAT_ID'] ?? '';

  // Wire command handlers that need engine state
  wireCommandHandlers(bot, engine, chatId);

  // Subscribe alerts to event bus
  const alerts = new TelegramTradeAlerts(bot, chatId);
  alerts.subscribe(eventBus);

  // Register as notification channel
  router.addChannel('telegram', {
    sendMessage: (text) => bot.sendMessage(chatId, text),
    sendTradeAlert: (trade) => bot.sendTradeAlert(trade),
  });

  // Start long-poll loop
  bot.startPolling();

  // Wire email channel if SMTP configured
  wireEmailChannel(router);

  logger.info('Notifications wiring complete', 'NotificationsWiring', {
    telegram: true,
    channels: router.enabledChannels(),
  });

  return { bot, alerts, router };
}

/** Wire email as notification channel when SMTP env vars are present */
function wireEmailChannel(router: NotificationRouter): void {
  const emailSender = new EmailSender();
  if (!emailSender.isConfigured()) {
    logger.debug('Email not configured — skipping', 'NotificationsWiring');
    return;
  }
  const defaultTo = process.env['SMTP_ALERT_TO'] ?? process.env['SMTP_FROM'] ?? '';
  if (!defaultTo) return;

  router.addChannel('email', {
    sendMessage: (text) => emailSender.sendEmail(defaultTo, '[CashClaw] Alert', `<pre>${text}</pre>`),
    sendTradeAlert: (trade) => emailSender.sendTradeAlert(defaultTo, trade),
  });
  logger.info('Email notification channel wired', 'NotificationsWiring');
}

/**
 * Stop polling and scheduled timers.
 */
export function stopNotifications(bundle: NotificationsBundle): void {
  bundle.bot?.stopPolling();
  bundle.alerts?.stopScheduler();
  logger.info('Notifications stopped', 'NotificationsWiring');
}

// ── Command handlers ──────────────────────────────────────────────────────

function wireCommandHandlers(
  bot: TelegramBot,
  engine: TradingEngine,
  chatId: string,
): void {
  const reply = (id: string, text: string) => bot.sendMessage(id, text);

  bot.registerCommand('/status', async (id) => {
    const status = engine.getStatus();
    const summary = [
      `*⚙️ Engine Status*`,
      `Running: \`${status.running}\``,
      `Strategies: \`${status.strategies.length}\``,
      `Trades executed: \`${status.tradeCount}\``,
      `Env: \`${status.config.env}\``,
    ].join('\n');
    await reply(id, summary);
  });

  bot.registerCommand('/pnl', async (id) => {
    const trades = engine.getExecutor().getTradeLog();
    if (trades.length === 0) {
      await reply(id, '_No trades recorded yet._');
      return;
    }
    const last = trades[trades.length - 1];
    const text = [
      `*📊 Trade Log Summary*`,
      `Total trades: \`${trades.length}\``,
      `Last trade: \`${last?.side?.toUpperCase()} ${last?.marketId} @ ${last?.fillPrice}\``,
      `Strategy: \`${last?.strategy}\``,
    ].join('\n');
    await reply(id, text);
  });

  bot.registerCommand('/positions', async (id) => {
    const strategies = engine.getRunner().getAllStatus();
    if (strategies.length === 0) {
      await reply(id, '_No active strategies / positions._');
      return;
    }
    const lines = strategies.map(
      (s) => `• \`${s.name}\` — ${s.state}`,
    );
    await reply(id, `*📋 Strategy Status*\n${lines.join('\n')}`);
  });

  bot.registerCommand('/start', async (id) => {
    try {
      await engine.start();
      await reply(id, '*▶️ Engine started.*');
    } catch (err) {
      await reply(id, `*❌ Start failed:* \`${err instanceof Error ? err.message : String(err)}\``);
    }
  });

  bot.registerCommand('/stop', async (id) => {
    try {
      await engine.shutdown('telegram-command');
      await reply(id, '*⏹ Engine stopped.*');
    } catch (err) {
      await reply(id, `*❌ Stop failed:* \`${err instanceof Error ? err.message : String(err)}\``);
    }
  });

  void chatId; // referenced via closure — suppress unused-var lint
}
