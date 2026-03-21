// Trade compliance validation engine
// Runs configurable rules before trade execution to catch policy violations
// Built-in rules: maxTradeSize, sanctionedAssets, dailyLimit, leverageLimit

import { logger } from '../core/logger.js';

export interface TradeCandidate {
  marketId: string;
  side: 'buy' | 'sell';
  /** Decimal string */
  size: string;
  /** Decimal string */
  price: string;
  /** Leverage multiplier (1 = no leverage) */
  leverage?: number;
  userId?: string;
  strategy?: string;
}

export interface RuleResult {
  pass: boolean;
  reason?: string;
}

export interface ComplianceRule {
  name: string;
  check: (trade: TradeCandidate) => RuleResult;
}

export interface ValidationResult {
  approved: boolean;
  violations: string[];
  /** Names of all rules that ran */
  rulesChecked: string[];
}

interface ComplianceStats {
  totalChecks: number;
  totalViolations: number;
  violationsByRule: Record<string, number>;
}

// ── Built-in rule factories ────────────────────────────────────────────────

export function maxTradeSizeRule(maxSize: number): ComplianceRule {
  return {
    name: 'maxTradeSize',
    check(trade) {
      const size = parseFloat(trade.size);
      if (isNaN(size) || size > maxSize) {
        return { pass: false, reason: `Trade size ${trade.size} exceeds max ${maxSize}` };
      }
      return { pass: true };
    },
  };
}

export function sanctionedAssetsRule(sanctionedList: string[]): ComplianceRule {
  const blocked = new Set(sanctionedList.map(s => s.toUpperCase()));
  return {
    name: 'sanctionedAssets',
    check(trade) {
      const market = trade.marketId.toUpperCase();
      if (blocked.has(market)) {
        return { pass: false, reason: `Market ${trade.marketId} is on the sanctioned list` };
      }
      return { pass: true };
    },
  };
}

export function dailyLimitRule(maxDailyNotional: number, getDailyTotal: () => number): ComplianceRule {
  return {
    name: 'dailyLimit',
    check(trade) {
      const notional = parseFloat(trade.size) * parseFloat(trade.price);
      const currentTotal = getDailyTotal();
      if (currentTotal + notional > maxDailyNotional) {
        return {
          pass: false,
          reason: `Daily notional limit ${maxDailyNotional} would be exceeded (current: ${currentTotal.toFixed(2)}, new: ${notional.toFixed(2)})`,
        };
      }
      return { pass: true };
    },
  };
}

export function leverageLimitRule(maxLeverage: number): ComplianceRule {
  return {
    name: 'leverageLimit',
    check(trade) {
      const lev = trade.leverage ?? 1;
      if (lev > maxLeverage) {
        return { pass: false, reason: `Leverage ${lev}x exceeds max allowed ${maxLeverage}x` };
      }
      return { pass: true };
    },
  };
}

// ── ComplianceChecker ──────────────────────────────────────────────────────

export class ComplianceChecker {
  private rules: ComplianceRule[] = [];
  private stats: ComplianceStats = {
    totalChecks: 0,
    totalViolations: 0,
    violationsByRule: {},
  };

  /** Register a compliance rule. Duplicate names are silently replaced. */
  registerRule(rule: ComplianceRule): void {
    const idx = this.rules.findIndex(r => r.name === rule.name);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  removeRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
  }

  /**
   * Run all registered rules against the trade candidate.
   * Returns approved=true only when every rule passes.
   */
  validateTrade(trade: TradeCandidate): ValidationResult {
    const violations: string[] = [];
    const rulesChecked: string[] = [];

    for (const rule of this.rules) {
      rulesChecked.push(rule.name);
      try {
        const result = rule.check(trade);
        if (!result.pass) {
          violations.push(`[${rule.name}] ${result.reason ?? 'Violation'}`);
          this.stats.violationsByRule[rule.name] = (this.stats.violationsByRule[rule.name] ?? 0) + 1;
          this.stats.totalViolations++;
        }
      } catch (err) {
        logger.error('compliance: rule threw during check', 'ComplianceChecker', {
          rule: rule.name,
          error: String(err),
        });
        violations.push(`[${rule.name}] Rule check failed — trade blocked by default`);
        this.stats.violationsByRule[rule.name] = (this.stats.violationsByRule[rule.name] ?? 0) + 1;
        this.stats.totalViolations++;
      }
    }

    this.stats.totalChecks++;
    const approved = violations.length === 0;
    return { approved, violations, rulesChecked };
  }

  /** Summary of all checks run and violations encountered since startup */
  getComplianceReport(): ComplianceStats & { activeRules: string[] } {
    return {
      ...this.stats,
      violationsByRule: { ...this.stats.violationsByRule },
      activeRules: this.rules.map(r => r.name),
    };
  }

  resetStats(): void {
    this.stats = { totalChecks: 0, totalViolations: 0, violationsByRule: {} };
  }
}
