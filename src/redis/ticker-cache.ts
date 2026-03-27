/**
 * Ticker Cache
 * Redis Hashes for real-time ticker storage
 *
 * Data Structure:
 * - HASH ticker:{exchange}:{symbol}
 *   Fields: last, bid, ask, high24h, low24h, volume24h, timestamp
 */

import { getRedisClient } from './index';

export interface Ticker {
  last: number;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

export class TickerCache {
  private redis: ReturnType<typeof getRedisClient>;

  constructor() {
    this.redis = getRedisClient();
  }

  private getKey(exchange: string, symbol: string): string {
    return `ticker:${exchange}:${symbol}`;
  }

  /**
   * Update ticker for a symbol - O(1)
   */
  async setTicker(
    exchange: string,
    symbol: string,
    ticker: Ticker
  ): Promise<void> {
    const key = this.getKey(exchange, symbol);
    const data = {
      last: ticker.last.toString(),
      bid: ticker.bid.toString(),
      ask: ticker.ask.toString(),
      high24h: ticker.high24h.toString(),
      low24h: ticker.low24h.toString(),
      volume24h: ticker.volume24h.toString(),
      timestamp: ticker.timestamp.toString(),
    };

    const pipeline = this.redis.pipeline();
    pipeline.hset(key, data);
    pipeline.expire(key, 3600); // 1 hour TTL
    await pipeline.exec();
  }

  /**
   * Get ticker for a symbol - O(1)
   */
  async getTicker(exchange: string, symbol: string): Promise<Ticker | null> {
    const key = this.getKey(exchange, symbol);
    const data = await this.redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) return null;

    return {
      last: parseFloat(data.last) || 0,
      bid: parseFloat(data.bid) || 0,
      ask: parseFloat(data.ask) || 0,
      high24h: parseFloat(data.high24h) || 0,
      low24h: parseFloat(data.low24h) || 0,
      volume24h: parseFloat(data.volume24h) || 0,
      timestamp: parseInt(data.timestamp) || 0,
    };
  }

  /**
   * Get tickers for multiple symbols - O(N)
   */
  async getTickers(exchange: string, symbols: string[]): Promise<Map<string, Ticker>> {
    const results = new Map<string, Ticker>();

    for (const symbol of symbols) {
      const key = this.getKey(exchange, symbol);
      const data = await this.redis.hgetall(key);

      if (data && Object.keys(data).length > 0) {
        results.set(symbol, {
          last: parseFloat(data.last) || 0,
          bid: parseFloat(data.bid) || 0,
          ask: parseFloat(data.ask) || 0,
          high24h: parseFloat(data.high24h) || 0,
          low24h: parseFloat(data.low24h) || 0,
          volume24h: parseFloat(data.volume24h) || 0,
          timestamp: parseInt(data.timestamp) || 0,
        });
      }
    }

    return results;
  }

  /**
   * Get best bid across multiple exchanges - O(N)
   */
  async getBestBidAcrossExchanges(symbols: string[], exchanges: string[]): Promise<
    Map<string, { exchange: string; bid: number }>
  > {
    const bestBids = new Map<string, { exchange: string; bid: number }>();

    for (const symbol of symbols) {
      let bestBid = 0;
      let bestExchange = '';

      for (const exchange of exchanges) {
        const ticker = await this.getTicker(exchange, symbol);
        if (ticker && ticker.bid > bestBid) {
          bestBid = ticker.bid;
          bestExchange = exchange;
        }
      }

      if (bestExchange) {
        bestBids.set(symbol, { exchange: bestExchange, bid: bestBid });
      }
    }

    return bestBids;
  }

  /**
   * Clear ticker cache for a symbol
   */
  async clear(exchange: string, symbol: string): Promise<void> {
    const key = this.getKey(exchange, symbol);
    await this.redis.del(key);
  }
}
