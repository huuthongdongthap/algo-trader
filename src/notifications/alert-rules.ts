// Configurable alert rules with cooldown management
import type { TradeResult, PnlSnapshot } from '../core/types.js';
import { logger } from '../core/logger.js';

export interface AlertRule {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  condition: (data: any) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  message: (data: any) => string;
  /** Minimum ms between repeated alerts for this rule */
  cooldownMs: number;
}

interface CooldownEntry {
  lastFiredAt: number;
}

// Built-in rule definitions (registered by default in AlertManager)
const DRAWDOWN_THRESHOLD = 0.15; // 15%

export const builtInRules: AlertRule[] = [
  {
    name: 'tradeExecuted',
    condition: (_data: TradeResult) => true,
    message: (data: TradeResult) =>
      `Trade executed: ${data.side.toUpperCase()} ${data.fillSize} @ ${data.fillPrice} on ${data.marketId}`,
    cooldownMs: 0, // fire every trade
  },
  {
    name: 'drawdownThreshold',
    condition: (data: PnlSnapshot) => data.drawdown >= DRAWDOWN_THRESHOLD,
    message: (data: PnlSnapshot) =>
      `Drawdown alert: ${(data.drawdown * 100).toFixed(2)}% (threshold: ${DRAWDOWN_THRESHOLD * 100}%)`,
    cooldownMs: 5 * 60 * 1000, // 5 minutes cooldown
  },
  {
    name: 'errorOccurred',
    condition: (_data: string) => true,
    message: (data: string) => `System error: ${data}`,
    cooldownMs: 60 * 1000, // 1 minute cooldown
  },
  {
    name: 'dailySummary',
    condition: (_data: PnlSnapshot) => true,
    message: (data: PnlSnapshot) =>
      `Daily summary — Equity: ${data.equity}, Realized PnL: ${data.realizedPnl}, Trades: ${data.tradeCount}`,
    cooldownMs: 23 * 60 * 60 * 1000, // 23h cooldown (once per day)
  },
];

export class AlertManager {
  private readonly rules = new Map<string, AlertRule>();
  private readonly cooldowns = new Map<string, CooldownEntry>();

  constructor(registerDefaults = true) {
    if (registerDefaults) {
      builtInRules.forEach((r) => this.register(r));
    }
  }

  register(rule: AlertRule): void {
    this.rules.set(rule.name, rule);
    logger.debug(`Alert rule registered: ${rule.name}`, 'AlertManager');
  }

  /**
   * Returns true if alert should fire (condition met + cooldown expired).
   * Also updates cooldown timestamp when returning true.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shouldAlert(ruleName: string, data: any): boolean {
    const rule = this.rules.get(ruleName);
    if (!rule) {
      logger.warn(`Unknown alert rule: ${ruleName}`, 'AlertManager');
      return false;
    }

    let conditionMet = false;
    try {
      conditionMet = rule.condition(data);
    } catch (err) {
      logger.error(`Rule condition threw: ${ruleName}`, 'AlertManager', {
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }

    if (!conditionMet) return false;

    const now = Date.now();
    const entry = this.cooldowns.get(ruleName);

    if (entry && rule.cooldownMs > 0 && now - entry.lastFiredAt < rule.cooldownMs) {
      logger.debug(`Alert suppressed by cooldown: ${ruleName}`, 'AlertManager');
      return false;
    }

    this.cooldowns.set(ruleName, { lastFiredAt: now });
    return true;
  }

  /** Get formatted message for a rule given data (call after shouldAlert returns true) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getMessage(ruleName: string, data: any): string | null {
    const rule = this.rules.get(ruleName);
    if (!rule) return null;
    try {
      return rule.message(data);
    } catch {
      return null;
    }
  }

  getRuleNames(): string[] {
    return Array.from(this.rules.keys());
  }
}
