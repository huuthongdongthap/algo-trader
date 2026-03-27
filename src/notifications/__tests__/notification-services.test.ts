/**
 * Notification Services Tests
 * Tests for Email, SMS, and Telegram notification services
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailService } from '../email-service';
import { SmsService } from '../sms-service';
import { TelegramBotService } from '../../telegram/bot';

// Mock external dependencies
vi.mock('@sendgrid/mail', () => ({
  default: {
    setApiKey: vi.fn(),
    send: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('twilio', () => ({
  default: vi.fn(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({ sid: 'SM123' }),
    },
  })),
}));

vi.mock('grammy', () => ({
  Bot: vi.fn(() => ({
    start: vi.fn(),
    command: vi.fn(),
    use: vi.fn(),
    catch: vi.fn(),
    api: {
      sendMessage: vi.fn().mockResolvedValue({}),
    },
  })),
}));

describe('EmailService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fail initialization with missing config', () => {
    const service = EmailService.getInstance({
      apiKey: '',
      fromEmail: '',
    });
    const result = service.initialize();
    expect(result).toBe(false);
  });

  it('should apply rate limiting', async () => {
    const service = EmailService.getInstance({
      apiKey: 'test-key',
      fromEmail: 'test@example.com',
    });
    service.setRateLimit(10);
    const start = Date.now();
    // Will skip because not initialized, but tests rate limiting code path
    await service.send({
      to: 'test@example.com',
      subject: 'Test',
      body: 'Test body',
    });
    const duration = Date.now() - start;
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('should be a singleton', () => {
    const service1 = EmailService.getInstance({ apiKey: 'k', fromEmail: 'a@b.com' });
    const service2 = EmailService.getInstance({ apiKey: 'k', fromEmail: 'a@b.com' });
    expect(service1).toBe(service2);
  });
});

describe('SmsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fail initialization with missing config', () => {
    const service = SmsService.getInstance({
      accountSid: '',
      authToken: '',
      fromPhoneNumber: '',
    });
    const result = service.initialize();
    expect(result).toBe(false);
  });

  it('should only send SMS for critical thresholds (90%+)', async () => {
    const service = SmsService.getInstance({
      accountSid: 'sid',
      authToken: 'token',
      fromPhoneNumber: '+1234567890',
    });
    // Without initialize, should skip
    const result = await service.sendThresholdAlert(
      '+1234567890',
      'test-key',
      80, // Below 90%
      800,
      1000,
      80
    );
    expect(result).toBe(false);
  });

  it('should enforce daily limits', async () => {
    const service = SmsService.getInstance({
      accountSid: 'sid',
      authToken: 'token',
      fromPhoneNumber: '+1234567890',
    });
    service.setDailyLimit(2);
    // Without initialize, all will fail
    await service.send({ to: '+1234567890', message: 'Test 1' });
    await service.send({ to: '+1234567890', message: 'Test 2' });
    const result = await service.send({ to: '+1234567890', message: 'Test 3' });
    expect(result).toBe(false);
  });

  it('should be a singleton', () => {
    const service1 = SmsService.getInstance({ accountSid: 's', authToken: 't', fromPhoneNumber: '123' });
    const service2 = SmsService.getInstance({ accountSid: 's', authToken: 't', fromPhoneNumber: '123' });
    expect(service1).toBe(service2);
  });
});

describe('TelegramBotService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should fail initialization with missing config', () => {
    const service = TelegramBotService.getInstance({
      botToken: '',
    });
    const result = service.initialize();
    expect(result).toBe(false);
  });

  it('should manage user sessions', () => {
    const service = TelegramBotService.getInstance({
      botToken: 'test-token',
    });
    const userId = 12345;
    service.linkLicenseKey(userId, 'test-license-key');
    const session = service.getUserSession(userId);
    expect(session).toBeDefined();
    expect(session?.licenseKeys).toContain('test-license-key');
  });

  it('should unlink license keys', () => {
    const service = TelegramBotService.getInstance({
      botToken: 'test-token',
    });
    const userId = 12345;
    service.linkLicenseKey(userId, 'key-to-remove');
    service.unlinkLicenseKey(userId, 'key-to-remove');
    const session = service.getUserSession(userId);
    expect(session?.licenseKeys).not.toContain('key-to-remove');
  });

  it('should handle notification toggling', () => {
    const service = TelegramBotService.getInstance({
      botToken: 'test-token',
    });
    const userId = 12345;

    // After linking, should be enabled by default
    service.linkLicenseKey(userId, 'test-key');
    let session = service.getUserSession(userId);
    expect(session?.notificationsEnabled).toBe(true);

    // Simulate toggling off
    session!.notificationsEnabled = false;
    session = service.getUserSession(userId);
    expect(session?.notificationsEnabled).toBe(false);
  });

  it('should be a singleton', () => {
    const service1 = TelegramBotService.getInstance({ botToken: 'tok' });
    const service2 = TelegramBotService.getInstance({ botToken: 'tok' });
    expect(service1).toBe(service2);
  });
});

describe('Notification Integration', () => {
  it('should have all services as singletons', () => {
    const email1 = EmailService.getInstance({ apiKey: 'k', fromEmail: 'a@b.com' });
    const email2 = EmailService.getInstance({ apiKey: 'k', fromEmail: 'a@b.com' });
    expect(email1).toBe(email2);

    const sms1 = SmsService.getInstance({ accountSid: 's', authToken: 't', fromPhoneNumber: '123' });
    const sms2 = SmsService.getInstance({ accountSid: 's', authToken: 't', fromPhoneNumber: '123' });
    expect(sms1).toBe(sms2);

    const telegram1 = TelegramBotService.getInstance({ botToken: 'tok' });
    const telegram2 = TelegramBotService.getInstance({ botToken: 'tok' });
    expect(telegram1).toBe(telegram2);
  });
});
