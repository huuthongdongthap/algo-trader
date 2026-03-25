// Risk management: Kelly Criterion, drawdown limits, position sizing
import type { RiskLimits, Position, PnlSnapshot } from './types.js';
import { logger } from './logger.js';

/**
 * Kelly Criterion: optimal fraction of capital to risk
 * f* = (b*p - q) / b
 * b = avg win / avg loss (odds ratio)
 * p = win probability
 * q = 1 - p
 */
export function kellyFraction(winRate: number, avgWin: number, avgLoss: number): number {
  if (avgLoss === 0 || winRate <= 0 || winRate >= 1) return 0;
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  // Cap at 25% (half-Kelly is safer in practice)
  return Math.max(0, Math.min(kelly * 0.5, 0.25));
}

/** Check if drawdown exceeds the configured limit */
export function isDrawdownExceeded(currentEquity: string, peakEquity: string, maxDrawdown: number): boolean {
  const current = parseFloat(currentEquity);
  const peak = parseFloat(peakEquity);
  if (peak <= 0) return false;
  const drawdown = (peak - current) / peak;
  return drawdown >= maxDrawdown;
}

/** Calculate position size based on capital, risk percent, and stop-loss */
export function calculatePositionSize(
  capital: string,
  riskPercent: number,
  stopLossPercent: number,
): string {
  if (stopLossPercent <= 0) return '0';
  const cap = parseFloat(capital);
  const riskAmount = cap * riskPercent;
  const positionSize = riskAmount / stopLossPercent;
  return positionSize.toFixed(2);
}

/** Calculate stop-loss price for a given entry */
export function calculateStopLoss(entryPrice: string, side: 'long' | 'short', stopLossPercent: number): string {
  const entry = parseFloat(entryPrice);
  if (side === 'long') {
    return (entry * (1 - stopLossPercent)).toFixed(6);
  }
  return (entry * (1 + stopLossPercent)).toFixed(6);
}

export class RiskManager {
  private limits: RiskLimits;
  private peakEquity: number = 0;

  // Daily loss tracking
  private dailyStartCapital: number = 0;
  private dailyDate: string = '';
  private dailyLossLimit: number = 0.05; // 5% of capital

  // Consecutive loss circuit breaker
  private consecutiveLosses: number = 0;
  private maxConsecutiveLosses: number = 3;
  private circuitBreakerTripped: boolean = false;
  private circuitBreakerResetAt: number = 0;
  private circuitBreakerCooldownMs: number = 60 * 60 * 1000; // 1 hour

  constructor(limits: RiskLimits) {
    this.limits = limits;
  }

  /**
   * Unified pre-trade check — call before EVERY execution.
   * Combines position validation, daily loss limit, and circuit breaker.
   */
  checkTrade(
    capital: string,
    currentPositions: Position[],
    proposedSize: string,
  ): { allowed: boolean; reason: string } {
    // Circuit breaker check
    if (this.circuitBreakerTripped) {
      if (Date.now() < this.circuitBreakerResetAt) {
        return { allowed: false, reason: `Circuit breaker: ${this.maxConsecutiveLosses} consecutive losses. Cooldown until ${new Date(this.circuitBreakerResetAt).toISOString()}` };
      }
      this.circuitBreakerTripped = false;
      this.consecutiveLosses = 0;
      logger.info('Circuit breaker reset after cooldown', 'risk-manager');
    }

    // Daily loss limit check
    const dailyCheck = this.checkDailyLossLimit(capital);
    if (!dailyCheck.allowed) return dailyCheck;

    // Position validation
    const posCheck = this.canOpenPosition(capital, currentPositions, proposedSize);
    return { allowed: posCheck.allowed, reason: posCheck.reason ?? 'ok' };
  }

  /** Record a trade result for circuit breaker tracking */
  recordTradeResult(isWin: boolean): void {
    if (isWin) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.maxConsecutiveLosses) {
        this.circuitBreakerTripped = true;
        this.circuitBreakerResetAt = Date.now() + this.circuitBreakerCooldownMs;
        logger.warn(`Circuit breaker tripped: ${this.consecutiveLosses} consecutive losses`, 'risk-manager');
      }
    }
  }

  /** Check daily loss limit (5% of starting capital) */
  private checkDailyLossLimit(capital: string): { allowed: boolean; reason: string } {
    const today = new Date().toISOString().slice(0, 10);
    const currentCapital = parseFloat(capital);

    if (this.dailyDate !== today) {
      this.dailyDate = today;
      this.dailyStartCapital = currentCapital;
    }

    if (this.dailyStartCapital > 0) {
      const dailyLoss = (this.dailyStartCapital - currentCapital) / this.dailyStartCapital;
      if (dailyLoss >= this.dailyLossLimit) {
        return { allowed: false, reason: `Daily loss limit (${(this.dailyLossLimit * 100).toFixed(1)}%) exceeded: lost ${(dailyLoss * 100).toFixed(1)}% today` };
      }
    }

    return { allowed: true, reason: 'ok' };
  }

  /** Check if circuit breaker is currently active */
  isCircuitBreakerActive(): boolean {
    if (!this.circuitBreakerTripped) return false;
    if (Date.now() >= this.circuitBreakerResetAt) {
      this.circuitBreakerTripped = false;
      this.consecutiveLosses = 0;
      return false;
    }
    return true;
  }

  /** Manually reset circuit breaker (for /resume command) */
  resetCircuitBreaker(): void {
    this.circuitBreakerTripped = false;
    this.consecutiveLosses = 0;
    logger.info('Circuit breaker manually reset', 'risk-manager');
  }

  /** Validate whether a new position can be opened */
  canOpenPosition(
    capital: string,
    currentPositions: Position[],
    proposedSize: string,
  ): { allowed: boolean; reason?: string } {
    // Check max open positions
    if (currentPositions.length >= this.limits.maxOpenPositions) {
      return { allowed: false, reason: `Max open positions (${this.limits.maxOpenPositions}) reached` };
    }
    // Check position size limit
    if (parseFloat(proposedSize) > parseFloat(this.limits.maxPositionSize)) {
      return { allowed: false, reason: `Position size exceeds max (${this.limits.maxPositionSize})` };
    }
    // Check 10% of capital cap
    const capitalFloat = parseFloat(capital);
    if (capitalFloat > 0 && parseFloat(proposedSize) > capitalFloat * 0.10) {
      return { allowed: false, reason: `Position exceeds 10% of capital ($${(capitalFloat * 0.10).toFixed(2)})` };
    }
    // Check drawdown
    const currentEquity = capitalFloat;
    if (this.peakEquity > 0 && isDrawdownExceeded(capital, String(this.peakEquity), this.limits.maxDrawdown)) {
      return { allowed: false, reason: `Drawdown limit (${this.limits.maxDrawdown * 100}%) exceeded` };
    }
    // Update peak
    if (currentEquity > this.peakEquity) {
      this.peakEquity = currentEquity;
    }
    return { allowed: true };
  }

  /** Get recommended position size using Kelly Criterion */
  getRecommendedSize(capital: string, winRate: number, avgWin: number, avgLoss: number): string {
    const fraction = kellyFraction(winRate, avgWin, avgLoss);
    const size = parseFloat(capital) * fraction;
    const capped = Math.min(size, parseFloat(this.limits.maxPositionSize));
    logger.debug('Kelly sizing', 'risk-manager', { fraction, size: capped, winRate });
    return capped.toFixed(2);
  }

  /** Create PnL snapshot for tracking */
  createSnapshot(equity: string, realizedPnl: string, unrealizedPnl: string, trades: number, wins: number): PnlSnapshot {
    const eq = parseFloat(equity);
    if (eq > this.peakEquity) this.peakEquity = eq;
    const drawdown = this.peakEquity > 0 ? (this.peakEquity - eq) / this.peakEquity : 0;
    return {
      timestamp: Date.now(),
      equity,
      peakEquity: String(this.peakEquity),
      drawdown,
      realizedPnl,
      unrealizedPnl,
      tradeCount: trades,
      winCount: wins,
    };
  }
}
