// Notification router — broadcast alerts to all configured channels
import type { TradeResult } from '../core/types.js';
import { logger } from '../core/logger.js';

export type NotificationChannel = 'telegram' | 'discord' | 'slack' | 'email';

/** Minimal interface every notifier must satisfy */
export interface ChannelNotifier {
  sendMessage(text: string): Promise<void>;
  sendTradeAlert(trade: TradeResult): Promise<void>;
}

export interface ChannelConfig {
  channel: NotificationChannel;
  enabled: boolean;
  notifier: ChannelNotifier;
}

export class NotificationRouter {
  private readonly channels = new Map<NotificationChannel, ChannelConfig>();

  /** Register or replace a channel notifier */
  addChannel(channel: NotificationChannel, notifier: ChannelNotifier, enabled = true): void {
    this.channels.set(channel, { channel, enabled, notifier });
    logger.debug('Channel registered', 'NotificationRouter', { channel, enabled });
  }

  /** Enable or disable a registered channel at runtime */
  setEnabled(channel: NotificationChannel, enabled: boolean): void {
    const cfg = this.channels.get(channel);
    if (cfg) {
      cfg.enabled = enabled;
      logger.debug('Channel toggled', 'NotificationRouter', { channel, enabled });
    }
  }

  /** Returns names of currently enabled channels */
  enabledChannels(): NotificationChannel[] {
    return [...this.channels.values()]
      .filter((c) => c.enabled)
      .map((c) => c.channel);
  }

  /**
   * Send a plain text message.
   * @param message Text to send
   * @param channels Explicit channel list; omit to send to all enabled channels
   */
  async send(message: string, channels?: NotificationChannel[]): Promise<void> {
    const targets = this.resolveTargets(channels);
    await Promise.allSettled(
      targets.map(async (cfg) => {
        try {
          await cfg.notifier.sendMessage(message);
        } catch (err) {
          logger.error('Router send failed', 'NotificationRouter', {
            channel: cfg.channel,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  /**
   * Broadcast a trade alert to all enabled channels (or explicit subset).
   * @param trade TradeResult to broadcast
   * @param channels Explicit channel list; omit to send to all enabled channels
   */
  async sendTradeAlert(trade: TradeResult, channels?: NotificationChannel[]): Promise<void> {
    const targets = this.resolveTargets(channels);
    logger.info('Broadcasting trade alert', 'NotificationRouter', {
      orderId: trade.orderId,
      channels: targets.map((c) => c.channel),
    });

    await Promise.allSettled(
      targets.map(async (cfg) => {
        try {
          await cfg.notifier.sendTradeAlert(trade);
        } catch (err) {
          logger.error('Router trade alert failed', 'NotificationRouter', {
            channel: cfg.channel,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }),
    );
  }

  // ── private ────────────────────────────────────────────────────────────────

  private resolveTargets(channels?: NotificationChannel[]): ChannelConfig[] {
    if (channels && channels.length > 0) {
      return channels
        .map((ch) => this.channels.get(ch))
        .filter((cfg): cfg is ChannelConfig => cfg !== undefined && cfg.enabled);
    }
    return [...this.channels.values()].filter((c) => c.enabled);
  }
}
