// Polymarket CLOB REST API client with ECDSA signing
// Base URL: https://clob.polymarket.com
import { Wallet } from 'ethers';
import type { MarketInfo, Order, OrderSide } from '../core/types.js';
import { logger } from '../core/logger.js';

const CLOB_BASE = 'https://clob.polymarket.com';

// --- Raw API response shapes ---

export interface RawMarket {
  condition_id: string;
  question_id: string;
  tokens: Array<{ token_id: string; outcome: string }>;
  minimum_order_size: string;
  minimum_tick_size: string;
  description: string;
  active: boolean;
  volume: string;
}

export interface OrderBookLevel {
  price: string;
  size: string;
}

export interface RawOrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  hash: string;
}

export interface RawPrice {
  mid: string;
  bid: string;
  ask: string;
}

export interface OrderArgs {
  tokenId: string;
  price: string;
  size: string;
  side: OrderSide;
  orderType?: 'GTC' | 'FOK' | 'IOC';
}

export interface RawOrderResponse {
  order_id: string;
  status: string;
  error_msg?: string;
}

// --- ClobClient ---

export class ClobClient {
  private wallet: Wallet;
  private chainId: number;

  constructor(privateKey: string, chainId: number = 137) {
    this.wallet = new Wallet(privateKey);
    this.chainId = chainId;
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${CLOB_BASE}${path}`;
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      ...options,
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`CLOB API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  private async signMessage(message: string): Promise<string> {
    return this.wallet.signMessage(message);
  }

  private buildAuthHeader(body: string): string {
    // Polymarket uses timestamp-based nonce in L1 auth header
    const ts = Math.floor(Date.now() / 1000).toString();
    return `${this.wallet.address}:${ts}`;
  }

  /** GET /markets - list active prediction markets */
  async getMarkets(): Promise<MarketInfo[]> {
    const raw = await this.request<RawMarket[]>('/markets');
    return raw
      .filter(m => m.active)
      .map(m => ({
        id: m.condition_id,
        symbol: m.description.substring(0, 60),
        type: 'polymarket' as const,
        exchange: 'polymarket',
        baseCurrency: 'YES',
        quoteCurrency: 'USDC',
        active: m.active,
      }));
  }

  /** GET /order_book/{token_id} - current orderbook snapshot */
  async getOrderBook(tokenId: string): Promise<RawOrderBook> {
    return this.request<RawOrderBook>(`/order_book/${tokenId}`);
  }

  /** GET /prices/{token_id} - mid/bid/ask */
  async getPrice(tokenId: string): Promise<RawPrice> {
    return this.request<RawPrice>(`/prices/${tokenId}`);
  }

  /** POST /order - submit ECDSA-signed limit order */
  async postOrder(args: OrderArgs): Promise<Order> {
    const nonce = Date.now();
    const payload = {
      token_id: args.tokenId,
      price: args.price,
      size: args.size,
      side: args.side === 'buy' ? 'BUY' : 'SELL',
      type: args.orderType ?? 'GTC',
      nonce,
      chain_id: this.chainId,
    };
    const msgHash = JSON.stringify(payload);
    const signature = await this.signMessage(msgHash);

    const body = { ...payload, signature };
    logger.debug('Submitting order', 'ClobClient', { tokenId: args.tokenId, side: args.side });

    const raw = await this.request<RawOrderResponse>('/order', {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (raw.error_msg) throw new Error(`Order rejected: ${raw.error_msg}`);

    return {
      id: raw.order_id,
      marketId: args.tokenId,
      side: args.side,
      price: args.price,
      size: args.size,
      status: 'open',
      type: 'limit',
      createdAt: Date.now(),
    };
  }

  /** DELETE /order/{order_id} - cancel open order */
  async cancelOrder(orderId: string): Promise<boolean> {
    const result = await this.request<{ success: boolean }>(`/order/${orderId}`, {
      method: 'DELETE',
    });
    logger.info('Order cancelled', 'ClobClient', { orderId });
    return result.success;
  }
}
