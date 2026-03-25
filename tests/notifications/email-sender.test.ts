import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmailSender } from '../../src/notifications/email-sender.js';

// Mock smtp-client to avoid real network calls
vi.mock('../../src/notifications/smtp-client.js', () => ({
  sendSmtpEmail: vi.fn(async () => {}),
}));

import { sendSmtpEmail } from '../../src/notifications/smtp-client.js';

const mockSendSmtp = vi.mocked(sendSmtpEmail);

const SMTP_CONFIG = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: false,
  username: 'user@example.com',
  password: 'secret',
  from: 'noreply@cashclaw.cc',
};

describe('EmailSender', () => {
  beforeEach(() => {
    mockSendSmtp.mockClear();
  });

  it('should send email via SMTP when configured', async () => {
    const sender = new EmailSender(SMTP_CONFIG);
    expect(sender.isConfigured()).toBe(true);

    await sender.sendEmail('user@test.com', 'Test Subject', '<p>Hello</p>');

    expect(mockSendSmtp).toHaveBeenCalledOnce();
    const [config, from, to, subject, body] = mockSendSmtp.mock.calls[0];
    expect(config.host).toBe('smtp.example.com');
    expect(from).toBe('noreply@cashclaw.cc');
    expect(to).toBe('user@test.com');
    expect(subject).toBe('Test Subject');
    expect(body).toContain('Hello');
  });

  it('should skip send when not configured', async () => {
    const sender = new EmailSender();
    expect(sender.isConfigured()).toBe(false);

    await sender.sendEmail('user@test.com', 'Test', '<p>Hi</p>');
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  it('should not throw when SMTP fails', async () => {
    mockSendSmtp.mockRejectedValueOnce(new Error('Connection refused'));
    const sender = new EmailSender(SMTP_CONFIG);

    // Should not throw
    await sender.sendEmail('user@test.com', 'Test', '<p>Hi</p>');
  });

  it('should send trade alert with correct HTML', async () => {
    const sender = new EmailSender(SMTP_CONFIG);
    await sender.sendTradeAlert('user@test.com', {
      orderId: 'ord-1',
      marketId: 'BTC-100K',
      side: 'buy',
      fillPrice: '0.65',
      fillSize: '100',
      fees: '1.50',
      timestamp: Date.now(),
      strategy: 'prediction-edge',
    });

    expect(mockSendSmtp).toHaveBeenCalledOnce();
    const [, , , subject, body] = mockSendSmtp.mock.calls[0];
    expect(subject).toContain('BUY');
    expect(subject).toContain('BTC-100K');
    expect(body).toContain('0.65');
    expect(body).toContain('prediction-edge');
  });

  it('should send welcome email with API key', async () => {
    const sender = new EmailSender(SMTP_CONFIG);
    await sender.sendWelcome('new@user.com', 'ak_abc123');

    expect(mockSendSmtp).toHaveBeenCalledOnce();
    const [, , to, subject, body] = mockSendSmtp.mock.calls[0];
    expect(to).toBe('new@user.com');
    expect(subject).toContain('Welcome');
    expect(body).toContain('ak_abc123');
  });
});

describe('EmailSender env config', () => {
  afterEach(() => {
    delete process.env['SMTP_HOST'];
    delete process.env['SMTP_PORT'];
    delete process.env['SMTP_USER'];
    delete process.env['SMTP_PASS'];
    delete process.env['SMTP_FROM'];
    delete process.env['SMTP_SECURE'];
  });

  it('should read config from env vars', () => {
    process.env['SMTP_HOST'] = 'mail.test.com';
    process.env['SMTP_PORT'] = '465';
    process.env['SMTP_USER'] = 'u';
    process.env['SMTP_PASS'] = 'p';
    process.env['SMTP_FROM'] = 'a@b.com';
    process.env['SMTP_SECURE'] = 'true';

    const sender = new EmailSender();
    expect(sender.isConfigured()).toBe(true);
  });

  it('should return not configured when env vars missing', () => {
    const sender = new EmailSender();
    expect(sender.isConfigured()).toBe(false);
  });
});
