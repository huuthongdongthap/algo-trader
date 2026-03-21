// WebSocket streaming client for Polymarket CLOB orderbook
// Endpoint: wss://ws-subscriptions-clob.polymarket.com/ws/market
import { EventEmitter } from 'events';
import { logger } from '../core/logger.js';
import { sleep } from '../core/utils.js';
import type { OrderBookLevel } from './clob-client.js';

const WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/market';
const MAX_RECONNECT_DELAY_MS = 30_000;
const BASE_RECONNECT_DELAY_MS = 1_000;

export interface OrderBookState {
  tokenId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  updatedAt: number;
}

export interface OrderBookUpdate {
  tokenId: string;
  state: OrderBookState;
  spreadChanged: boolean;
  prevSpread: number;
  newSpread: number;
}

// --- Raw WS message shapes ---

interface WsSnapshot {
  event_type: 'book';
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}

interface WsDelta {
  event_type: 'price_change';
  asset_id: string;
  changes: Array<{ side: 'BUY' | 'SELL'; price: string; size: string }>;
}

type WsMessage = WsSnapshot | WsDelta;

// --- OrderBookStream ---

export class OrderBookStream extends EventEmitter {
  private ws: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private books = new Map<string, OrderBookState>();
  private reconnectAttempt = 0;
  private stopped = false;

  /** Subscribe to orderbook updates for a token */
  subscribe(tokenId: string): void {
    this.subscriptions.add(tokenId);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe([tokenId]);
    }
  }

  /** Unsubscribe from a token's updates */
  unsubscribe(tokenId: string): void {
    this.subscriptions.delete(tokenId);
    this.books.delete(tokenId);
  }

  /** Get current local orderbook state */
  getBook(tokenId: string): OrderBookState | undefined {
    return this.books.get(tokenId);
  }

  /** Open WebSocket connection */
  connect(): void {
    this.stopped = false;
    this.openSocket();
  }

  /** Close connection permanently */
  disconnect(): void {
    this.stopped = true;
    this.ws?.close();
    this.ws = null;
  }

  private openSocket(): void {
    try {
      this.ws = new WebSocket(WS_URL);
      this.ws.onopen = () => this.onOpen();
      this.ws.onmessage = (e) => this.onMessage(e.data as string);
      this.ws.onerror = (e) => logger.warn('WS error', 'OrderBookStream', { error: String(e) });
      this.ws.onclose = () => this.onClose();
    } catch (err) {
      logger.error('Failed to open WebSocket', 'OrderBookStream', { err: String(err) });
      this.scheduleReconnect();
    }
  }

  private onOpen(): void {
    logger.info('WebSocket connected', 'OrderBookStream');
    this.reconnectAttempt = 0;
    if (this.subscriptions.size > 0) {
      this.sendSubscribe(Array.from(this.subscriptions));
    }
    this.emit('connected');
  }

  private onClose(): void {
    logger.warn('WebSocket disconnected', 'OrderBookStream');
    this.emit('disconnected');
    if (!this.stopped) this.scheduleReconnect();
  }

  private sendSubscribe(tokenIds: string[]): void {
    this.ws?.send(JSON.stringify({ type: 'subscribe', channel: 'market', assets_ids: tokenIds }));
  }

  private onMessage(raw: string): void {
    let msg: WsMessage;
    try {
      msg = JSON.parse(raw) as WsMessage;
    } catch {
      return;
    }

    if (msg.event_type === 'book') {
      this.applySnapshot(msg as WsSnapshot);
    } else if (msg.event_type === 'price_change') {
      this.applyDelta(msg as WsDelta);
    }
  }

  private applySnapshot(snap: WsSnapshot): void {
    const prev = this.books.get(snap.asset_id);
    const prevSpread = prev ? this.calcSpread(prev) : 0;
    const state: OrderBookState = {
      tokenId: snap.asset_id,
      bids: [...snap.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price)),
      asks: [...snap.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price)),
      updatedAt: Date.now(),
    };
    this.books.set(snap.asset_id, state);
    const newSpread = this.calcSpread(state);
    this.emitUpdate(snap.asset_id, state, prevSpread, newSpread);
  }

  private applyDelta(delta: WsDelta): void {
    const book = this.books.get(delta.asset_id);
    if (!book) return;
    const prevSpread = this.calcSpread(book);

    for (const change of delta.changes) {
      const side = change.side === 'BUY' ? book.bids : book.asks;
      const idx = side.findIndex(l => l.price === change.price);
      if (parseFloat(change.size) === 0) {
        if (idx !== -1) side.splice(idx, 1);
      } else if (idx !== -1) {
        side[idx].size = change.size;
      } else {
        side.push({ price: change.price, size: change.size });
      }
    }
    // Re-sort after delta
    book.bids.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
    book.asks.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
    book.updatedAt = Date.now();

    const newSpread = this.calcSpread(book);
    this.emitUpdate(delta.asset_id, book, prevSpread, newSpread);
  }

  private calcSpread(book: OrderBookState): number {
    const bestBid = book.bids[0] ? parseFloat(book.bids[0].price) : 0;
    const bestAsk = book.asks[0] ? parseFloat(book.asks[0].price) : 0;
    if (bestBid === 0 || bestAsk === 0) return 0;
    return bestAsk - bestBid;
  }

  private emitUpdate(tokenId: string, state: OrderBookState, prevSpread: number, newSpread: number): void {
    const spreadChanged = Math.abs(newSpread - prevSpread) / (prevSpread || 1) > 0.01;
    const update: OrderBookUpdate = { tokenId, state, spreadChanged, prevSpread, newSpread };
    this.emit('update', update);
    if (spreadChanged) this.emit('spread_change', update);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempt),
      MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt++;
    logger.info('Reconnecting WebSocket', 'OrderBookStream', { attempt: this.reconnectAttempt, delayMs: delay });
    sleep(delay).then(() => { if (!this.stopped) this.openSocket(); });
  }
}
