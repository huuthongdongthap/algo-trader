// Discord webhook integration — native fetch, no external deps
import type { TradeResult } from '../core/types.js';
import { logger } from '../core/logger.js';

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  timestamp?: string;
}

interface DiscordWebhookPayload {
  content?: string;
  embeds?: DiscordEmbed[];
}

export class DiscordNotifier {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  private async post(payload: DiscordWebhookPayload): Promise<void> {
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.warn('Discord webhook error', 'DiscordNotifier', { status: res.status, body: text });
      }
    } catch (err) {
      // Never crash — Discord is non-critical
      logger.error('Discord send failed', 'DiscordNotifier', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async sendMessage(content: string): Promise<void> {
    await this.post({ content });
  }

  async sendEmbed(
    title: string,
    description: string,
    color = 0x5865f2,
    fields: DiscordEmbedField[] = [],
  ): Promise<void> {
    const embed: DiscordEmbed = {
      title,
      description,
      color,
      fields,
      timestamp: new Date().toISOString(),
    };
    await this.post({ embeds: [embed] });
  }

  async sendTradeAlert(trade: TradeResult): Promise<void> {
    const isBuy = trade.side === 'buy';
    const color = isBuy ? 0x57f287 : 0xed4245; // green / red
    const title = isBuy ? '🟢 Trade Executed — BUY' : '🔴 Trade Executed — SELL';

    const fields: DiscordEmbedField[] = [
      { name: 'Market', value: trade.marketId, inline: true },
      { name: 'Side', value: trade.side.toUpperCase(), inline: true },
      { name: 'Fill Price', value: trade.fillPrice, inline: true },
      { name: 'Fill Size', value: trade.fillSize, inline: true },
      { name: 'Fees', value: trade.fees, inline: true },
      { name: 'Strategy', value: trade.strategy, inline: true },
      { name: 'Time', value: new Date(trade.timestamp).toISOString(), inline: false },
    ];

    await this.sendEmbed(title, `Order: \`${trade.orderId}\``, color, fields);
  }
}
