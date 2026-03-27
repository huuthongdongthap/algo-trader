/**
 * Notifications Module
 * Unified alert delivery across multiple channels
 */

export { EmailService, emailService } from './email-service';
export type { EmailConfig, EmailNotification } from './email-service';

export { SmsService, smsService } from './sms-service';
export type { SmsConfig, SmsNotification } from './sms-service';

export { TelegramBotService, telegramBotService } from '../telegram/bot';
export type { TelegramConfig, UserSession } from '../telegram/bot';

export * from './alert-formatter';
