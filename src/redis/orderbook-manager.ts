/**
 * Orderbook Manager
 * Redis Sorted Sets for L2 orderbook storage
 *
 * Data Structure:
 * - ZSET orderbook:{exchange}:{symbol}:bids (score: price, member: "price:amount")
 * - ZSET orderbook:{exchange}:{symbol}:asks (score: -price for desc, member: "price:amount")
 */

import { getRedisClient } from './index';

export interface OrderBookLevel {
  price: number;
  amount: number;
}

export interface OrderBook {
  exchange: string;
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
}

export class OrderbookManager {
  private redis: ReturnType<typeof getRedisClient>;

  constructor() {
    this.redis = getRedisClient();
  }

  private getBidsKey(exchange: string, symbol: string): string {
    return `orderbook:${exchange}:${symbol}:bids`;
  }

  private getAsksKey(exchange: string, symbol: string): string {
    return `orderbook:${exchange}:${symbol}:asks`;
  }

  /**
   * Update orderbook with delta changes
   * Bids: sorted by price descending (multiply score by -1)
   * Asks: sorted by price ascending
   */
  async updateOrderbook(
    exchange: string,
    symbol: string,
    bids: OrderBookLevel[],
    asks: OrderBookLevel[]
  ): Promise<void> {
    const bidsKey = this.getBidsKey(exchange, symbol);
    const asksKey = this.getAsksKey(exchange, symbol);

    const bidMembers = bids.map((level) => ({
      score: -level.price, // Negative for descending sort
      value: `${level.price}:${level.amount}`,
    }));

    const askMembers = asks.map((level) => ({
      score: level.price,
      value: `${level.price}:${level.amount}`,
    }));

    const pipeline = this.redis.pipeline();

    // Clear and set new state (snapshot approach)
    pipeline.del(bidsKey);
    pipeline.del(asksKey);

    if (bidMembers.length > 0) {
      pipeline.zadd(bidsKey, ...bidMembers.flatMap((m) => [m.score, m.value]));
    }
    if (askMembers.length > 0) {
      pipeline.zadd(asksKey, ...askMembers.flatMap((m) => [m.score, m.value]));
    }

    // Set TTL 1 hour (auto-cleanup stale data)
    pipeline.expire(bidsKey, 3600);
    pipeline.expire(asksKey, 3600);

    await pipeline.exec();
  }

  /**
   * Get best bid (highest price) - O(1)
   */
  async getBestBid(exchange: string, symbol: string): Promise<OrderBookLevel | null> {
    const key = this.getBidsKey(exchange, symbol);
    const result = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
    if (!result || result.length === 0) return null;

    const [member, score] = result;
    const [price, amount] = member.split(':').map(parseFloat);
    return { price, amount };
  }

  /**
   * Get best ask (lowest price) - O(1)
   */
  async getBestAsk(exchange: string, symbol: string): Promise<OrderBookLevel | null> {
    const key = this.getAsksKey(exchange, symbol);
    const result = await this.redis.zrange(key, 0, 0, 'WITHSCORES');
    if (!result || result.length === 0) return null;

    const [member, score] = result;
    const [price, amount] = member.split(':').map(parseFloat);
    return { price, amount };
  }

  /**
   * Get top N levels - O(log N)
   */
  async getTopLevels(
    exchange: string,
    symbol: string,
    levels = 10
  ): Promise<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }> {
    const bidsKey = this.getBidsKey(exchange, symbol);
    const asksKey = this.getAsksKey(exchange, symbol);

    const [bidsRaw, asksRaw] = await Promise.all([
      this.redis.zrange(bidsKey, 0, levels - 1, 'WITHSCORES'),
      this.redis.zrange(asksKey, 0, levels - 1, 'WITHSCORES'),
    ]);

    const parseLevels = (raw: string[]): OrderBookLevel[] => {
      const result: OrderBookLevel[] = [];
      for (let i = 0; i < raw.length; i += 2) {
        const [price, amount] = raw[i].split(':').map(parseFloat);
        result.push({ price, amount });
      }
      return result;
    };

    return {
      bids: parseLevels(bidsRaw || []),
      asks: parseLevels(asksRaw || []),
    };
  }

  /**
   * Get orderbook depth (total volume at each price level)
   */
  async getDepth(exchange: string, symbol: string, levels = 10): Promise<{
    bidDepth: number;
    askDepth: number;
  }> {
    const { bids, asks } = await this.getTopLevels(exchange, symbol, levels);

    const bidDepth = bids.reduce((sum, level) => sum + level.amount, 0);
    const askDepth = asks.reduce((sum, level) => sum + level.amount, 0);

    return { bidDepth, askDepth };
  }

  /**
   * Clear orderbook for a symbol
   */
  async clear(exchange: string, symbol: string): Promise<void> {
    const bidsKey = this.getBidsKey(exchange, symbol);
    const asksKey = this.getAsksKey(exchange, symbol);
    await this.redis.del([bidsKey, asksKey]);
  }
}
