/**
 * Drawdown Monitor
 * Halts trading on max drawdown breach
 */

import { Redis } from 'ioredis';
import { getRedisClient, type RedisClientType } from '../redis';
import { logger } from '../utils/logger';

export interface DrawdownConfig {
  maxDailyDrawdown: number;
  maxTotalDrawdown: number;
  maxConsecutiveLoss: number;
  haltOnBreach: boolean;
}

export interface DrawdownMetrics {
  currentDrawdown: number;
  maxDrawdown: number;
  peakValue: number;
  currentValue: number;
  dailyPnl: number;
  dailyDrawdown: number;
  consecutiveLosses: number;
  isHalted: boolean;
}

export interface DrawdownAlert {
  type: 'daily' | 'total' | 'consecutive';
  threshold: number;
  current: number;
  triggeredAt: number;
  message: string;
}

export class DrawdownMonitor {
  private redis: RedisClientType;
  private config: DrawdownConfig;
  private peakValue: number = 0;

  constructor(
    redis?: RedisClientType,
    config?: Partial<DrawdownConfig>
  ) {
    this.redis = redis || getRedisClient();
    this.config = {
      maxDailyDrawdown: 0.05, // 5%
      maxTotalDrawdown: 0.15, // 15%
      maxConsecutiveLoss: 5,
      haltOnBreach: true,
      ...config,
    };
  }

  /**
   * Record trade result and update drawdown
   */
  async recordTrade(profit: number): Promise<DrawdownMetrics> {
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];

    // Get current state
    const state = await this.getState();

    // Update cumulative value
    const newValue = state.currentValue + profit;

    // Update peak if new value is higher
    if (newValue > state.peakValue) {
      state.peakValue = newValue;
    }

    // Calculate drawdown
    const drawdown = state.peakValue > 0
      ? (state.peakValue - newValue) / state.peakValue
      : 0;

    // Update daily P&L
    const dailyKey = `drawdown:daily:${today}`;
    const currentDaily = parseFloat(await this.redis.get(dailyKey) || '0');
    const newDaily = currentDaily + profit;
    await this.redis.set(dailyKey, newDaily.toString());

    // Update consecutive losses
    let consecutiveLosses = state.consecutiveLosses;
    if (profit < 0) {
      consecutiveLosses++;
    } else {
      consecutiveLosses = 0;
    }

    // Check for breaches
    const alerts: DrawdownAlert[] = [];

    // Daily drawdown check
    const dailyStart = parseFloat(await this.redis.get('drawdown:daily_start') || '0');
    const dailyDrawdown = dailyStart > 0 ? Math.abs(Math.min(0, newDaily)) / dailyStart : 0;

    if (dailyDrawdown >= this.config.maxDailyDrawdown) {
      alerts.push({
        type: 'daily',
        threshold: this.config.maxDailyDrawdown,
        current: dailyDrawdown,
        triggeredAt: now,
        message: `Daily drawdown ${(dailyDrawdown * 100).toFixed(2)}% exceeds ${(this.config.maxDailyDrawdown * 100).toFixed(2)}%`,
      });

      if (this.config.haltOnBreach) {
        await this.halt('Daily drawdown breach');
      }
    }

    // Total drawdown check
    if (drawdown >= this.config.maxTotalDrawdown) {
      alerts.push({
        type: 'total',
        threshold: this.config.maxTotalDrawdown,
        current: drawdown,
        triggeredAt: now,
        message: `Total drawdown ${(drawdown * 100).toFixed(2)}% exceeds ${(this.config.maxTotalDrawdown * 100).toFixed(2)}%`,
      });

      if (this.config.haltOnBreach) {
        await this.halt('Total drawdown breach');
      }
    }

    // Consecutive loss check
    if (consecutiveLosses >= this.config.maxConsecutiveLoss) {
      alerts.push({
        type: 'consecutive',
        threshold: this.config.maxConsecutiveLoss,
        current: consecutiveLosses,
        triggeredAt: now,
        message: `${consecutiveLosses} consecutive losses`,
      });

      if (this.config.haltOnBreach) {
        await this.halt('Consecutive loss limit');
      }
    }

    // Update state
    await this.updateState({
      currentValue: newValue,
      peakValue: state.peakValue,
      consecutiveLosses,
    });

    // Log alerts
    for (const alert of alerts) {
      logger.warn(`[DrawdownMonitor] ALERT: ${alert.message}`);
      await this.redis.lpush('drawdown:alerts', JSON.stringify(alert));
      await this.redis.ltrim('drawdown:alerts', 0, 99); // Keep last 100
    }

    return this.getMetrics();
  }

  /**
   * Get current metrics
   */
  async getMetrics(): Promise<DrawdownMetrics> {
    const state = await this.getState();
    const today = new Date().toISOString().split('T')[0];
    const dailyPnl = parseFloat(await this.redis.get(`drawdown:daily:${today}`) || '0');
    const dailyStart = parseFloat(await this.redis.get('drawdown:daily_start') || '0');
    const dailyDrawdown = dailyStart > 0 ? Math.abs(Math.min(0, dailyPnl)) / dailyStart : 0;

    const currentDrawdown = state.peakValue > 0
      ? (state.peakValue - state.currentValue) / state.peakValue
      : 0;

    const status = await this.redis.hgetall('drawdown:halt');
    const isHalted = status.state === 'HALTED';

    return {
      currentDrawdown,
      maxDrawdown: state.peakValue > 0 ? (state.peakValue - state.currentValue) / state.peakValue : 0,
      peakValue: state.peakValue,
      currentValue: state.currentValue,
      dailyPnl,
      dailyDrawdown,
      consecutiveLosses: state.consecutiveLosses,
      isHalted,
    };
  }

  /**
   * Check if trading is allowed
   */
  async canTrade(): Promise<boolean> {
    const status = await this.redis.hgetall('drawdown:halt');
    return status.state !== 'HALTED';
  }

  /**
   * Halt trading
   */
  private async halt(reason: string): Promise<void> {
    await this.redis.hset('drawdown:halt', {
      state: 'HALTED',
      reason,
      triggeredAt: Date.now().toString(),
    });

    logger.warn(`[DrawdownMonitor] HALTED: ${reason}`);
  }

  /**
   * Resume trading (manual reset)
   */
  async resume(): Promise<void> {
    await this.redis.hset('drawdown:halt', {
      state: 'ACTIVE',
      reason: '',
      triggeredAt: '',
    });

    // Reset daily start to current value
    const state = await this.getState();
    await this.redis.set('drawdown:daily_start', state.currentValue.toString());

    logger.info('[DrawdownMonitor] RESUMED');
  }

  /**
   * Initialize daily tracking (call at start of day)
   */
  async initializeDay(): Promise<void> {
    const state = await this.getState();
    const today = new Date().toISOString().split('T')[0];

    await this.redis.set('drawdown:daily_start', state.currentValue.toString());
    await this.redis.set(`drawdown:daily:${today}`, '0');
    await this.redis.del('drawdown:alerts');

    logger.info(`[DrawdownMonitor] Day initialized @ ${state.currentValue}`);
  }

  /**
   * Get state from Redis
   */
  private async getState(): Promise<{
    currentValue: number;
    peakValue: number;
    consecutiveLosses: number;
  }> {
    const data = await this.redis.hgetall('drawdown:state');

    return {
      currentValue: parseFloat(data.currentValue || '100'), // Start with 100
      peakValue: parseFloat(data.peakValue || '100'),
      consecutiveLosses: parseInt(data.consecutiveLosses || '0'),
    };
  }

  /**
   * Update state in Redis
   */
  private async updateState(state: {
    currentValue: number;
    peakValue: number;
    consecutiveLosses: number;
  }): Promise<void> {
    await this.redis.hset('drawdown:state', {
      currentValue: state.currentValue.toString(),
      peakValue: state.peakValue.toString(),
      consecutiveLosses: state.consecutiveLosses.toString(),
    });
  }

  /**
   * Get alert history
   */
  async getAlerts(): Promise<DrawdownAlert[]> {
    const alerts = await this.redis.lrange('drawdown:alerts', 0, -1);
    return alerts.map((a) => JSON.parse(a));
  }

  /**
   * Get historical daily P&L
   */
  async getDailyHistory(days: number = 30): Promise<{ date: string; pnl: number }[]> {
    const history: { date: string; pnl: number }[] = [];
    const today = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      const pnl = parseFloat(await this.redis.get(`drawdown:daily:${dateStr}`) || '0');
      history.push({ date: dateStr, pnl });
    }

    return history;
  }
}
