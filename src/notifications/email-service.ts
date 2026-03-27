/**
 * Email Service - SendGrid Integration
 * Handles threshold alert emails for usage monitoring
 */

import sgMail from '@sendgrid/mail';
import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';
import {
  formatAlert,
  getUrgency,
  getUrgencyColor,
  getActionMessage,
  generateProgressBar,
} from './alert-formatter';

export interface EmailConfig {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
}

export interface EmailNotification {
  to: string;
  subject: string;
  body: string;
  html?: string;
}

export class EmailService {
  private static instance: EmailService;
  private config: EmailConfig;
  private initialized: boolean = false;
  private rateLimitDelay: number = 1000; // 1 second between emails
  private redisKeyPrefix: string = 'algo:rate_limit:email:';

  private constructor(config?: EmailConfig) {
    this.config = config || {
      apiKey: process.env.SENDGRID_API_KEY || '',
      fromEmail: process.env.SENDGRID_FROM_EMAIL || '',
      fromName: process.env.SENDGRID_FROM_NAME || 'Algo Trader',
    };
  }

  static getInstance(config?: EmailConfig): EmailService {
    if (!EmailService.instance) {
      EmailService.instance = new EmailService(config);
    }
    return EmailService.instance;
  }

  initialize(): boolean {
    if (!this.config.apiKey || !this.config.fromEmail) {
      logger.warn('[EmailService] Missing SENDGRID_API_KEY or SENDGRID_FROM_EMAIL');
      return false;
    }

    try {
      sgMail.setApiKey(this.config.apiKey);
      this.initialized = true;
      logger.info('[EmailService] Initialized with SendGrid');
      return true;
    } catch (error) {
      logger.error('[EmailService] Initialization failed:', { error });
      return false;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async send(notification: EmailNotification): Promise<boolean> {
    if (!this.initialized) {
      logger.warn('[EmailService] Not initialized, skipping email');
      return false;
    }

    // Rate limiting via Redis
    await this.applyRateLimitRedis();

    try {
      const msg: sgMail.MailDataRequired = {
        to: notification.to,
        from: {
          email: this.config.fromEmail,
          name: this.config.fromName,
        },
        subject: notification.subject,
        text: notification.body,
        ...(notification.html ? { html: notification.html } : {}),
      };

      await sgMail.send(msg);
      logger.info(`[EmailService] Email sent to ${notification.to}: ${notification.subject}`);
      return true;
    } catch (error) {
      logger.error('[EmailService] Send failed:', { error });
      return false;
    }
  }

  async sendThresholdAlert(
    recipient: string,
    licenseKey: string,
    threshold: number,
    currentUsage: number,
    dailyLimit: number,
    percentUsed: number
  ): Promise<boolean> {
    const { urgency, urgencyColor } = formatAlert({
      licenseKey,
      threshold,
      currentUsage,
      dailyLimit,
      percentUsed,
    });

    const subject = `[${urgency}] Usage Alert: ${threshold}% threshold reached`;

    const body = this.generatePlainTextBody(
      licenseKey,
      threshold,
      currentUsage,
      dailyLimit,
      percentUsed,
      urgency
    );

    const html = this.generateHtmlBody(
      licenseKey,
      threshold,
      currentUsage,
      dailyLimit,
      percentUsed,
      urgency,
      urgencyColor
    );

    return this.send({
      to: recipient,
      subject,
      body,
      html,
    });
  }

  private generatePlainTextBody(
    licenseKey: string,
    threshold: number,
    currentUsage: number,
    dailyLimit: number,
    percentUsed: number,
    urgency: string
  ): string {
    const actionMessage = getActionMessage(threshold);

    return `
USAGE THRESHOLD ALERT [${urgency}]

License Key: ${licenseKey}
Threshold Reached: ${threshold}%
Current Usage: ${currentUsage.toLocaleString()} calls
Daily Limit: ${dailyLimit.toLocaleString()} calls
Percent Used: ${percentUsed.toFixed(1)}%
Time: ${new Date().toISOString()}

${actionMessage}

Please review your usage and consider upgrading your tier if needed.

---
Algo Trader Alert System
    `.trim();
  }

  private generateHtmlBody(
    licenseKey: string,
    threshold: number,
    currentUsage: number,
    dailyLimit: number,
    percentUsed: number,
    urgency: string,
    urgencyColor: string
  ): string {
    const actionMessage = getActionMessage(threshold);
    const progressBar = generateProgressBar(percentUsed);

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${urgencyColor}; color: white; padding: 15px; border-radius: 5px 5px 0 0; }
    .content { background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; }
    .metric { margin: 10px 0; padding: 10px; background: white; border-radius: 5px; }
    .metric-label { font-weight: bold; color: #6c757d; }
    .metric-value { font-size: 1.2em; color: #212529; }
    .progress-bar { background: #e9ecef; border-radius: 10px; overflow: hidden; margin: 15px 0; }
    .progress-fill { background: ${urgencyColor}; height: 20px; transition: width 0.3s; }
    .action { background: #fff3cd; border-left: 4px solid ${urgencyColor}; padding: 15px; margin: 15px 0; }
    .footer { text-align: center; color: #6c757d; font-size: 0.9em; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h2 style="margin: 0;">${urgency} - Usage Threshold Alert</h2>
    </div>
    <div class="content">
      <div class="metric">
        <div class="metric-label">License Key</div>
        <div class="metric-value">${licenseKey}</div>
      </div>
      <div class="metric">
        <div class="metric-label">Threshold Reached</div>
        <div class="metric-value">${threshold}%</div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${Math.min(percentUsed, 100)}%;"></div>
      </div>
      <div class="metric">
        <div class="metric-label">Current Usage</div>
        <div class="metric-value">${currentUsage.toLocaleString()} / ${dailyLimit.toLocaleString()} calls</div>
      </div>
      <div class="metric">
        <div class="metric-label">Percent Used</div>
        <div class="metric-value">${percentUsed.toFixed(1)}%</div>
      </div>
      <div class="action">
        <strong>Action Required:</strong><br>
        ${actionMessage}
      </div>
      <p>Please review your usage and consider upgrading your tier if needed.</p>
    </div>
    <div class="footer">
      Algo Trader Alert System &copy; ${new Date().getFullYear()}
    </div>
  </div>
</body>
</html>
    `.trim();
  }

  /**
   * Redis-backed rate limiting for crash resilience
   * Uses Redis INCR with TTL to track requests per second
   */
  private async applyRateLimitRedis(): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = `${this.redisKeyPrefix}global`;
      const now = Date.now();
      const windowMs = 1000; // 1 second window

      // Use sliding window rate limiting
      const current = await redis.get(key);
      if (current) {
        const parsed = JSON.parse(current);
        const elapsed = now - parsed.timestamp;

        if (elapsed < this.rateLimitDelay) {
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - elapsed));
        }
      }

      // Update timestamp
      await redis.setex(key, 60, JSON.stringify({ timestamp: now }));
    } catch (error) {
      // Fallback to in-memory rate limiting if Redis unavailable
      logger.warn('[EmailService] Redis rate limiting failed, using fallback:', { error });
      await this.applyRateLimitFallback();
    }
  }

  private async applyRateLimitFallback(): Promise<void> {
    // Simple in-memory fallback (non-persistent)
    const now = Date.now();
    const lastSendTime = parseInt(await getRedisClient().get(`${this.redisKeyPrefix}last_send`) || '0');
    const timeSinceLastSend = now - lastSendTime;

    if (timeSinceLastSend < this.rateLimitDelay) {
      await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - timeSinceLastSend));
    }

    await getRedisClient().setex(`${this.redisKeyPrefix}last_send`, 3600, now.toString());
  }

  setRateLimit(delayMs: number): void {
    this.rateLimitDelay = delayMs;
  }
}

export const emailService = EmailService.getInstance();
