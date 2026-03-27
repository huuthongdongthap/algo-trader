/**
 * Binance WebSocket Client
 * WebSocket streams for orderbook, trades, and ticker data
 * Docs: https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams
 */

import { BaseWebSocketClient, WebSocketMessage, WebSocketConfig } from './websocket-client';

export interface BinanceOrderBook {
  lastUpdateId: number;
  bids: [string, string][]; // [price, quantity]
  asks: [string, string][];
}

export interface BinanceTrade {
  e: string; // event type
  E: number; // event time
  s: string; // symbol
  t: number; // trade id
  p: string; // price
  q: string; // quantity
  b: number; // buyer order id
  a: number; // seller order id
  T: number; // trade time
  m: boolean; // is buyer maker
}

export interface BinanceTicker {
  e: string; // event type
  E: number; // event time
  s: string; // symbol
  p: string; // price change
  P: string; // price change percent
  c: string; // last price
  o: string; // open price
  h: string; // high price
  l: string; // low price
  v: string; // volume
  q: string; // quote volume
}

export class BinanceWebSocketClient extends BaseWebSocketClient {
  private subscribedSymbols = new Set<string>();

  constructor() {
    super({
      url: 'wss://stream.binance.com:9443/ws',
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 30000,
    });
  }

  async connect(): Promise<void> {
    await this.connectWebSocket();
  }

  async disconnect(): Promise<void> {
    await this.unsubscribe(Array.from(this.subscribedSymbols));
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
  }

  async subscribe(symbols: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const streams: string[] = [];
    symbols.forEach((symbol) => {
      const binanceSymbol = symbol.replace('/', '').toLowerCase();
      streams.push(
        `${binanceSymbol}@depth10@100ms`, // Orderbook L2 10 levels
        `${binanceSymbol}@trade`, // Trades
        `${binanceSymbol}@ticker` // 24h ticker
      );
      this.subscribedSymbols.add(symbol);
    });

    const subscribeMessage = {
      method: 'SUBSCRIBE',
      params: streams,
      id: Date.now(),
    };

    this.sendMessage(subscribeMessage);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const streams: string[] = [];
    symbols.forEach((symbol) => {
      const binanceSymbol = symbol.replace('/', '').toLowerCase();
      streams.push(
        `${binanceSymbol}@depth10@100ms`,
        `${binanceSymbol}@trade`,
        `${binanceSymbol}@ticker`
      );
      this.subscribedSymbols.delete(symbol);
    });

    const unsubscribeMessage = {
      method: 'UNSUBSCRIBE',
      params: streams,
      id: Date.now(),
    };

    this.sendMessage(unsubscribeMessage);
  }

  protected handleMessage(data: unknown): WebSocketMessage | null {
    const msg = data as Record<string, unknown>;

    // Handle subscription response
    if (msg.result === null && msg.id) {
      return null;
    }

    const eventType = msg.e as string | undefined;
    const symbol = msg.s as string | undefined;

    if (!eventType || !symbol) {
      return null;
    }

    const normalizedSymbol = symbol.match(/^[A-Z]+\/[A-Z]+$/)
      ? symbol
      : this.normalizeSymbol(symbol);

    switch (eventType) {
      case 'depthUpdate':
        return {
          type: 'orderbook',
          exchange: 'binance',
          symbol: normalizedSymbol,
          data: this.parseOrderBook(msg),
          timestamp: msg.E as number,
        };

      case 'trade':
        return {
          type: 'trade',
          exchange: 'binance',
          symbol: normalizedSymbol,
          data: this.parseTrade(msg),
          timestamp: msg.E as number,
        };

      case '24hrTicker':
        return {
          type: 'ticker',
          exchange: 'binance',
          symbol: normalizedSymbol,
          data: this.parseTicker(msg),
          timestamp: msg.E as number,
        };

      default:
        return null;
    }
  }

  protected sendHeartbeat(): void {
    // Binance uses ping/pong at TCP level, no application heartbeat needed
    this.sendMessage({ method: 'PING', id: Date.now() });
  }

  protected getSubscriptions(symbols: string[]): unknown {
    return symbols.map((symbol) => `${symbol.replace('/', '').toLowerCase()}@depth10@100ms`);
  }

  private normalizeSymbol(symbol: string): string {
    // Convert BNBBTC to BTC/USDT format
    const match = symbol.match(/^([A-Z]+)([A-Z]+)$/);
    if (match) {
      const quote = match[2];
      const base = match[1];
      if (['USDT', 'BTC', 'ETH', 'USD', 'BUSD'].includes(quote)) {
        return `${base}/${quote}`;
      }
    }
    return symbol;
  }

  private parseOrderBook(msg: Record<string, unknown>): BinanceOrderBook {
    return {
      lastUpdateId: msg.lastUpdateId as number,
      bids: msg.b as [string, string][],
      asks: msg.a as [string, string][],
    };
  }

  private parseTrade(msg: Record<string, unknown>): BinanceTrade {
    return {
      e: msg.e as string,
      E: msg.E as number,
      s: msg.s as string,
      t: msg.t as number,
      p: msg.p as string,
      q: msg.q as string,
      b: msg.b as number,
      a: msg.a as number,
      T: msg.T as number,
      m: msg.m as boolean,
    };
  }

  private parseTicker(msg: Record<string, unknown>): BinanceTicker {
    return {
      e: msg.e as string,
      E: msg.E as number,
      s: msg.s as string,
      p: msg.p as string,
      P: msg.P as string,
      c: msg.c as string,
      o: msg.o as string,
      h: msg.h as string,
      l: msg.l as string,
      v: msg.v as string,
      q: msg.q as string,
    };
  }
}
