/**
 * Telegram Bot Service
 * Handles threshold alerts and user commands via Telegram
 */

import { Bot, Context } from 'grammy';
import type { PollingOptions } from 'grammy';
import { getRedisClient } from '../redis';
import { logger } from '../utils/logger';
import {
  formatTelegramMessage,
  getUrgency,
  getEmoji,
  getTelegramActionMessage,
  generateTelegramProgressBar,
  getShortKey,
} from '../notifications/alert-formatter';

export interface TelegramConfig {
  botToken: string;
}

export interface UserSession {
  userId: number;
  licenseKeys: string[];
  notificationsEnabled: boolean;
  lastCommand: string;
}

export class TelegramBotService {
  private static instance: TelegramBotService;
  private config: TelegramConfig;
  private bot: Bot<Context> | null = null;
  private initialized: boolean = false;
  private userSessions: Map<number, UserSession> = new Map();
  private rateLimitDelay: number = 1000; // 1 second between messages
  private redisKeyPrefix: string = 'algo:rate_limit:telegram:';

  private constructor(config?: TelegramConfig) {
    this.config = config || {
      botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    };
  }

  static getInstance(config?: TelegramConfig): TelegramBotService {
    if (!TelegramBotService.instance) {
      TelegramBotService.instance = new TelegramBotService(config);
    }
    return TelegramBotService.instance;
  }

  initialize(): boolean {
    if (!this.config.botToken) {
      logger.warn('[TelegramBot] Missing TELEGRAM_BOT_TOKEN');
      return false;
    }

    try {
      this.bot = new Bot<Context>(this.config.botToken);
      this.setupCommands();
      this.setupMiddleware();
      logger.info('[TelegramBot] Initialized with Telegram');
      return true;
    } catch (error) {
      logger.error('[TelegramBot] Initialization failed:', { error });
      return false;
    }
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async start(): Promise<void> {
    if (!this.bot || !this.initialized) {
      throw new Error('TelegramBot not initialized');
    }

    // Start the bot in the background
    this.bot.start({
      onStart: (info) => {
        logger.info(`[TelegramBot] Running as @${info.username}`);
      },
    });

    // Handle polling errors separately
    this.bot.catch((error) => {
      logger.error('[TelegramBot] Error:', { error });
    });

    this.initialized = true;
  }

  async stop(): Promise<void> {
    if (this.bot) {
      await this.bot.stop();
      this.initialized = false;
      logger.info('[TelegramBot] Stopped');
    }
  }

  private setupCommands(): void {
    if (!this.bot) return;

    // /start command
    this.bot.command('start', async (ctx: Context) => {
      await this.handleStart(ctx);
    });

    // /help command
    this.bot.command('help', async (ctx: Context) => {
      await this.handleHelp(ctx);
    });

    // /status command - show current usage
    this.bot.command('status', async (ctx: Context) => {
      await this.handleStatus(ctx);
    });

    // /link command - link a license key
    this.bot.command('link', async (ctx: Context) => {
      await this.handleLink(ctx);
    });

    // /unlink command - unlink a license key
    this.bot.command('unlink', async (ctx: Context) => {
      await this.handleUnlink(ctx);
    });

    // /notifications command - toggle notifications
    this.bot.command('notifications', async (ctx: Context) => {
      await this.handleNotifications(ctx);
    });

    // /limits command - show current limits
    this.bot.command('limits', async (ctx: Context) => {
      await this.handleLimits(ctx);
    });

    // /balance command - show account balance
    this.bot.command('balance', async (ctx: Context) => {
      await this.handleBalance(ctx);
    });

    // /positions command - show open positions
    this.bot.command('positions', async (ctx: Context) => {
      await this.handlePositions(ctx);
    });

    // /pnl command - show P&L statistics
    this.bot.command('pnl', async (ctx: Context) => {
      await this.handlePnl(ctx);
    });
  }

  private setupMiddleware(): void {
    if (!this.bot) return;

    // Logging middleware
    this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
      const userId = ctx.from?.id;
      if (userId) {
        if (!this.userSessions.has(userId)) {
          this.userSessions.set(userId, {
            userId,
            licenseKeys: [],
            notificationsEnabled: true,
            lastCommand: '',
          });
        }
      }
      await next();
    });
  }

  private async handleStart(ctx: Context): Promise<void> {
    const welcomeMessage = `
🤖 Welcome to Algo Trader Bot!

I'll send you instant alerts when your API usage reaches critical thresholds.

*Available Commands:*
/help - Show this help message
/status - Check your current usage
/link - Link a license key
/unlink - Unlink a license key
/notifications - Toggle alerts
/limits - View tier limits

Get started by linking your license key with /link <your-key>
    `.trim();

    await ctx.reply(welcomeMessage, { parse_mode: 'Markdown' });
  }

  private async handleHelp(ctx: Context): Promise<void> {
    const helpMessage = `
📖 *Algo Trader Bot Help*

*Commands:*
/start - Welcome message
/help - Show this help
/status - Current usage stats
/link <key> - Link license key
/unlink <key> - Unlink license key
/notifications - Toggle on/off
/limits - View tier limits

*Alert Thresholds:*
⚠️ 80% - Warning (email only)
🔴 90% - Urgent (email + SMS + Telegram)
🚨 100% - Critical (all channels)

*Support:*
Contact support for assistance.
    `.trim();

    await ctx.reply(helpMessage, { parse_mode: 'Markdown' });
  }

  private async handleStatus(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = this.userSessions.get(userId);
    if (!session || session.licenseKeys.length === 0) {
      await ctx.reply('No license keys linked. Use /link <your-key> to get started.');
      return;
    }

    const statusMessage = `
📊 *Your Linked Keys:*
${session.licenseKeys.map(key => `• \`${key}\``).join('\n')}

Use /status <key> for detailed usage.
    `.trim();

    await ctx.reply(statusMessage, { parse_mode: 'Markdown' });
  }

  private async handleLink(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const args = (ctx.message as any)?.text?.split(' ');
    if (!args || args.length < 2) {
      await ctx.reply('Usage: /link <your-license-key>');
      return;
    }

    const licenseKey = args[1];
    let session = this.userSessions.get(userId);

    if (!session) {
      session = {
        userId,
        licenseKeys: [],
        notificationsEnabled: true,
        lastCommand: 'link',
      };
      this.userSessions.set(userId, session);
    }

    if (session.licenseKeys.includes(licenseKey)) {
      await ctx.reply(`Key \`${licenseKey}\` is already linked.`, { parse_mode: 'Markdown' });
      return;
    }

    session.licenseKeys.push(licenseKey);
    session.lastCommand = 'link';

    await ctx.reply(
      `✅ License key \`${licenseKey}\` linked successfully!\n\nYou'll now receive alerts for this key.`,
      { parse_mode: 'Markdown' }
    );
  }

  private async handleUnlink(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const args = (ctx.message as any)?.text?.split(' ');
    if (!args || args.length < 2) {
      await ctx.reply('Usage: /unlink <your-license-key>');
      return;
    }

    const licenseKey = args[1];
    const session = this.userSessions.get(userId);

    if (!session) {
      await ctx.reply('No license keys linked.');
      return;
    }

    const index = session.licenseKeys.indexOf(licenseKey);
    if (index === -1) {
      await ctx.reply(`Key \`${licenseKey}\` not found.`, { parse_mode: 'Markdown' });
      return;
    }

    session.licenseKeys.splice(index, 1);
    session.lastCommand = 'unlink';

    await ctx.reply(
      `✅ License key \`${licenseKey}\` unlinked.`,
      { parse_mode: 'Markdown' }
    );
  }

  private async handleNotifications(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    let session = this.userSessions.get(userId);

    if (!session) {
      session = {
        userId,
        licenseKeys: [],
        notificationsEnabled: true,
        lastCommand: 'notifications',
      };
      this.userSessions.set(userId, session);
    }

    session.notificationsEnabled = !session.notificationsEnabled;
    session.lastCommand = 'notifications';

    const status = session.notificationsEnabled ? 'enabled' : 'disabled';
    await ctx.reply(
      `🔔 Notifications ${status}.\n\nYou will ${session.notificationsEnabled ? '' : 'NOT '}receive threshold alerts.`,
      { parse_mode: 'Markdown' }
    );
  }

  private async handleLimits(ctx: Context): Promise<void> {
    const limitsMessage = `
📏 *API Usage Limits by Tier*

*FREE*
• 100 calls/day
• $0.00 overage

*PRO*
• 10,000 calls/day
• $0.01 per overage call

*ENTERPRISE*
• 100,000 calls/day
• $0.005 per overage call

*Alert Thresholds:*
• 80% - Warning
• 90% - Urgent
• 100% - Critical

Upgrade anytime to increase your limits.
    `.trim();

    await ctx.reply(limitsMessage, { parse_mode: 'Markdown' });
  }

  private async handleBalance(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = this.userSessions.get(userId);
    if (!session || session.licenseKeys.length === 0) {
      await ctx.reply('No license keys linked. Use /link <your-key> to get started.');
      return;
    }

    // Get balance info from Redis (placeholder - integrate with actual balance service)
    const redis = getRedisClient();
    const balanceData = await redis.hgetall(`balance:${session.licenseKeys[0]}`);
    const balance = parseFloat(balanceData.balance || '0');
    const equity = parseFloat(balanceData.equity || balanceData.balance || '0');

    const balanceMessage = `
💰 *Account Balance*

*Available:* $${balance.toFixed(2)}
*Equity:* $${equity.toFixed(2)}

*Linked Keys:* ${session.licenseKeys.length}
    `.trim();

    await ctx.reply(balanceMessage, { parse_mode: 'Markdown' });
  }

  private async handlePositions(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = this.userSessions.get(userId);
    if (!session || session.licenseKeys.length === 0) {
      await ctx.reply('No license keys linked. Use /link <your-key> to get started.');
      return;
    }

    // Get positions from Redis (placeholder - integrate with actual position service)
    const redis = getRedisClient();
    const positionsData = await redis.get(`positions:${session.licenseKeys[0]}`);
interface Position {
  symbol: string;
  side: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
}

// ... (existing code)

    const positions: Position[] = positionsData ? JSON.parse(positionsData) : [];

    if (positions.length === 0) {
      await ctx.reply('📭 No open positions');
      return;
    }

    const positionsMessage = `
📊 *Open Positions*

${positions.map((p) => `
*${p.symbol}*
Side: ${p.side.toUpperCase()}
Qty: ${p.quantity}
Entry: $${p.entryPrice.toFixed(2)}
Current: $${p.currentPrice.toFixed(2)}
P&L: $${p.unrealizedPnl.toFixed(2)}
`).join('\n')}
    `.trim();

    await ctx.reply(positionsMessage, { parse_mode: 'Markdown' });
  }

  private async handlePnl(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = this.userSessions.get(userId);
    if (!session || session.licenseKeys.length === 0) {
      await ctx.reply('No license keys linked. Use /link <your-key> to get started.');
      return;
    }

    // Get P&L data from Redis (placeholder - integrate with actual P&L service)
    const redis = getRedisClient();
    const pnlData = await redis.hgetall(`pnl:${session.licenseKeys[0]}`);
    const realizedPnl = parseFloat(pnlData.realized || '0');
    const unrealizedPnl = parseFloat(pnlData.unrealized || '0');
    const totalTrades = parseInt(pnlData.totalTrades || '0');
    const winningTrades = parseInt(pnlData.winningTrades || '0');

    const winRate = totalTrades > 0 ? ((winningTrades / totalTrades) * 100).toFixed(1) : '0';

    const pnlMessage = `
📈 *P&L Statistics*

*Realized P&L:* $${realizedPnl.toFixed(2)}
*Unrealized P&L:* $${unrealizedPnl.toFixed(2)}
*Total:* $${(realizedPnl + unrealizedPnl).toFixed(2)}

*Trades:* ${totalTrades}
*Wins:* ${winningTrades}
*Losses:* ${totalTrades - winningTrades}
*Win Rate:* ${winRate}%
    `.trim();

    await ctx.reply(pnlMessage, { parse_mode: 'Markdown' });
  }

  async sendThresholdAlert(
    chatId: number,
    licenseKey: string,
    threshold: number,
    currentUsage: number,
    dailyLimit: number,
    percentUsed: number
  ): Promise<boolean> {
    if (!this.initialized || !this.bot) {
      logger.warn('[TelegramBot] Not initialized, skipping message');
      return false;
    }

    // Check rate limit via Redis
    await this.applyRateLimitRedis(chatId);

    // Check if user has notifications enabled
    const session = this.userSessions.get(chatId);
    if (session && !session.notificationsEnabled) {
      logger.info(`[TelegramBot] Notifications disabled for user ${chatId}`);
      return false;
    }

    const message = formatTelegramMessage({
      licenseKey,
      threshold,
      currentUsage,
      dailyLimit,
      percentUsed,
    });

    try {
      await this.bot.api.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      logger.info(`[TelegramBot] Alert sent to chat ${chatId}`);
      return true;
    } catch (error) {
      logger.error('[TelegramBot] Send failed:', { error });
      return false;
    }
  }

  async sendToAllLinkedUsers(
    licenseKey: string,
    threshold: number,
    currentUsage: number,
    dailyLimit: number,
    percentUsed: number
  ): Promise<number> {
    let sentCount = 0;

    for (const [userId, session] of this.userSessions.entries()) {
      if (session.licenseKeys.includes(licenseKey) && session.notificationsEnabled) {
        const success = await this.sendThresholdAlert(
          userId,
          licenseKey,
          threshold,
          currentUsage,
          dailyLimit,
          percentUsed
        );
        if (success) sentCount++;
      }
    }

    return sentCount;
  }

  private generateProgressBar(percentUsed: number): string {
    return generateTelegramProgressBar(percentUsed);
  }

  private getActionMessage(threshold: number): string {
    return getTelegramActionMessage(threshold);
  }

  private getShortKey(licenseKey: string): string {
    return getShortKey(licenseKey);
  }

  /**
   * Redis-backed rate limiting for crash resilience
   */
  private async applyRateLimitRedis(chatId: number): Promise<void> {
    try {
      const redis = getRedisClient();
      const key = `${this.redisKeyPrefix}${chatId}`;
      const lastSend = await redis.get(key);

      if (lastSend) {
        const elapsed = Date.now() - parseInt(lastSend);
        if (elapsed < this.rateLimitDelay) {
          await new Promise(resolve => setTimeout(resolve, this.rateLimitDelay - elapsed));
        }
      }

      await redis.setex(key, 3600, Date.now().toString());
    } catch (error) {
      logger.warn('[TelegramBot] Redis rate limiting failed:', { error });
    }
  }

  getUserSession(userId: number): UserSession | undefined {
    return this.userSessions.get(userId);
  }

  linkLicenseKey(userId: number, licenseKey: string): void {
    let session = this.userSessions.get(userId);
    if (!session) {
      session = {
        userId,
        licenseKeys: [],
        notificationsEnabled: true,
        lastCommand: '',
      };
      this.userSessions.set(userId, session);
    }

    if (!session.licenseKeys.includes(licenseKey)) {
      session.licenseKeys.push(licenseKey);
    }
  }

  unlinkLicenseKey(userId: number, licenseKey: string): void {
    const session = this.userSessions.get(userId);
    if (session) {
      const index = session.licenseKeys.indexOf(licenseKey);
      if (index > -1) {
        session.licenseKeys.splice(index, 1);
      }
    }
  }
}

export const telegramBotService = TelegramBotService.getInstance();
