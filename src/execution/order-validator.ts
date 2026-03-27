/**
 * Order Validator
 * Validates orders before execution
 *
 * Validation rules:
 * - Minimum spread threshold
 * - Maximum position size
 * - Exchange balance check
 * - Rate limit compliance
 */

import { ArbitrageOpportunity } from '../arbitrage/spread-detector';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ValidatorConfig {
  minSpreadPercent: number;
  maxSpreadPercent: number;
  maxPositionSize: number;
  minPositionSize: number;
  maxDailyTrades: number;
  allowedExchanges: string[];
  blockedSymbols: string[];
}

export class OrderValidator {
  private config: ValidatorConfig;
  private dailyTradeCount = 0;
  private dailyTradeResetTime = 0;

  constructor(config?: Partial<ValidatorConfig>) {
    this.config = {
      minSpreadPercent: 0.1,
      maxSpreadPercent: 5.0,
      maxPositionSize: 1.0, // BTC
      minPositionSize: 0.001,
      maxDailyTrades: 1000,
      allowedExchanges: ['binance', 'okx', 'bybit'],
      blockedSymbols: [],
      ...config,
    };
  }

  /**
   * Validate arbitrage opportunity
   */
  validate(opportunity: ArbitrageOpportunity, amount: number): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Reset daily counter if new day
    this.checkDailyReset();

    // Check spread range
    if (opportunity.spreadPercent < this.config.minSpreadPercent) {
      errors.push(
        `Spread ${opportunity.spreadPercent.toFixed(2)}% below minimum ${this.config.minSpreadPercent}%`
      );
    }

    if (opportunity.spreadPercent > this.config.maxSpreadPercent) {
      warnings.push(
        `Spread ${opportunity.spreadPercent.toFixed(2)}% unusually high - possible stale data`
      );
    }

    // Check position size
    if (amount < this.config.minPositionSize) {
      errors.push(
        `Amount ${amount} below minimum ${this.config.minPositionSize}`
      );
    }

    if (amount > this.config.maxPositionSize) {
      errors.push(
        `Amount ${amount} exceeds maximum ${this.config.maxPositionSize}`
      );
    }

    // Check daily trade limit
    if (this.dailyTradeCount >= this.config.maxDailyTrades) {
      errors.push(`Daily trade limit reached: ${this.dailyTradeCount}/${this.config.maxDailyTrades}`);
    }

    // Check allowed exchanges
    if (!this.config.allowedExchanges.includes(opportunity.buyExchange.toLowerCase())) {
      errors.push(`Buy exchange ${opportunity.buyExchange} not in allowed list`);
    }

    if (!this.config.allowedExchanges.includes(opportunity.sellExchange.toLowerCase())) {
      errors.push(`Sell exchange ${opportunity.sellExchange} not in allowed list`);
    }

    // Check blocked symbols
    const symbol = opportunity.symbol.toUpperCase();
    if (this.config.blockedSymbols.includes(symbol)) {
      errors.push(`Symbol ${symbol} is blocked from trading`);
    }

    // Check latency
    if (opportunity.latency > 500) {
      warnings.push(`High latency: ${opportunity.latency}ms`);
    }

    // Check opportunity age
    const age = Date.now() - opportunity.timestamp;
    if (age > 1000) {
      warnings.push(`Stale opportunity: ${age}ms old`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Increment daily trade counter
   */
  incrementTradeCount(): void {
    this.checkDailyReset();
    this.dailyTradeCount++;
  }

  /**
   * Reset counter at midnight
   */
  private checkDailyReset(): void {
    const now = Date.now();
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const midnightMs = midnight.getTime();

    if (now > this.dailyTradeResetTime + 86400000 || now < midnightMs) {
      this.dailyTradeCount = 0;
      this.dailyTradeResetTime = midnightMs;
    }
  }

  /**
   * Get current trade count
   */
  getDailyTradeCount(): number {
    this.checkDailyReset();
    return this.dailyTradeCount;
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<ValidatorConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Get current config
   */
  getConfig(): ValidatorConfig {
    return { ...this.config };
  }
}
