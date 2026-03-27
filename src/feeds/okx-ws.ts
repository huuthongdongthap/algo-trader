/**
 * OKX WebSocket Client
 * WebSocket v5 API for orderbook, trades, and ticker data
 * Docs: https://www.okx.com/docs-v5/en/#overview-websocket
 */

import { BaseWebSocketClient, WebSocketMessage, WebSocketConfig } from './websocket-client';
import { logger } from '../utils/logger';

export interface OKXOrderBook {
  seqId: number;
  asks: [string, string, string, string][]; // [price, amount, count, liquidated]
  bids: [string, string, string, string][];
  timestamp: string;
}

export interface OKXTrade {
  instId: string;
  tradeId: string;
  px: string;
  sz: string;
  side: 'buy' | 'sell';
  ts: string;
}

export interface OKXTicker {
  instId: string;
  last: string;
  lastSz: string;
  askPx: string;
  askSz: string;
  bidPx: string;
  bidSz: string;
  open24h: string;
  high24h: string;
  low24h: string;
  volCcyl24h: string;
  volUsd24h: string;
  ts: string;
}

export class OKXWebSocketClient extends BaseWebSocketClient {
  private subscribedSymbols = new Set<string>();
  private pingTimer: NodeJS.Timeout | null = null;

  constructor() {
    super({
      url: 'wss://ws.okx.com:8443/ws/v5/public',
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

    const args = symbols.map((symbol) => {
      const instId = symbol.replace('/', '-'); // BTC-USDT format
      this.subscribedSymbols.add(symbol);
      return {
        channel: 'books5',
        instId,
      };
    });

    // Also subscribe to trades and tickers
    symbols.forEach((symbol) => {
      const instId = symbol.replace('/', '-');
      args.push({ channel: 'trades', instId });
      args.push({ channel: 'tickers', instId });
    });

    const subscribeMessage = {
      op: 'subscribe',
      args,
    };

    this.sendMessage(subscribeMessage);
  }

  async unsubscribe(symbols: string[]): Promise<void> {
    const args = symbols.map((symbol) => {
      const instId = symbol.replace('/', '-');
      this.subscribedSymbols.delete(symbol);
      return {
        channel: 'books5',
        instId,
      };
    });

    symbols.forEach((symbol) => {
      const instId = symbol.replace('/', '-');
      args.push({ channel: 'trades', instId });
      args.push({ channel: 'tickers', instId });
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
    if (msg.event === 'subscribe') {
      return null;
    }

    // Handle error
    if (msg.event === 'error') {
      logger.error('[OKX WebSocket] Error:', { msg: msg.msg });
      return null;
    }

    const arg = msg.arg as Record<string, string> | undefined;
    if (!arg?.channel || !arg?.instId) {
      return null;
    }

    const symbol = arg.instId.replace('-', '/');
    const channel = arg.channel;

    const dataArray = msg.data as Record<string, unknown>[] | undefined;
    if (!dataArray || dataArray.length === 0) {
      return null;
    }

    switch (channel) {
      case 'books5':
      case 'books50':
      case 'bbo-tbt':
        return {
          type: 'orderbook',
          exchange: 'okx',
          symbol,
          data: this.parseOrderBook(dataArray[0]),
          timestamp: Date.now(),
        };

      case 'trades':
        return {
          type: 'trade',
          exchange: 'okx',
          symbol,
          data: this.parseTrade(dataArray[0]),
          timestamp: Date.now(),
        };

      case 'tickers':
        return {
          type: 'ticker',
          exchange: 'okx',
          symbol,
          data: this.parseTicker(dataArray[0]),
          timestamp: Date.now(),
        };

      default:
        return null;
    }
  }

  protected stopHeartbeat(): void {
    super.stopHeartbeat();
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  protected sendHeartbeat(): void {
    this.sendMessage('ping');
  }

  protected getSubscriptions(symbols: string[]): unknown {
    return symbols.map((symbol) => ({
      channel: 'books5',
      instId: symbol.replace('/', '-'),
    }));
  }

  private parseOrderBook(data: Record<string, unknown>): OKXOrderBook {
    const asks = (data.asks as string[][][])?.[0]?.map((l: string[]) => [l[0], l[1], l[2], l[3]] as [string, string, string, string]) || [];
    const bids = (data.bids as string[][][])?.[0]?.map((l: string[]) => [l[0], l[1], l[2], l[3]] as [string, string, string, string]) || [];
    return {
      seqId: Number(data.seqId ?? 0),
      asks,
      bids,
      timestamp: data.ts as string,
    };
  }

  private parseTrade(data: Record<string, unknown>): OKXTrade {
    return {
      instId: data.instId as string,
      tradeId: data.tradeId as string,
      px: data.px as string,
      sz: data.sz as string,
      side: data.side as 'buy' | 'sell',
      ts: data.ts as string,
    };
  }

  private parseTicker(data: Record<string, unknown>): OKXTicker {
    return {
      instId: data.instId as string,
      last: data.last as string,
      lastSz: data.lastSz as string,
      askPx: data.askPx as string,
      askSz: data.askSz as string,
      bidPx: data.bidPx as string,
      bidSz: data.bidSz as string,
      open24h: data.open24h as string,
      high24h: data.high24h as string,
      low24h: data.low24h as string,
      volCcyl24h: data.volCcyl24h as string,
      volUsd24h: data.volUsd24h as string,
      ts: data.ts as string,
    };
  }
}
