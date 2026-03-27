/**
 * SMS Service - Twilio Integration
 * Handles threshold alert SMS notifications for urgent usage monitoring
 */

import twilio from 'twilio';
import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';
import { formatSmsBody, getUrgency, getShortKey, getShortActionMessage } from './alert-formatter';

export interface SmsConfig {
  accountSid: string;
  authToken: string;
  fromPhoneNumber: string;
}

export interface SmsNotification {
  to: string;
  message: string;
}

export class SmsService {
  private static instance: SmsService;
  private config: SmsConfig;
  private client: ReturnType<typeof twilio> | null = null;
  private initialized: boolean = false;
  private rateLimitDelay: number = 5000; // 5 seconds between SMS (cost control)
  private dailyLimit: number = 10; // Max SMS per day per recipient
  private redisKeyPrefix: string = 'algo:rate_limit:sms:';

  private constructor(config?: SmsConfig) {
    this.config = config || {
      accountSid: process.env.TWILIO_ACCOUNT_SID || '',
      authToken: process.env.TWILIO_AUTH_TOKEN || '',
      fromPhoneNumber: process.env.TWILIO_PHONE_NUMBER || '',
    };
  }

  static getInstance(config?: SmsConfig): SmsService {
    if (!SmsService.instance) {
      SmsService.instance = new SmsService(config);
    }
    return SmsService.instance;
  }

  initialize(): boolean {
    if (!this.config.accountSid || !this.config.authToken || !this.config.fromPhoneNumber) {
      logger.warn('[SmsService] Missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_PHONE_NUMBER');
      return false;
    }

    try {
      this.client = twilio(this.config.accountSid, this.config.authToken);
      this.initialized = true;
      logger.info('[SmsService] Initialized with Twilio');
      return true;
    } catch (error) {
      logger.error('[SmsService] Initialization failed:', { error });
      return false;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async send(notification: SmsNotification): Promise<boolean> {
    if (!this.initialized || !this.client) {
      logger.warn('[SmsService] Not initialized, skipping SMS');
      return false;
    }

    // Rate limiting via Redis
    await this.applyRateLimitRedis();

    // Daily limit check via Redis
    if (!(await this.checkDailyLimitRedis(notification.to))) {
      logger.warn(`[SmsService] Daily limit reached for ${notification.to}`);
      return false;
    }

    try {
      const message = await this.client.messages.create({
        body: notification.message,
        from: this.config.fromPhoneNumber,
        to: notification.to,
      });

      await this.incrementDailyCountRedis(notification.to);
      logger.info(`[SmsService] SMS sent to ${notification.to}: ${message.sid}`);
      return true;
    } catch (error) {
      logger.error('[SmsService] Send failed:', { error });
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
    // Only send SMS for critical thresholds (90%+)
    if (threshold < 90) {
      logger.info(`[SmsService] Skipping SMS for threshold ${threshold}% (< 90%)`);
      return false;
    }

    const message = formatSmsBody({
      licenseKey,
      threshold,
      currentUsage,
      dailyLimit,
      percentUsed,
    });

    return this.send({
      to: recipient,
      message,
    });
  }

  /**
   * Redis-backed daily limit check for crash resilience
   */
  private async checkDailyLimitRedis(recipient: string): Promise<boolean> {
    try {
      const redis = getRedisClient();
      const key = `${this.redisKeyPrefix}daily:${recipient}`;
      const count = await redis.get(key);
      return !count || parseInt(count) < this.dailyLimit;
    } catch (error) {
      logger.warn('[SmsService] Redis daily limit check failed:', { error });
      return true; // Allow on error to avoid blocking critical alerts
    }
  }

  /**
   * Redis-backed daily count increment
   */
  private async incrementDailyCountRedis(recipient: string): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = `${this.redisKeyPrefix}daily:${recipient}`;
      const ttl = 86400; // 24 hours in seconds

      await redis.incr(key);
      await redis.expire(key, ttl);
    } catch (error) {
      logger.warn('[SmsService] Redis daily count increment failed:', { error });
    }
  }

  /**
   * Redis-backed rate limiting
   */
  private async applyRateLimitRedis(): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = `${this.redisKeyPrefix}last_send`;
      const lastSend = await redis.get(key);

      if (lastSend) {
        const elapsed = Date.now() - parseInt(lastSend);
        if (elapsed < this.rateLimitDelay) {
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - elapsed));
        }
      }

      await redis.setex(key, 3600, Date.now().toString());
    } catch (error) {
      logger.warn('[SmsService] Redis rate limiting failed:', { error });
    }
  }

  setRateLimit(delayMs: number): void {
    this.rateLimitDelay = delayMs;
  }

  setDailyLimit(limit: number): void {
    this.dailyLimit = limit;
  }
}

export const smsService = SmsService.getInstance();
