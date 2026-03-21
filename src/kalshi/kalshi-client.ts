// Kalshi REST API client with RSA private key signing
// Base URL: https://api.elections.kalshi.com/trade-api/v2
import { createPrivateKey, createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { MarketInfo, Order, OrderSide, Position } from '../core/types.js';
import { logger } from '../core/logger.js';

const KALSHI_BASE = 'https://api.elections.kalshi.com/trade-api/v2';

// --- Kalshi-specific API shapes ---

export interface KalshiMarket {
  ticker: string;
  title: string;
  subtitle?: string;
  status: 'open' | 'closed' | 'settled' | 'unopened';
  yes_bid: number;   // cents (0-99)
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  open_interest: number;
  close_time: string;
  category?: string;
}

export interface KalshiOrderbookLevel {
  price: number;  // cents
  delta: number;
}

export interface KalshiOrderbook {
  ticker: string;
  yes: KalshiOrderbookLevel[];
  no: KalshiOrderbookLevel[];
}

export interface KalshiOrder {
  order_id: string;
  ticker: string;
  side: 'yes' | 'no';
  type: 'limit' | 'market';
  status: string;
  yes_price: number;
  no_price: number;
  count: number;
  filled_count: number;
  created_time: string;
}

export interface KalshiBalance {
  balance: number;        // cents
  payout: number;
  fees_paid: number;
}

export interface KalshiPosition {
  ticker: string;
  position: number;       // positive=yes, negative=no
  market_exposure: number;
  realized_pnl: number;
  resting_orders_count: number;
}

// --- KalshiClient ---

export class KalshiClient {
  private apiKeyId: string;
  private privateKey: ReturnType<typeof createPrivateKey>;

  constructor(apiKeyId: string, privateKeyPath: string) {
    this.apiKeyId = apiKeyId;
    const pem = readFileSync(privateKeyPath, 'utf-8');
    this.privateKey = createPrivateKey(pem);
  }

  // Sign: base64url(RSA-PSS-SHA256(method + path + timestamp))
  private sign(method: string, path: string, timestamp: string): string {
    const msg = `${timestamp}${method}${path}`;
    const signer = createSign('RSA-SHA256');
    signer.update(msg);
    signer.end();
    return signer.sign({ key: this.privateKey, padding: 6 /* RSA_PKCS1_PSS_PADDING */ }, 'base64');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const timestamp = Date.now().toString();
    const signature = this.sign(method, path, timestamp);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'KALSHI-ACCESS-KEY': this.apiKeyId,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'KALSHI-ACCESS-SIGNATURE': signature,
    };

    const res = await fetch(`${KALSHI_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kalshi API ${res.status} ${method} ${path}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** GET /markets — list prediction markets */
  async getMarkets(params?: { limit?: number; cursor?: string; status?: string }): Promise<KalshiMarket[]> {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', params.limit.toString());
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.size > 0 ? `?${qs}` : '';
    const data = await this.request<{ markets: KalshiMarket[] }>('GET', `/markets${suffix}`);
    return data.markets;
  }

  /** GET /markets/{ticker} — single market details */
  async getMarket(ticker: string): Promise<KalshiMarket> {
    const data = await this.request<{ market: KalshiMarket }>('GET', `/markets/${ticker}`);
    return data.market;
  }

  /** GET /markets/{ticker}/orderbook */
  async getOrderbook(ticker: string): Promise<KalshiOrderbook> {
    const data = await this.request<{ orderbook: KalshiOrderbook }>('GET', `/markets/${ticker}/orderbook`);
    return data.orderbook;
  }

  /** POST /markets/{ticker}/orders — place order */
  async placeOrder(
    ticker: string,
    side: 'yes' | 'no',
    type: 'limit' | 'market',
    price: number,
    count: number,
  ): Promise<KalshiOrder> {
    logger.debug('Placing Kalshi order', 'KalshiClient', { ticker, side, price, count });
    const data = await this.request<{ order: KalshiOrder }>('POST', `/markets/${ticker}/orders`, {
      ticker,
      side,
      type,
      yes_price: side === 'yes' ? price : 100 - price,
      no_price: side === 'no' ? price : 100 - price,
      count,
      time_in_force: 'gtc',
    });
    return data.order;
  }

  /** DELETE /orders/{orderId} — cancel order */
  async cancelOrder(orderId: string): Promise<boolean> {
    await this.request<unknown>('DELETE', `/orders/${orderId}`);
    logger.info('Kalshi order cancelled', 'KalshiClient', { orderId });
    return true;
  }

  /** GET /portfolio/positions */
  async getPositions(): Promise<KalshiPosition[]> {
    const data = await this.request<{ market_positions: KalshiPosition[] }>('GET', '/portfolio/positions');
    return data.market_positions;
  }

  /** GET /portfolio/balance */
  async getBalance(): Promise<KalshiBalance> {
    const data = await this.request<{ balance: KalshiBalance }>('GET', '/portfolio/balance');
    return data.balance;
  }

  /** Map KalshiMarket to core MarketInfo */
  toMarketInfo(m: KalshiMarket): MarketInfo {
    return {
      id: m.ticker,
      symbol: m.ticker,
      type: 'polymarket', // prediction market type
      exchange: 'kalshi',
      baseCurrency: 'YES',
      quoteCurrency: 'USD',
      active: m.status === 'open',
    };
  }
}
