// Email sender stub — logs intent, real SMTP requires nodemailer
import type { TradeResult } from '../core/types.js';
import { logger } from '../core/logger.js';

export interface EmailConfig {
  smtpHost: string;
  smtpPort: number;
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

  /**
   * Stub: logs the email intent. Wire up nodemailer here when SMTP is ready.
   */
  async sendEmail(to: string, subject: string, htmlBody: string): Promise<void> {
    if (!this.isConfigured()) {
      logger.warn('Email not configured — skipping send', 'EmailSender', { to, subject });
      return;
    }

    // Stub: replace this block with real nodemailer transport when available
    logger.info('Email send (stub)', 'EmailSender', {
      from: this.config!.from,
      to,
      subject,
      smtpHost: this.config!.smtpHost,
      smtpPort: this.config!.smtpPort,
      bodyLength: htmlBody.length,
    });
  }

  async sendTradeAlert(to: string, trade: TradeResult): Promise<void> {
    const isBuy = trade.side === 'buy';
    const sideColor = isBuy ? '#2ecc71' : '#e74c3c';
    const sideLabel = trade.side.toUpperCase();
    const subject = `[AlgoTrade] Trade Alert — ${sideLabel} ${trade.marketId}`;

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
}
