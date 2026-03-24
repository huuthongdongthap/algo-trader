// Polymarket CLOB REST API client with ECDSA signing
// Paper mode: simulated responses via clob-paper-simulator
// Live mode: real API + POLYMARKET_API_KEY / API_SECRET / PASSPHRASE env vars
import { Wallet } from 'ethers';
import type { MarketInfo, Order } from '../core/types.js';
import { logger } from '../core/logger.js';
import { paperMarkets, paperOrderBook, paperPrice } from './clob-paper-simulator.js';
import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { rateLimiterRegistry } from '../resilience/rate-limiter.js';
import { resilientFetch } from '../resilience/resilient-fetch.js';
import type { TokenBucket } from '../resilience/rate-limiter.js';

const CLOB_BASE = 'https://clob.polymarket.com';

// ── Raw API response shapes ──────────────────────────────────────────────────

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

export type OrderSide = 'buy' | 'sell';

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

export interface ClobClientConfig {
  privateKey?: string;
  chainId?: number;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  paperMode?: boolean;
}

// ── ClobClient ───────────────────────────────────────────────────────────────

export class ClobClient {
  private wallet: Wallet;
  private chainId: number;
  private apiKey: string;
  private passphrase: string;
  private paperMode: boolean;
  private circuitBreaker: CircuitBreaker;
  private rateLimiter: TokenBucket;

  constructor(privateKeyOrConfig: string | ClobClientConfig = '', chainId = 137) {
    if (typeof privateKeyOrConfig === 'string') {
      const pk = privateKeyOrConfig || '0x' + '1'.repeat(64);
      this.wallet     = new Wallet(pk);
      this.chainId    = chainId;
      this.apiKey     = process.env['POLYMARKET_API_KEY'] ?? '';
      this.passphrase = process.env['POLYMARKET_PASSPHRASE'] ?? '';
      this.paperMode  = !privateKeyOrConfig || privateKeyOrConfig === 'paper-key';
    } else {
      const cfg = privateKeyOrConfig;
      this.wallet     = new Wallet(cfg.privateKey || '0x' + '1'.repeat(64));
      this.chainId    = cfg.chainId ?? 137;
      this.apiKey     = cfg.apiKey     ?? process.env['POLYMARKET_API_KEY']     ?? '';
      this.passphrase = cfg.passphrase ?? process.env['POLYMARKET_PASSPHRASE']  ?? '';
      this.paperMode  = cfg.paperMode ?? false;
    }
    this.circuitBreaker = new CircuitBreaker({
      name: 'clob-api',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 2,
    });
    this.rateLimiter = rateLimiterRegistry.getOrCreate('polymarket');
  }

  get isPaperMode(): boolean { return this.paperMode; }

  // ── HTTP layer ────────────────────────────────────────────────────────────

  private async buildAuthHeaders(method: string, path: string, body = ''): Promise<Record<string, string>> {
    const ts  = Math.floor(Date.now() / 1000).toString();
    const sig = await this.wallet.signMessage(`${ts}${method}${path}${body}`);
    return {
      'POLY-ADDRESS':   this.wallet.address,
      'POLY-SIGNATURE': sig,
      'POLY-TIMESTAMP': ts,
      ...(this.apiKey ? { 'POLY-API-KEY': this.apiKey, 'POLY-PASSPHRASE': this.passphrase } : {}),
    };
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const method  = (options.method ?? 'GET').toUpperCase();
    const bodyStr = options.body ? String(options.body) : '';
    const auth    = await this.buildAuthHeaders(method, path, bodyStr);
    const res = await resilientFetch(`${CLOB_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...auth },
    }, {
      circuitBreaker: this.circuitBreaker,
      rateLimiter: this.rateLimiter,
      label: 'ClobClient',
      maxRetries: 3,
      timeoutMs: 15_000,
    });
    if (!res.ok) throw new Error(`CLOB API ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** GET /markets — list active prediction markets */
  async getMarkets(): Promise<MarketInfo[]> {
    if (this.paperMode) {
      return paperMarkets().map(m => ({
        id: m.condition_id, symbol: m.description.substring(0, 60),
        type: 'polymarket' as const, exchange: 'polymarket',
        baseCurrency: 'YES', quoteCurrency: 'USDC', active: m.active,
      }));
    }
    const raw = await this.request<{ data: RawMarket[] } | RawMarket[]>('/markets');
    const list = Array.isArray(raw) ? raw : (raw as { data: RawMarket[] }).data;
    return list.filter(m => m.active).map(m => ({
      id: m.condition_id, symbol: m.description.substring(0, 60),
      type: 'polymarket' as const, exchange: 'polymarket',
      baseCurrency: 'YES', quoteCurrency: 'USDC', active: m.active,
    }));
  }

  /** GET /book?token_id={id} — orderbook snapshot */
  async getOrderBook(tokenId: string): Promise<RawOrderBook> {
    if (this.paperMode) return paperOrderBook(tokenId);
    return this.request<RawOrderBook>(`/book?token_id=${tokenId}`);
  }

  /** GET /price?token_id={id} — mid/bid/ask */
  async getPrice(tokenId: string): Promise<RawPrice> {
    if (this.paperMode) return paperPrice(tokenId);
    return this.request<RawPrice>(`/price?token_id=${tokenId}`);
  }

  /** POST /order — ECDSA-signed limit order */
  async postOrder(args: OrderArgs): Promise<Order> {
    if (this.paperMode) {
      logger.debug('Paper: simulated order', 'ClobClient', { tokenId: args.tokenId, side: args.side });
      return {
        id: `paper-order-${Date.now()}`,
        marketId: args.tokenId, side: args.side,
        price: args.price, size: args.size,
        status: 'open', type: 'limit', createdAt: Date.now(),
      };
    }
    const nonce   = Date.now();
    const payload = {
      token_id: args.tokenId, price: args.price, size: args.size,
      side: args.side === 'buy' ? 'BUY' : 'SELL',
      type: args.orderType ?? 'GTC', nonce, chain_id: this.chainId,
    };
    const signature = await this.wallet.signMessage(JSON.stringify(payload));
    const body      = JSON.stringify({ ...payload, signature });

    logger.debug('Submitting order', 'ClobClient', { tokenId: args.tokenId, side: args.side });
    const raw = await this.request<RawOrderResponse>('/order', { method: 'POST', body });
    if (raw.error_msg) throw new Error(`Order rejected: ${raw.error_msg}`);

    return {
      id: raw.order_id, marketId: args.tokenId, side: args.side,
      price: args.price, size: args.size,
      status: 'open', type: 'limit', createdAt: Date.now(),
    };
  }

  /** Alias: placeLimitOrder → postOrder */
  async placeLimitOrder(args: OrderArgs): Promise<Order> {
    return this.postOrder(args);
  }

  /** DELETE /order/{id} — cancel open order */
  async cancelOrder(orderId: string): Promise<boolean> {
    if (this.paperMode) {
      logger.debug('Paper: simulated cancel', 'ClobClient', { orderId });
      return true;
    }
    const result = await this.request<{ success: boolean }>(`/order/${orderId}`, { method: 'DELETE' });
    logger.info('Order cancelled', 'ClobClient', { orderId });
    return result.success;
  }
}
