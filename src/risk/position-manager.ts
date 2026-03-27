/**
 * Position Manager
 * Tracks exposure per symbol/exchange, enforces limits
 */

import { Redis } from 'ioredis';
import { getRedisClient, type RedisClientType } from '../redis';
import { logger } from '../utils/logger';

export interface PositionConfig {
  maxPositionPerSymbol: number;
  maxPositionPerExchange: number;
  maxTotalExposure: number;
  maxLongExposure: number;
  maxShortExposure: number;
}

export interface Position {
  symbol: string;
  exchange: string;
  side: 'long' | 'short';
  amount: number;
  entryPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  openedAt: number;
}

export interface ExposureSummary {
  totalLong: number;
  totalShort: number;
  netExposure: number;
  perSymbol: Map<string, number>;
  perExchange: Map<string, number>;
}

export interface PositionValidation {
  valid: boolean;
  reason?: string;
  currentExposure: number;
  newExposure: number;
}

export class PositionManager {
  private redis: RedisClientType;
  private config: PositionConfig;

  constructor(
    redis?: RedisClientType,
    config?: Partial<PositionConfig>
  ) {
    this.redis = redis || getRedisClient();
    this.config = {
      maxPositionPerSymbol: 1.0, // BTC
      maxPositionPerExchange: 0.5,
      maxTotalExposure: 2.0,
      maxLongExposure: 1.5,
      maxShortExposure: 1.0,
      ...config,
    };
  }

  /**
   * Get current position for symbol/exchange
   */
  async getPosition(symbol: string, exchange: string): Promise<Position | null> {
    const key = `position:${symbol}:${exchange}`;
    const data = await this.redis.hgetall(key);

    if (!data || !data.symbol) return null;

    return {
      symbol: data.symbol,
      exchange: data.exchange,
      side: data.side as 'long' | 'short',
      amount: parseFloat(data.amount),
      entryPrice: parseFloat(data.entryPrice),
      currentValue: parseFloat(data.currentValue),
      unrealizedPnl: parseFloat(data.unrealizedPnl),
      openedAt: parseInt(data.openedAt),
    };
  }

  /**
   * Open new position
   */
  async openPosition(
    symbol: string,
    exchange: string,
    side: 'long' | 'short',
    amount: number,
    price: number
  ): Promise<boolean> {
    const validation = await this.validatePosition(symbol, exchange, side, amount);
    if (!validation.valid) {
      logger.warn(`[PositionManager] Rejected: ${validation.reason}`);
      return false;
    }

    const key = `position:${symbol}:${exchange}`;
    const now = Date.now();

    await this.redis.hset(key, {
      symbol,
      exchange,
      side,
      amount: amount.toString(),
      entryPrice: price.toString(),
      currentValue: (amount * price).toString(),
      unrealizedPnl: '0',
      openedAt: now.toString(),
    });

    await this.updateExposureCache();

    logger.info(`[PositionManager] Opened ${side} ${amount} ${symbol} @ ${price} on ${exchange}`);
    return true;
  }

  /**
   * Close position
   */
  async closePosition(symbol: string, exchange: string, exitPrice: number): Promise<number> {
    const position = await this.getPosition(symbol, exchange);
    if (!position) return 0;

    const pnl = position.side === 'long'
      ? (exitPrice - position.entryPrice) * position.amount
      : (position.entryPrice - exitPrice) * position.amount;

    await this.redis.del(`position:${symbol}:${exchange}`);
    await this.updateExposureCache();

    logger.info(`[PositionManager] Closed ${position.side} ${symbol} @ ${exitPrice}, PnL: ${pnl}`);
    return pnl;
  }

  /**
   * Update position value (mark to market)
   */
  async markToMarket(symbol: string, exchange: string, currentPrice: number): Promise<void> {
    const position = await this.getPosition(symbol, exchange);
    if (!position) return;

    const currentValue = position.amount * currentPrice;
    const unrealizedPnl = position.side === 'long'
      ? (currentPrice - position.entryPrice) * position.amount
      : (position.entryPrice - currentPrice) * position.amount;

    await this.redis.hset(`position:${symbol}:${exchange}`, {
      currentValue: currentValue.toString(),
      unrealizedPnl: unrealizedPnl.toString(),
    });
  }

  /**
   * Validate position against limits
   */
  async validatePosition(
    symbol: string,
    exchange: string,
    side: 'long' | 'short',
    amount: number
  ): Promise<PositionValidation> {
    const summary = await this.getExposureSummary();
    const positionValue = amount; // Simplified: amount in base currency

    // Check per-symbol limit
    const currentSymbolExposure = summary.perSymbol.get(symbol) || 0;
    if (currentSymbolExposure + positionValue > this.config.maxPositionPerSymbol) {
      return {
        valid: false,
        reason: `Symbol limit exceeded: ${symbol}`,
        currentExposure: currentSymbolExposure,
        newExposure: currentSymbolExposure + positionValue,
      };
    }

    // Check per-exchange limit
    const currentExchangeExposure = summary.perExchange.get(exchange) || 0;
    if (currentExchangeExposure + positionValue > this.config.maxPositionPerExchange) {
      return {
        valid: false,
        reason: `Exchange limit exceeded: ${exchange}`,
        currentExposure: currentExchangeExposure,
        newExposure: currentExchangeExposure + positionValue,
      };
    }

    // Check total exposure
    if (summary.netExposure + positionValue > this.config.maxTotalExposure) {
      return {
        valid: false,
        reason: 'Total exposure limit exceeded',
        currentExposure: summary.netExposure,
        newExposure: summary.netExposure + positionValue,
      };
    }

    // Check long/short limits
    if (side === 'long' && summary.totalLong + positionValue > this.config.maxLongExposure) {
      return {
        valid: false,
        reason: 'Long exposure limit exceeded',
        currentExposure: summary.totalLong,
        newExposure: summary.totalLong + positionValue,
      };
    }

    if (side === 'short' && summary.totalShort + positionValue > this.config.maxShortExposure) {
      return {
        valid: false,
        reason: 'Short exposure limit exceeded',
        currentExposure: summary.totalShort,
        newExposure: summary.totalShort + positionValue,
      };
    }

    return {
      valid: true,
      currentExposure: summary.netExposure,
      newExposure: summary.netExposure + positionValue,
    };
  }

  /**
   * Get exposure summary
   */
  async getExposureSummary(): Promise<ExposureSummary> {
    const summary: ExposureSummary = {
      totalLong: 0,
      totalShort: 0,
      netExposure: 0,
      perSymbol: new Map(),
      perExchange: new Map(),
    };

    const keys = await this.redis.keys('position:*');
    for (const key of keys) {
      const data = await this.redis.hgetall(key);
      if (!data || !data.amount) continue;

      const amount = parseFloat(data.amount);
      const side = data.side as 'long' | 'short';

      if (side === 'long') {
        summary.totalLong += amount;
      } else {
        summary.totalShort += amount;
      }

      // Per symbol
      const symbol = data.symbol;
      summary.perSymbol.set(symbol, (summary.perSymbol.get(symbol) || 0) + amount);

      // Per exchange
      const exchange = data.exchange;
      summary.perExchange.set(exchange, (summary.perExchange.get(exchange) || 0) + amount);
    }

    summary.netExposure = summary.totalLong - summary.totalShort;
    return summary;
  }

  /**
   * Update exposure cache in Redis
   */
  private async updateExposureCache(): Promise<void> {
    const summary = await this.getExposureSummary();

    await this.redis.hset('exposure:cache', {
      totalLong: summary.totalLong.toString(),
      totalShort: summary.totalShort.toString(),
      netExposure: summary.netExposure.toString(),
    });
  }

  /**
   * Get all open positions
   */
  async getAllPositions(): Promise<Position[]> {
    const keys = await this.redis.keys('position:*');
    const positions: Position[] = [];

    for (const key of keys) {
      const data = await this.redis.hgetall(key);
      if (data && data.symbol) {
        positions.push({
          symbol: data.symbol,
          exchange: data.exchange,
          side: data.side as 'long' | 'short',
          amount: parseFloat(data.amount),
          entryPrice: parseFloat(data.entryPrice),
          currentValue: parseFloat(data.currentValue),
          unrealizedPnl: parseFloat(data.unrealizedPnl),
          openedAt: parseInt(data.openedAt),
        });
      }
    }

    return positions;
  }

  /**
   * Close all positions (emergency)
   */
  async closeAllPositions(exitPrices: Map<string, number>): Promise<number> {
    const positions = await this.getAllPositions();
    let totalPnl = 0;

    for (const position of positions) {
      const key = `${position.symbol}:${position.exchange}`;
      const exitPrice = exitPrices.get(key) || position.entryPrice;
      const pnl = await this.closePosition(position.symbol, position.exchange, exitPrice);
      totalPnl += pnl;
    }

    return totalPnl;
  }
}
