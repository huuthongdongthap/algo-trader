// Email sender — real SMTP via built-in Node.js net/tls, no external deps
// Falls back to logging when SMTP env vars are not configured
import type { TradeResult } from '../core/types.js';
import { logger } from '../core/logger.js';
import { sendSmtpEmail, type SmtpConfig } from './smtp-client.js';

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  username: string;
  password: string;
  from: string;
}

function buildEmailConfigFromEnv(): EmailConfig | null {
  const host = process.env['SMTP_HOST'];
  const port = process.env['SMTP_PORT'];
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];
  const from = process.env['SMTP_FROM'];

  if (!host || !port || !user || !pass || !from) return null;

  return {
    smtpHost: host,
    smtpPort: Number(port),
    smtpSecure: process.env['SMTP_SECURE'] === 'true',
    username: user,
    password: pass,
    from,
  };
}

export class EmailSender {
  private readonly config: EmailConfig | null;

  constructor(config?: EmailConfig) {
    this.config = config ?? buildEmailConfigFromEnv();
  }

  /** Returns true when all required SMTP env vars are present */
  isConfigured(): boolean {
    return this.config !== null;
  }

  /** Send an email via real SMTP. Logs warning and skips when not configured. */
  async sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
    if (!this.config) {
      logger.warn('Email not configured — skipping send', 'EmailSender', { to, subject });
      return;
    }

    const smtpConfig: SmtpConfig = {
      host: this.config.smtpHost,
      port: this.config.smtpPort,
      secure: this.config.smtpSecure,
      username: this.config.username,
      password: this.config.password,
    };

    try {
      await sendSmtpEmail(smtpConfig, this.config.from, to, subject, htmlBody);
    } catch (err) {
      logger.error('Email send failed', 'EmailSender', {
        to,
        subject,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async sendTradeAlert(to: string, trade: TradeResult): Promise<void> {
    const isBuy = trade.side === 'buy';
    const sideColor = isBuy ? '#2ecc71' : '#e74c3c';
    const sideLabel = trade.side.toUpperCase();
    const subject = `[CashClaw] Trade Alert — ${sideLabel} ${trade.marketId}`;

    const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f5f5f5;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
    <h2 style="color:${sideColor};margin-top:0;">Trade Executed — ${sideLabel}</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;color:#666;">Market</td><td><strong>${trade.marketId}</strong></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Order ID</td><td><code>${trade.orderId}</code></td></tr>
      <tr><td style="padding:6px 0;color:#666;">Fill Price</td><td>${trade.fillPrice}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Fill Size</td><td>${trade.fillSize}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Fees</td><td>${trade.fees}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Strategy</td><td>${trade.strategy}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Time</td><td>${new Date(trade.timestamp).toISOString()}</td></tr>
    </table>
  </div>
</body>
</html>`.trim();

    await this.sendEmail(to, subject, htmlBody);
  }

  async sendWelcome(to: string, apiKey: string): Promise<void> {
    const subject = '[CashClaw] Welcome — Your API Key';
    const htmlBody = `
<!DOCTYPE html>
<html>
<body style="font-family:sans-serif;background:#f5f5f5;padding:24px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:8px;padding:24px;">
    <h2 style="color:#2ecc71;margin-top:0;">Welcome to CashClaw</h2>
    <p>Your API key:</p>
    <code style="display:block;background:#f0f0f0;padding:12px;border-radius:4px;word-break:break-all;">${apiKey}</code>
    <p style="color:#666;font-size:14px;margin-top:16px;">Keep this key secret. You can rotate it anytime from the dashboard.</p>
  </div>
</body>
</html>`.trim();

    await this.sendEmail(to, subject, htmlBody);
  }
}
