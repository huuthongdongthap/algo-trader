// Notifications module — barrel export
export { TelegramNotifier } from './telegram-bot.js';
export { AlertManager, builtInRules } from './alert-rules.js';
export type { AlertRule } from './alert-rules.js';
export { HealthChecker } from './health-check.js';
export type { ComponentHealth, HealthReport } from './health-check.js';
export { DiscordNotifier } from './discord-webhook.js';
export { SlackNotifier } from './slack-webhook.js';
export { EmailSender } from './email-sender.js';
export type { EmailConfig } from './email-sender.js';
export { NotificationRouter } from './notification-router.js';
export type { NotificationChannel, ChannelNotifier, ChannelConfig } from './notification-router.js';
