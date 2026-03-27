/**
 * Threshold Alerts
 * ROIaaS Phase 4 - Threshold alert events for usage monitoring
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { UsageMeteringService, ThresholdAlert } from '../metering/usage-metering-service';
import { emailService } from '../notifications/email-service';
import { smsService } from '../notifications/sms-service';
import { telegramBotService } from '../telegram/bot';
import { formatAlert, getActionMessage } from '../notifications/alert-formatter';

export interface AlertHandler {
  (alert: ThresholdAlert): Promise<void> | void;
}

export interface AlertNotification {
  licenseKey: string;
  threshold: number;
  currentUsage: number;
  dailyLimit: number;
  percentUsed: number;
  timestamp: string;
  action?: string;
}

export interface AlertRecipient {
  email?: string;
  phone?: string;
  telegramChatId?: number;
}

export interface AlertChannelConfig {
  email: {
    enabled: boolean;
    minThreshold: number; // 80 = send at 80%+
  };
  sms: {
    enabled: boolean;
    minThreshold: number; // 90 = only send at 90%+
  };
  telegram: {
    enabled: boolean;
    minThreshold: number; // 80 = send at 80%+
  };
}

export class ThresholdAlerts extends EventEmitter {
  private static instance: ThresholdAlerts;
  private handlers: Map<number, AlertHandler[]> = new Map();
  private recipients: Map<string, AlertRecipient> = new Map(); // licenseKey -> recipient
  private channelConfig: AlertChannelConfig = {
    email: { enabled: true, minThreshold: 80 },
    sms: { enabled: true, minThreshold: 90 },
    telegram: { enabled: true, minThreshold: 80 },
  };
  private initialized: boolean = false;

  private constructor() {
    super();
    this.setupDefaultHandlers();
  }

  static getInstance(): ThresholdAlerts {
    if (!ThresholdAlerts.instance) {
      ThresholdAlerts.instance = new ThresholdAlerts();
    }
    return ThresholdAlerts.instance;
  }

  initialize(): void {
    if (this.initialized) return;

    // Initialize notification services
    const emailInitialized = emailService.initialize();
    const smsInitialized = smsService.initialize();
    const telegramInitialized = telegramBotService.initialize();

    logger.info('[ThresholdAlerts] Services initialized:', {
      email: emailInitialized,
      sms: smsInitialized,
      telegram: telegramInitialized,
    });

    // Start Telegram bot if initialized
    if (telegramInitialized) {
      telegramBotService.start().catch(err => {
        logger.error('[ThresholdAlerts] Failed to start Telegram bot:', { err });
      });
    }

    this.initialized = true;
  }

  private setupDefaultHandlers(): void {
    const meteringService = UsageMeteringService.getInstance();

    meteringService.on('threshold_alert', (alert: ThresholdAlert) => {
      this.emit('alert', alert);

      // Dispatch to all notification channels
      this.dispatchAlert(alert).catch(err => {
        logger.error('[ThresholdAlerts] Failed to dispatch alert:', { err });
      });

      const handlers = this.handlers.get(alert.threshold) || [];
      for (const handler of handlers) {
        try {
          handler(alert);
        } catch (error) {
          logger.error('Alert handler error:', { error });
        }
      }
    });
  }

  onThreshold(threshold: number, handler: AlertHandler): void {
    if (!this.handlers.has(threshold)) {
      this.handlers.set(threshold, []);
    }
    this.handlers.get(threshold)!.push(handler);
  }

  onEightyPercent(handler: AlertHandler): void {
    this.onThreshold(80, handler);
  }

  onNinetyPercent(handler: AlertHandler): void {
    this.onThreshold(90, handler);
  }

  onHundredPercent(handler: AlertHandler): void {
    this.onThreshold(100, handler);
  }

  createNotification(alert: ThresholdAlert): AlertNotification {
    const notification: AlertNotification = {
      licenseKey: alert.licenseKey,
      threshold: alert.threshold,
      currentUsage: alert.currentUsage,
      dailyLimit: alert.dailyLimit,
      percentUsed: alert.percentUsed,
      timestamp: alert.timestamp,
    };

    if (alert.threshold === 80) {
      notification.action = 'warn';
    } else if (alert.threshold === 90) {
      notification.action = 'urgent';
    } else if (alert.threshold === 100) {
      notification.action = 'critical';
    }

    return notification;
  }

  async sendEmailNotification(
    alert: ThresholdAlert,
    sendFn: (to: string, subject: string, body: string) => Promise<void>,
    recipient: string
  ): Promise<void> {
    const notification = this.createNotification(alert);
    const subject = `Usage Alert: ${alert.threshold}% threshold reached`;
    const body = this.generateEmailBody(notification);

    await sendFn(recipient, subject, body);
  }

  async sendSmsNotification(
    alert: ThresholdAlert,
    sendFn: (to: string, message: string) => Promise<void>,
    recipient: string
  ): Promise<void> {
    const notification = this.createNotification(alert);
    const message = this.generateSmsBody(notification);

    await sendFn(recipient, message);
  }

  private generateEmailBody(notification: AlertNotification): string {
    const { urgency } = formatAlert({
      licenseKey: notification.licenseKey,
      threshold: notification.threshold,
      currentUsage: notification.currentUsage,
      dailyLimit: notification.dailyLimit,
      percentUsed: notification.percentUsed,
    });
    const actionMessage = getActionMessage(notification.threshold);

    return `
USAGE THRESHOLD ALERT [${urgency}]

License Key: ${notification.licenseKey}
Threshold Reached: ${notification.threshold}%
Current Usage: ${notification.currentUsage.toLocaleString()} calls
Daily Limit: ${notification.dailyLimit.toLocaleString()} calls
Percent Used: ${notification.percentUsed.toFixed(1)}%
Time: ${notification.timestamp}

${actionMessage}

Please review your usage and consider upgrading your tier if needed.
    `.trim();
  }

  private generateSmsBody(notification: AlertNotification): string {
    const { urgency, shortKey } = formatAlert({
      licenseKey: notification.licenseKey,
      threshold: notification.threshold,
      currentUsage: notification.currentUsage,
      dailyLimit: notification.dailyLimit,
      percentUsed: notification.percentUsed,
    });

    return `USAGE ALERT: ${notification.threshold}% reached. ${notification.currentUsage}/${notification.dailyLimit} calls. ${urgency}`;
  }

  private getActionMessage(notification: AlertNotification): string {
    return getActionMessage(notification.threshold);
  }

  logAlert(alert: ThresholdAlert): void {
    const notification = this.createNotification(alert);
    logger.info('[THRESHOLD ALERT]', { notification });
  }

  async dispatchAlert(alert: ThresholdAlert): Promise<void> {
    const recipient = this.recipients.get(alert.licenseKey);
    if (!recipient) {
      logger.info(`[ThresholdAlerts] No recipient found for ${alert.licenseKey}`);
      return;
    }

    const promises: Promise<boolean>[] = [];

    // Email notification
    if (
      this.channelConfig.email.enabled &&
      alert.threshold >= this.channelConfig.email.minThreshold &&
      recipient.email
    ) {
      promises.push(
        emailService.sendThresholdAlert(
          recipient.email,
          alert.licenseKey,
          alert.threshold,
          alert.currentUsage,
          alert.dailyLimit,
          alert.percentUsed
        )
      );
    }

    // SMS notification (only for critical thresholds)
    if (
      this.channelConfig.sms.enabled &&
      alert.threshold >= this.channelConfig.sms.minThreshold &&
      recipient.phone
    ) {
      promises.push(
        smsService.sendThresholdAlert(
          recipient.phone,
          alert.licenseKey,
          alert.threshold,
          alert.currentUsage,
          alert.dailyLimit,
          alert.percentUsed
        )
      );
    }

    // Telegram notification
    if (
      this.channelConfig.telegram.enabled &&
      alert.threshold >= this.channelConfig.telegram.minThreshold &&
      recipient.telegramChatId
    ) {
      promises.push(
        telegramBotService.sendThresholdAlert(
          recipient.telegramChatId,
          alert.licenseKey,
          alert.threshold,
          alert.currentUsage,
          alert.dailyLimit,
          alert.percentUsed
        )
      );
    }

    const results = await Promise.allSettled(promises);
    const successCount = results.filter(
      r => r.status === 'fulfilled' && r.value === true
    ).length;

    logger.info(
      `[ThresholdAlerts] Dispatched ${successCount}/${results.length} notifications for ${alert.licenseKey} at ${alert.threshold}%`
    );
  }

  registerRecipient(licenseKey: string, recipient: AlertRecipient): void {
    this.recipients.set(licenseKey, recipient);
    logger.info(`[ThresholdAlerts] Registered recipient for ${licenseKey}`);
  }

  unregisterRecipient(licenseKey: string): void {
    this.recipients.delete(licenseKey);
    logger.info(`[ThresholdAlerts] Unregistered recipient for ${licenseKey}`);
  }

  updateChannelConfig(config: Partial<AlertChannelConfig>): void {
    this.channelConfig = {
      ...this.channelConfig,
      ...config,
      email: { ...this.channelConfig.email, ...config.email },
      sms: { ...this.channelConfig.sms, ...config.sms },
      telegram: { ...this.channelConfig.telegram, ...config.telegram },
    };
    logger.info('[ThresholdAlerts] Updated channel config:', { config: this.channelConfig });
  }
}

export const thresholdAlerts = ThresholdAlerts.getInstance();
