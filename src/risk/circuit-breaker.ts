/**
 * Circuit Breaker
 * Halts trading on anomalies (loss streak, latency spike, volatility, drawdown)
 *
 * Week 3-4: Risk Management - Enhanced with 5% daily drawdown trigger
 */

import { Redis } from 'ioredis';
import { getRedisClient, type RedisClientType } from '../redis';
import { logger } from '../utils/logger';
import { DrawdownMonitor } from './drawdown-monitor';

export interface CircuitBreakerConfig {
  maxLossStreak: number;
  maxLatencyMs: number;
  maxVolatilityPercent: number;
  cooldownMs: number;
  maxDailyDrawdown: number; // 5% default
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitStatus {
  state: CircuitState;
  reason?: string;
  triggeredAt?: number;
  cooldownRemaining?: number;
}

export class CircuitBreaker {
  private redis: RedisClientType;
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'CLOSED';
  private triggeredAt?: number;
  private drawdownMonitor?: DrawdownMonitor;

  constructor(
    redis?: RedisClientType,
    config?: Partial<CircuitBreakerConfig>,
    drawdownMonitor?: DrawdownMonitor
  ) {
    this.redis = redis || getRedisClient();
    this.config = {
      maxLossStreak: 3,
      maxLatencyMs: 1000,
      maxVolatilityPercent: 5.0,
      cooldownMs: 300000, // 5 minutes
      maxDailyDrawdown: 0.05, // 5% daily drawdown
      ...config,
    };
    this.drawdownMonitor = drawdownMonitor;
  }

  /**
   * Get circuit breaker status
   */
  async getStatus(): Promise<CircuitStatus> {
    const status = await this.redis.hgetall('circuit_breaker:status');

    if (status.state === 'OPEN' && status.triggeredAt) {
      const elapsed = Date.now() - parseInt(status.triggeredAt);
      const remaining = Math.max(0, this.config.cooldownMs - elapsed);

      if (remaining <= 0) {
        await this.setHalfOpen();
        return {
          state: 'HALF_OPEN',
          reason: status.reason,
          triggeredAt: parseInt(status.triggeredAt),
          cooldownRemaining: 0,
        };
      }

      return {
        state: 'OPEN',
        reason: status.reason,
        triggeredAt: parseInt(status.triggeredAt),
        cooldownRemaining: remaining,
      };
    }

    return {
      state: status.state as CircuitState || 'CLOSED',
      reason: status.reason,
      triggeredAt: status.triggeredAt ? parseInt(status.triggeredAt) : undefined,
    };
  }

  /**
   * Check if trading is allowed
   */
  async canTrade(): Promise<boolean> {
    const status = await this.getStatus();
    return status.state !== 'OPEN';
  }

  /**
   * Record loss - increment loss streak
   */
  async recordLoss(): Promise<void> {
    const key = 'circuit_breaker:loss_streak';
    const current = parseInt(await this.redis.get(key) || '0');
    const newStreak = current + 1;

    await this.redis.set(key, newStreak.toString());

    if (newStreak >= this.config.maxLossStreak) {
      await this.trip('Loss streak', `${newStreak} consecutive losses`);
    }
  }

  /**
   * Record win - reset loss streak
   */
  async recordWin(): Promise<void> {
    await this.redis.del('circuit_breaker:loss_streak');
  }

  /**
   * Check latency - trip if exceeds threshold
   */
  async checkLatency(latencyMs: number): Promise<boolean> {
    if (latencyMs > this.config.maxLatencyMs) {
      await this.trip('Latency spike', `${latencyMs}ms exceeds ${this.config.maxLatencyMs}ms`);
      return false;
    }
    return true;
  }

  /**
   * Check volatility - trip if exceeds threshold
   */
  async checkVolatility(volatilityPercent: number): Promise<boolean> {
    if (volatilityPercent > this.config.maxVolatilityPercent) {
      await this.trip('High volatility', `${volatilityPercent}% exceeds ${this.config.maxVolatilityPercent}%`);
      return false;
    }
    return true;
  }

  /**
   * Trip circuit breaker
   */
  private async trip(reason: string, details?: string): Promise<void> {
    this.state = 'OPEN';
    this.triggeredAt = Date.now();

    await this.redis.hset('circuit_breaker:status', {
      state: 'OPEN',
      reason: `${reason}: ${details || ''}`.trim(),
      triggeredAt: this.triggeredAt.toString(),
    });

    logger.warn(`[CircuitBreaker] TRIPPED: ${reason} - ${details}`);
  }

  /**
   * Set circuit to half-open (after cooldown)
   */
  private async setHalfOpen(): Promise<void> {
    this.state = 'HALF_OPEN';
    await this.redis.hset('circuit_breaker:status', 'state', 'HALF_OPEN');
  }

  /**
   * Reset circuit breaker to closed
   */
  async reset(): Promise<void> {
    this.state = 'CLOSED';
    this.triggeredAt = undefined;

    await this.redis.hset('circuit_breaker:status', {
      state: 'CLOSED',
      reason: '',
      triggeredAt: '',
    });

    await this.redis.del('circuit_breaker:loss_streak');

    logger.info('[CircuitBreaker] RESET');
  }

  /**
   * Manual halt - force open circuit
   */
  async halt(reason: string): Promise<void> {
    await this.trip('Manual halt', reason);
  }

  /**
   * Check daily drawdown - trip if exceeds 5%
   * Week 3-4: Auto-pause on 5% daily drawdown
   */
  async checkDailyDrawdown(): Promise<boolean> {
    if (!this.drawdownMonitor) {
      return true;
    }

    const metrics = await this.drawdownMonitor.getMetrics();
    if (metrics.dailyDrawdown >= this.config.maxDailyDrawdown) {
      await this.trip(
        'Daily drawdown breach',
        `${(metrics.dailyDrawdown * 100).toFixed(2)}% exceeds ${(this.config.maxDailyDrawdown * 100).toFixed(2)}%`
      );
      return false;
    }
    return true;
  }
}
