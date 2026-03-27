/**
 * Bybit WebSocket Client
 * WebSocket v5 API for orderbook, trades, and ticker data
 * Docs: https://bybit-exchange.github.io/docs/v5/ws/connect
 */

import { BaseWebSocketClient, WebSocketMessage, WebSocketConfig } from './websocket-client';
import { logger } from '../utils/logger';

export interface BybitOrderBook {
  seq: number;
  bids: [string, string][]; // [price, size]
  asks: [string, string][];
  ts: number;
  u: number;
}

export interface BybitTrade {
  category: string;
  symbol: string;
  execId: string;
  price: string;
  size: string;
  side: 'Buy' | 'Sell';
  time: string;
  isBlockTrade: boolean;
}

export interface BybitTicker {
  category: string;
  symbol: string;
  lastPrice: string;
  indexPrice: string;
  markPrice: string;
  prevPrice24h: string;
  price24hPcnt: string;
  highPrice24h: string;
  lowPrice24h: string;
  prevPrice1h: string;
  volume24h: string;
  turnover24h: string;
  fundingRate: string;
  nextFundingTime: string;
  openInterest: string;
  openInterestValue: string;
}

export class BybitWebSocketClient extends BaseWebSocketClient {
  private subscribedSymbols = new Set<string>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor() {
    super({
      url: 'wss://stream.bybit.com/v5/public/linear', // Linear perpetual contracts
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 20000, // Bybit recommends 20s
    });
  }

  async connect(): Promise<void> {
    await this.connectWebSocket();
  }

  async disconnect(): Promise<void> {
    await this.unsubscribe(Array.from(this.subscribedSymbols));
    this.stopHeartbeat();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
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

    const args: string[] = [];
    symbols.forEach((symbol) => {
      const bybitSymbol = symbol.replace('/', ''); // BTCUSDT format
      this.subscribedSymbols.add(symbol);
      args.push(
        `orderbook.25.${bybitSymbol}`, // L2 25 levels
        `publicTrade.${bybitSymbol}`,
        `tickers.${bybitSymbol}`
      );
    });

    const subscribeMessage = {
      op: 'subscribe',
      args,
    };

    this.sendMessage(subscribeMessage);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const args: string[] = [];
    symbols.forEach((symbol) => {
      const bybitSymbol = symbol.replace('/', '');
      this.subscribedSymbols.delete(symbol);
      args.push(
        `orderbook.25.${bybitSymbol}`,
        `publicTrade.${bybitSymbol}`,
        `tickers.${bybitSymbol}`
      );
    });

    const unsubscribeMessage = {
      op: 'unsubscribe',
      args,
    };

    this.sendMessage(unsubscribeMessage);
  }

  protected handleMessage(data: unknown): WebSocketMessage | null {
    const msg = data as Record<string, unknown>;

    // Handle subscription response
    if (msg.success === true && msg.op === 'subscribe') {
      return null;
    }

    // Handle pong
    if (msg.op === 'pong') {
      return null;
    }

    // Handle error
    if (msg.retCode !== undefined && msg.retCode !== 0) {
      logger.error('[Bybit WebSocket] Error:', { msg: msg.retMsg });
      return null;
    }

    const topic = msg.topic as string | undefined;
    if (!topic) {
      return null;
    }

    const symbol = this.extractSymbol(topic);
    if (!symbol) {
      return null;
    }

    const dataPayload = msg.data as Record<string, unknown> | Record<string, unknown>[] | undefined;
    if (!dataPayload) {
      return null;
    }

    if (topic.startsWith('orderbook')) {
      return {
        type: 'orderbook',
        exchange: 'bybit',
        symbol,
        data: this.parseOrderBook(dataPayload as Record<string, unknown>),
        timestamp: Date.now(),
      };
    }

    if (topic.startsWith('publicTrade')) {
      const trades = Array.isArray(dataPayload) ? dataPayload : [dataPayload];
      return {
        type: 'trade',
        exchange: 'bybit',
        symbol,
        data: this.parseTrade(trades[0]),
        timestamp: Date.now(),
      };
    }

    if (topic.startsWith('tickers')) {
      return {
        type: 'ticker',
        exchange: 'bybit',
        symbol,
        data: this.parseTicker(dataPayload as Record<string, unknown>),
        timestamp: Date.now(),
      };
    }

    return null;
  }

  protected stopHeartbeat(): void {
    super.stopHeartbeat();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  protected sendHeartbeat(): void {
    this.sendMessage({ op: 'ping' });
  }

  protected getSubscriptions(symbols: string[]): unknown {
    return symbols.map((symbol) => `orderbook.25.${symbol.replace('/', '')}`);
  }

  private extractSymbol(topic: string): string | null {
    const parts = topic.split('.');
    if (parts.length < 3) return null;
    const rawSymbol = parts[2];
    // Convert BTCUSDT to BTC/USDT
    const match = rawSymbol.match(/^([A-Z]+)(USDT|USDC|USD|BTC|ETH)$/);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
    return rawSymbol;
  }

  private parseOrderBook(data: Record<string, unknown>): BybitOrderBook {
    const bidsData = (data.b as string[][][])?.[0] || (data.b as string[][]) || [];
    const asksData = (data.a as string[][][])?.[0] || (data.a as string[][]) || [];
    const bids = bidsData.map((l: string[]) => [l[0], l[1]] as [string, string]);
    const asks = asksData.map((l: string[]) => [l[0], l[1]] as [string, string]);
    return {
      seq: Number(data.seq ?? 0),
      bids,
      asks,
      ts: Number(data.ts ?? 0),
      u: Number(data.u ?? 0),
    };
  }

  private parseTrade(data: Record<string, unknown>): BybitTrade {
    return {
      category: data.category as string,
      symbol: data.symbol as string,
      execId: data.execId as string,
      price: data.price as string,
      size: data.size as string,
      side: data.side as 'Buy' | 'Sell',
      time: data.time as string,
      isBlockTrade: data.isBlockTrade as boolean,
    };
  }

  private parseTicker(data: Record<string, unknown>): BybitTicker {
    return {
      category: data.category as string,
      symbol: data.symbol as string,
      lastPrice: data.lastPrice as string,
      indexPrice: data.indexPrice as string,
      markPrice: data.markPrice as string,
      prevPrice24h: data.prevPrice24h as string,
      price24hPcnt: data.price24hPcnt as string,
      highPrice24h: data.highPrice24h as string,
      lowPrice24h: data.lowPrice24h as string,
      prevPrice1h: data.prevPrice1h as string,
      volume24h: data.volume24h as string,
      turnover24h: data.turnover24h as string,
      fundingRate: data.fundingRate as string,
      nextFundingTime: data.nextFundingTime as string,
      openInterest: data.openInterest as string,
      openInterestValue: data.openInterestValue as string,
    };
  }
}
