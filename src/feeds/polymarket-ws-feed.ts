/**
 * Polymarket WebSocket Feed
 * CLOB market data stream: price changes, trades, and orderbook snapshots
 * Docs: https://docs.polymarket.com/#websocket-subscriptions
 */

import { BaseWebSocketClient, WebSocketMessage, WebSocketConfig } from './websocket-client';

/** Binary outcome prediction market */
export interface PolymarketMarket {
  conditionId: string;
  questionId: string;
  question: string;
  outcomes: ['Yes', 'No'];
  tokens: [string, string]; // [yesTokenId, noTokenId]
}

/** Single price level update for a token */
export interface PolymarketPrice {
  tokenId: string;
  price: number;
  side: 'buy' | 'sell';
  size: number;
  timestamp: number;
}

/** Raw CLOB WebSocket message shape */
interface PolymarketRawMessage {
  event_type?: string;
  type?: string;
  asset_id?: string;
  market?: string;
  price?: string;
  side?: string;
  size?: string;
  timestamp?: string | number;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}

/** Orderbook snapshot for a token */
export interface PolymarketOrderBook {
  tokenId: string;
  bids: Array<{ price: number; size: number }>;
  asks: Array<{ price: number; size: number }>;
  timestamp: number;
}

/**
 * WebSocket client for Polymarket CLOB market data.
 * Subscribes to price_change, trade, and book events for binary outcome tokens.
 */
export class PolymarketWebSocketFeed extends BaseWebSocketClient {
  private subscribedMarkets = new Set<string>();

  constructor(config?: Partial<WebSocketConfig>) {
    super({
      url: 'wss://ws-subscriptions-clob.polymarket.com/ws/market',
      reconnectDelay: 1000,
      maxReconnectDelay: 30000,
      heartbeatInterval: 25000,
      heartbeatTimeout: 10000,
      ...config,
    });
  }

  /** Connect to Polymarket CLOB WebSocket endpoint */
  async connect(): Promise<void> {
    await this.connectWebSocket();
  }

  /** Disconnect and clean up subscriptions */
  async disconnect(): Promise<void> {
    if (this.subscribedMarkets.size > 0) {
      await this.unsubscribe(Array.from(this.subscribedMarkets));
    }
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.state = 'disconnected';
  }

  /**
   * Subscribe to price, trade, and book events for given market/token IDs.
   * @param marketIds - Array of conditionId or tokenId strings
   */
  async subscribe(marketIds: string[]): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const assets = marketIds.map((id) => ({ asset_id: id }));
    const message = {
      type: 'subscribe',
      assets_ids: marketIds,
      channels: ['price_change', 'trade', 'book'],
    };

    marketIds.forEach((id) => this.subscribedMarkets.add(id));
    this.sendMessage({ ...message, assets });
  }

  /**
   * Unsubscribe from market data for given IDs.
   * @param marketIds - Array of conditionId or tokenId strings
   */
  async unsubscribe(marketIds: string[]): Promise<void> {
    const message = {
      type: 'unsubscribe',
      assets_ids: marketIds,
    };
    marketIds.forEach((id) => this.subscribedMarkets.delete(id));
    this.sendMessage(message);
  }

  protected handleMessage(data: unknown): WebSocketMessage | null {
    const msg = data as PolymarketRawMessage;
    const eventType = msg.event_type || msg.type;

    if (!eventType) return null;

    // Heartbeat acknowledgement
    if (eventType === 'pong' || eventType === 'heartbeat') {
      this.handleHeartbeatResponse();
      return null;
    }

    const tokenId = msg.asset_id || msg.market || '';
    const timestamp = msg.timestamp
      ? typeof msg.timestamp === 'number'
        ? msg.timestamp
        : parseInt(msg.timestamp, 10)
      : Date.now();

    switch (eventType) {
      case 'price_change':
        return this.buildPriceMessage(tokenId, msg, timestamp);
      case 'trade':
        return this.buildTradeMessage(tokenId, msg, timestamp);
      case 'book':
        return this.buildBookMessage(tokenId, msg, timestamp);
      default:
        return null;
    }
  }

  /** Send application-level ping to keep connection alive */
  protected sendHeartbeat(): void {
    this.sendMessage({ type: 'ping' });
  }

  protected getSubscriptions(symbols: string[]): unknown {
    return symbols.map((id) => ({ asset_id: id }));
  }

  private buildPriceMessage(
    tokenId: string,
    msg: PolymarketRawMessage,
    timestamp: number
  ): WebSocketMessage {
    const price: PolymarketPrice = {
      tokenId,
      price: parseFloat(msg.price || '0'),
      side: (msg.side as 'buy' | 'sell') || 'buy',
      size: parseFloat(msg.size || '0'),
      timestamp,
    };
    return {
      type: 'ticker',
      exchange: 'polymarket',
      symbol: tokenId,
      data: price,
      timestamp,
    };
  }

  private buildTradeMessage(
    tokenId: string,
    msg: PolymarketRawMessage,
    timestamp: number
  ): WebSocketMessage {
    return {
      type: 'trade',
      exchange: 'polymarket',
      symbol: tokenId,
      data: {
        tokenId,
        price: parseFloat(msg.price || '0'),
        size: parseFloat(msg.size || '0'),
        side: msg.side || 'buy',
        timestamp,
      },
      timestamp,
    };
  }

  private buildBookMessage(
    tokenId: string,
    msg: PolymarketRawMessage,
    timestamp: number
  ): WebSocketMessage {
    const book: PolymarketOrderBook = {
      tokenId,
      bids: (msg.bids || []).map((b) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
      asks: (msg.asks || []).map((a) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
      timestamp,
    };
    return {
      type: 'orderbook',
      exchange: 'polymarket',
      symbol: tokenId,
      data: book,
      timestamp,
    };
  }
}
