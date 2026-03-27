/**
 * Feed Aggregator
 * Unified interface for multi-exchange WebSocket price feeds
 * Consolidates Binance, OKX, and Bybit streams into single data stream
 */

import { WebSocketMessage } from './websocket-client';
import { logger } from '../utils/logger';
import { BinanceWebSocketClient, BinanceOrderBook, BinanceTrade, BinanceTicker } from './binance-ws';
import { OKXWebSocketClient, OKXOrderBook, OKXTrade, OKXTicker } from './okx-ws';
import { BybitWebSocketClient, BybitOrderBook, BybitTrade, BybitTicker } from './bybit-ws';

export type ExchangeId = 'binance' | 'okx' | 'bybit';

export interface UnifiedOrderBook {
  exchange: ExchangeId;
  symbol: string;
  bids: { price: number; amount: number }[];
  asks: { price: number; amount: number }[];
  timestamp: number;
  latency: number;
}

export interface UnifiedTrade {
  exchange: ExchangeId;
  symbol: string;
  price: number;
  amount: number;
  side: 'buy' | 'sell';
  timestamp: number;
  tradeId?: string;
}

export interface UnifiedTicker {
  exchange: ExchangeId;
  symbol: string;
  last: number;
  bid: number;
  ask: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
}

export type FeedMessage =
  | { type: 'orderbook'; data: UnifiedOrderBook }
  | { type: 'trade'; data: UnifiedTrade }
  | { type: 'ticker'; data: UnifiedTicker };

export type FeedHandler = (msg: FeedMessage) => void;

export class FeedAggregator {
  private clients: Map<ExchangeId, BinanceWebSocketClient | OKXWebSocketClient | BybitWebSocketClient> =
    new Map();
  private handlers: Set<FeedHandler> = new Set();
  private connected = false;
  private latencies: Map<string, number[]> = new Map(); // exchange:symbol -> latency history

  constructor() {
    this.initClients();
  }

  private initClients(): void {
    this.clients.set('binance', new BinanceWebSocketClient());
    this.clients.set('okx', new OKXWebSocketClient());
    this.clients.set('bybit', new BybitWebSocketClient());
  }

  public onFeed(handler: FeedHandler): void {
    this.handlers.add(handler);
  }

  public offFeed(handler: FeedHandler): void {
    this.handlers.delete(handler);
  }

  public async connect(): Promise<void> {
    if (this.connected) {
      return;
    }

    logger.info('[FeedAggregator] Connecting to exchange WebSocket streams...');

    const connections = Array.from(this.clients.entries()).map(async ([exchange, client]) => {
      try {
        await client.connect();
        logger.info(`[FeedAggregator] ${exchange} connected`);
      } catch (error) {
        logger.error(`[FeedAggregator] ${exchange} connection failed:`, { error });
        throw error;
      }
    });

    await Promise.all(connections);
    this.connected = true;
    logger.info('[FeedAggregator] All exchanges connected');
  }

  public async disconnect(): Promise<void> {
    const disconnections = Array.from(this.clients.values()).map((client) => client.disconnect());
    await Promise.all(disconnections);
    this.connected = false;
    logger.info('[FeedAggregator] All exchanges disconnected');
  }

  public async subscribe(symbols: string[]): Promise<void> {
    if (!this.connected) {
      throw new Error('FeedAggregator not connected. Call connect() first.');
    }

    logger.info(`[FeedAggregator] Subscribing to ${symbols.length} symbols...`);

    const subscriptions = Array.from(this.clients.entries()).map(async ([exchange, client]) => {
      try {
        await client.subscribe(symbols);
        logger.info(`[FeedAggregator] ${exchange} subscribed to ${symbols.join(', ')}`);
      } catch (error) {
        logger.error(`[FeedAggregator] ${exchange} subscription failed:`, { error });
        throw error;
      }
    });

    await Promise.all(subscriptions);

    // Setup message handlers
    this.clients.forEach((client, exchange) => {
      client.onMessage((msg) => this.handleMessage(exchange as ExchangeId, msg));
    });
  }

  public async unsubscribe(symbols: string[]): Promise<void> {
    const unsubscriptions = Array.from(this.clients.entries()).map(async ([exchange, client]) => {
      await client.unsubscribe(symbols);
    });
    await Promise.all(unsubscriptions);
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getAverageLatency(exchange: ExchangeId, symbol: string): number {
    const key = `${exchange}:${symbol}`;
    const latencies = this.latencies.get(key);
    if (!latencies || latencies.length === 0) return 0;
    return latencies.reduce((a, b) => a + b, 0) / latencies.length;
  }

  private handleMessage(exchange: ExchangeId, msg: WebSocketMessage): void {
    const receiveTime = Date.now();
    const latency = receiveTime - msg.timestamp;

    // Track latency
    const key = `${exchange}:${msg.symbol}`;
    if (!this.latencies.has(key)) {
      this.latencies.set(key, []);
    }
    const history = this.latencies.get(key)!;
    history.push(latency);
    if (history.length > 100) {
      history.shift(); // Keep last 100 samples
    }

    switch (msg.type) {
      case 'orderbook':
        const orderBook = this.parseOrderBook(exchange, msg.data);
        if (orderBook) {
          this.notify({ type: 'orderbook', data: { ...orderBook, latency } });
        }
        break;

      case 'trade':
        const trade = this.parseTrade(exchange, msg.data);
        if (trade) {
          this.notify({ type: 'trade', data: { ...trade, timestamp: receiveTime } });
        }
        break;

      case 'ticker':
        const ticker = this.parseTicker(exchange, msg.data);
        if (ticker) {
          this.notify({ type: 'ticker', data: { ...ticker, timestamp: receiveTime } });
        }
        break;
    }
  }

  private parseOrderBook(
    exchange: ExchangeId,
    data: unknown
  ): UnifiedOrderBook | null {
    if (exchange === 'binance') {
      const binanceBook = data as BinanceOrderBook;
      return {
        exchange,
        symbol: '', // Symbol already in message context
        bids: binanceBook.bids.map(([price, amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
        })),
        asks: binanceBook.asks.map(([price, amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
        })),
        timestamp: Date.now(),
        latency: 0,
      };
    }

    if (exchange === 'okx') {
      const okxBook = data as OKXOrderBook;
      return {
        exchange,
        symbol: '',
        bids: okxBook.bids.map(([price, amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
        })),
        asks: okxBook.asks.map(([price, amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
        })),
        timestamp: Date.now(),
        latency: 0,
      };
    }

    if (exchange === 'bybit') {
      const bybitBook = data as BybitOrderBook;
      return {
        exchange,
        symbol: '',
        bids: bybitBook.bids.map(([price, amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
        })),
        asks: bybitBook.asks.map(([price, amount]) => ({
          price: parseFloat(price),
          amount: parseFloat(amount),
        })),
        timestamp: Date.now(),
        latency: 0,
      };
    }

    return null;
  }

  private parseTrade(exchange: ExchangeId, data: unknown): UnifiedTrade | null {
    if (exchange === 'binance') {
      const binanceTrade = data as BinanceTrade;
      return {
        exchange,
        symbol: binanceTrade.s,
        price: parseFloat(binanceTrade.p),
        amount: parseFloat(binanceTrade.q),
        side: binanceTrade.m ? 'sell' : 'buy',
        timestamp: binanceTrade.T,
        tradeId: String(binanceTrade.t),
      };
    }

    if (exchange === 'okx') {
      const okxTrade = data as OKXTrade;
      return {
        exchange,
        symbol: okxTrade.instId.replace('-', '/'),
        price: parseFloat(okxTrade.px),
        amount: parseFloat(okxTrade.sz),
        side: okxTrade.side,
        timestamp: parseInt(okxTrade.ts),
        tradeId: okxTrade.tradeId,
      };
    }

    if (exchange === 'bybit') {
      const bybitTrade = data as BybitTrade;
      return {
        exchange,
        symbol: bybitTrade.symbol,
        price: parseFloat(bybitTrade.price),
        amount: parseFloat(bybitTrade.size),
        side: bybitTrade.side.toLowerCase() as 'buy' | 'sell',
        timestamp: parseInt(bybitTrade.time),
        tradeId: bybitTrade.execId,
      };
    }

    return null;
  }

  private parseTicker(exchange: ExchangeId, data: unknown): UnifiedTicker | null {
    if (exchange === 'binance') {
      const binanceTicker = data as BinanceTicker;
      return {
        exchange,
        symbol: binanceTicker.s,
        last: parseFloat(binanceTicker.c),
        bid: 0,
        ask: 0,
        high24h: parseFloat(binanceTicker.h),
        low24h: parseFloat(binanceTicker.l),
        volume24h: parseFloat(binanceTicker.v),
        timestamp: binanceTicker.E,
      };
    }

    if (exchange === 'okx') {
      const okxTicker = data as OKXTicker;
      return {
        exchange,
        symbol: okxTicker.instId.replace('-', '/'),
        last: parseFloat(okxTicker.last),
        bid: parseFloat(okxTicker.bidPx),
        ask: parseFloat(okxTicker.askPx),
        high24h: parseFloat(okxTicker.high24h),
        low24h: parseFloat(okxTicker.low24h),
        volume24h: parseFloat(okxTicker.volUsd24h),
        timestamp: parseInt(okxTicker.ts),
      };
    }

    if (exchange === 'bybit') {
      const bybitTicker = data as BybitTicker;
      return {
        exchange,
        symbol: bybitTicker.symbol,
        last: parseFloat(bybitTicker.lastPrice),
        bid: 0,
        ask: 0,
        high24h: parseFloat(bybitTicker.highPrice24h),
        low24h: parseFloat(bybitTicker.lowPrice24h),
        volume24h: parseFloat(bybitTicker.volume24h),
        timestamp: Date.now(),
      };
    }

    return null;
  }

  private notify(msg: FeedMessage): void {
    this.handlers.forEach((handler) => handler(msg));
  }
}
