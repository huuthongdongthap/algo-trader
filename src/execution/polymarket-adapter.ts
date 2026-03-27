/**
 * Polymarket CLOB Execution Adapter
 * Bridges the algo-trader execution engine with Polymarket's REST CLOB API.
 * Docs: https://docs.polymarket.com/#clob-api
 *
 * Auth: POLY_API_KEY, POLY_API_SECRET, POLY_PASSPHRASE from process.env
 * Base: https://clob.polymarket.com
 */

import { PolymarketSigner, PolymarketOrder, SignedOrder } from './polymarket-signer';

const CLOB_BASE = 'https://clob.polymarket.com';

// ── Response shapes from CLOB API ────────────────────────────────────────────

export interface PolymarketOrderResponse {
  orderID: string;
  status: 'matched' | 'delayed' | 'unmatched' | 'canceled';
  error?: string;
}

export interface PolymarketOpenOrder {
  id: string;
  asset_id: string;
  price: string;
  original_size: string;
  size_matched: string;
  side: 'BUY' | 'SELL';
  expiration: string;
  status: string;
  created_at: string;
}

export interface PolymarketBookLevel {
  price: string;
  size: string;
}

export interface PolymarketOrderBook {
  market: string;
  asset_id: string;
  bids: PolymarketBookLevel[];
  asks: PolymarketBookLevel[];
  hash: string;
  timestamp: string;
}

export interface PolymarketMarketInfo {
  condition_id: string;
  question_id: string;
  question: string;
  description: string;
  market_slug: string;
  end_date_iso: string;
  game_start_time?: string;
  resolution_source?: string;
  tokens: Array<{ token_id: string; outcome: string; price: number }>;
  active: boolean;
  closed: boolean;
  archived: boolean;
  minimum_order_size: string;
  minimum_tick_size: string;
  category: string;
  fpmm?: string;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Execution adapter for Polymarket CLOB REST API.
 * Handles order placement, cancellation, and market queries.
 */
export class PolymarketAdapter {
  private readonly apiUrl: string;
  private readonly signer: PolymarketSigner;
  private readonly apiKey: string;
  /** Used in HMAC-SHA256 signature — see _stubSignature TODO */
  private readonly apiSecret: string;
  private readonly passphrase: string;

  /**
   * @param apiUrl - CLOB base URL (default: https://clob.polymarket.com)
   * @param signer - Configured PolymarketSigner instance
   */
  constructor(
    signer: PolymarketSigner,
    apiUrl: string = CLOB_BASE,
  ) {
    this.signer = signer;
    this.apiUrl = apiUrl.replace(/\/$/, '');
    this.apiKey = process.env.POLY_API_KEY || '';
    this.apiSecret = process.env.POLY_API_SECRET || '';
    this.passphrase = process.env.POLY_PASSPHRASE || '';
  }

  /**
   * Place a signed order on the CLOB.
   * @param order - Unsigned order params
   * @returns Order ID and status from CLOB
   */
  async placeOrder(order: PolymarketOrder): Promise<PolymarketOrderResponse> {
    const signed: SignedOrder = await this.signer.signOrder(order);
    const body = this.serializeSignedOrder(signed);

    return this.request<PolymarketOrderResponse>('POST', '/order', body);
  }

  /**
   * Cancel an open order by ID.
   * @param orderId - CLOB order ID to cancel
   */
  async cancelOrder(orderId: string): Promise<{ canceled: boolean }> {
    return this.request<{ canceled: boolean }>('DELETE', `/order/${orderId}`);
  }

  /**
   * Fetch all open orders for the authenticated maker.
   */
  async getOpenOrders(): Promise<PolymarketOpenOrder[]> {
    return this.request<PolymarketOpenOrder[]>('GET', '/orders');
  }

  /**
   * Fetch market metadata for a condition ID.
   * @param conditionId - Market condition ID (0x-prefixed hex)
   */
  async getMarketInfo(conditionId: string): Promise<PolymarketMarketInfo> {
    return this.request<PolymarketMarketInfo>('GET', `/markets/${conditionId}`);
  }

  /**
   * Fetch current orderbook snapshot for a token.
   * @param tokenId - YES or NO outcome token ID
   */
  async getOrderBook(tokenId: string): Promise<PolymarketOrderBook> {
    return this.request<PolymarketOrderBook>('GET', `/book?token_id=${tokenId}`);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const headers = this.buildHeaders(method, path, body);

    const init: RequestInit = {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    };

    const res = await fetch(url, init);

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Polymarket CLOB error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  /** Build auth headers required by Polymarket CLOB API */
  private buildHeaders(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Record<string, string> {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'POLY-TIMESTAMP': timestamp,
    };

    if (this.apiKey) {
      headers['POLY-API-KEY'] = this.apiKey;
      headers['POLY-PASSPHRASE'] = this.passphrase;
      // TODO: compute HMAC-SHA256(timestamp + method + path + body, apiSecret)
      // and set headers['POLY-SIGNATURE'] = signature
      headers['POLY-SIGNATURE'] = this._stubSignature(timestamp, method, path, body);
    }

    return headers;
  }

  /** Serialize a SignedOrder to the CLOB POST /order body shape */
  private serializeSignedOrder(order: SignedOrder): Record<string, unknown> {
    return {
      tokenID: order.tokenId,
      makerAmount: Math.round(order.size * 1e6).toString(),
      takerAmount: Math.round(order.size * order.price * 1e6).toString(),
      expiration: order.expiration.toString(),
      nonce: order.nonce,
      feeRateBps: order.feeRateBps.toString(),
      side: order.side,
      signatureType: order.signatureType,
      signature: order.signature,
      maker: order.maker,
    };
  }

  /**
   * @internal stub — replace with HMAC-SHA256 using crypto module or noble/hashes
   * TODO: import { createHmac } from 'crypto';
   *       const msg = timestamp + method.toUpperCase() + path + (body ? JSON.stringify(body) : '');
   *       return createHmac('sha256', this.apiSecret).update(msg).digest('base64');
   */
  private _stubSignature(
    _timestamp: string,
    _method: string,
    _path: string,
    _body?: Record<string, unknown>,
  ): string {
    // TODO: import { createHmac } from 'crypto';
    //       const msg = timestamp + method.toUpperCase() + path + (body ? JSON.stringify(body) : '');
    //       return createHmac('sha256', this.apiSecret).update(msg).digest('base64');
    throw new Error('HMAC signature not implemented — replace _stubSignature() with crypto.createHmac');
  }
}
