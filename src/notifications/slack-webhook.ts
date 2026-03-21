// Slack incoming webhook integration — native fetch, no external deps
import type { TradeResult } from '../core/types.js';
import { logger } from '../core/logger.js';

// Slack Block Kit types (minimal subset needed)
interface SlackTextObject {
  type: 'plain_text' | 'mrkdwn';
  text: string;
}

interface SlackSectionBlock {
  type: 'section';
  text?: SlackTextObject;
  fields?: SlackTextObject[];
}

interface SlackDividerBlock {
  type: 'divider';
}

type SlackBlock = SlackSectionBlock | SlackDividerBlock;

interface SlackWebhookPayload {
  text?: string;
  blocks?: SlackBlock[];
}

export class SlackNotifier {
  private readonly webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  private async post(payload: SlackWebhookPayload): Promise<void> {
    try {
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        logger.warn('Slack webhook error', 'SlackNotifier', { status: res.status, body: text });
      }
    } catch (err) {
      // Never crash — Slack is non-critical
      logger.error('Slack send failed', 'SlackNotifier', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async sendMessage(text: string): Promise<void> {
    await this.post({ text });
  }

  async sendBlocks(blocks: SlackBlock[]): Promise<void> {
    await this.post({ blocks });
  }

  async sendTradeAlert(trade: TradeResult): Promise<void> {
    const isBuy = trade.side === 'buy';
    const sideEmoji = isBuy ? ':large_green_circle:' : ':red_circle:';
    const sideLabel = trade.side.toUpperCase();

    const blocks: SlackBlock[] = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `${sideEmoji} *Trade Executed — ${sideLabel}*\nOrder: \`${trade.orderId}\``,
        },
      },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Market*\n${trade.marketId}` },
          { type: 'mrkdwn', text: `*Side*\n${sideLabel}` },
          { type: 'mrkdwn', text: `*Fill Price*\n${trade.fillPrice}` },
          { type: 'mrkdwn', text: `*Fill Size*\n${trade.fillSize}` },
          { type: 'mrkdwn', text: `*Fees*\n${trade.fees}` },
          { type: 'mrkdwn', text: `*Strategy*\n${trade.strategy}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Time:* ${new Date(trade.timestamp).toISOString()}`,
        },
      },
    ];

    await this.sendBlocks(blocks);
  }
}
