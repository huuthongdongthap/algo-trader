// Unified CEX client wrapper using CCXT
// Supports Binance, Bybit, OKX with unified API surface

import * as ccxt from 'ccxt';
import type { ExchangeCredentials, MarketInfo } from '../core/types.js';
import { logger } from '../core/logger.js';

export type SupportedExchange = 'binance' | 'bybit' | 'okx';

export interface Ticker {
  symbol: string;
  bid: string;
  ask: string;
  last: string;
  volume: string;
  timestamp: number;
}

export interface Orderbook {
  symbol: string;
  bids: [string, string][];  // [price, size]
  asks: [string, string][];
  timestamp: number;
}

export interface Balance {
  currency: string;
  free: string;
  used: string;
  total: string;
}

/** Config passed to CCXT constructor */
interface CcxtConfig {
  apiKey?: string;
  secret?: string;
  password?: string;
  enableRateLimit?: boolean;
  [key: string]: unknown;
}

/** Factory: create CCXT exchange instance from credentials */
function createExchangeInstance(name: SupportedExchange, creds: ExchangeCredentials): ccxt.Exchange {
  const config: CcxtConfig = {
    apiKey: creds.apiKey,
    secret: creds.apiSecret,
    enableRateLimit: true,
    ...(creds.passphrase ? { password: creds.passphrase } : {}),
  };

  switch (name) {
    case 'binance': return new ccxt.binance(config);
    case 'bybit':   return new ccxt.bybit(config);
    case 'okx':     return new ccxt.okx(config);
    default:        throw new Error(`Unsupported exchange: ${name}`);
  }
}

/** Multi-exchange manager — holds live CCXT instances */
export class ExchangeClient {
  private exchanges: Map<SupportedExchange, ccxt.Exchange> = new Map();

  /** Register an exchange from credentials config */
  connect(name: SupportedExchange, creds: ExchangeCredentials): void {
    const instance = createExchangeInstance(name, creds);
    this.exchanges.set(name, instance);
    logger.info('Exchange connected', 'ExchangeClient', { exchange: name });
  }

  /** Get raw CCXT instance (for advanced usage) */
  getInstance(name: SupportedExchange): ccxt.Exchange {
    const instance = this.exchanges.get(name);
    if (!instance) throw new Error(`Exchange not connected: ${name}`);
    return instance;
  }

  /** List all registered exchange names */
  listConnected(): SupportedExchange[] {
    return Array.from(this.exchanges.keys());
  }

  /** Fetch non-zero balances from an exchange */
  async getBalance(name: SupportedExchange): Promise<Balance[]> {
    const ex = this.getInstance(name);
    const raw = await ex.fetchBalance();
    const balances: Balance[] = [];

    type BalanceDict = Record<string, number | string | undefined>;
    const totals = raw.total as unknown as BalanceDict;
    const free   = raw.free  as unknown as BalanceDict;
    const used   = raw.used  as unknown as BalanceDict;

    for (const [currency, total] of Object.entries(totals)) {
      if (!total || Number(total) === 0) continue;
      balances.push({
        currency,
        free:  String(free[currency]  ?? 0),
        used:  String(used[currency]  ?? 0),
        total: String(total),
      });
    }
    return balances;
  }

  /** Fetch current ticker for a symbol */
  async getTicker(name: SupportedExchange, symbol: string): Promise<Ticker> {
    const ex = this.getInstance(name);
    const raw = await ex.fetchTicker(symbol);
    return {
      symbol: raw.symbol,
      bid:    String(raw.bid        ?? 0),
      ask:    String(raw.ask        ?? 0),
      last:   String(raw.last       ?? 0),
      volume: String(raw.baseVolume ?? 0),
      timestamp: raw.timestamp ?? Date.now(),
    };
  }

  /** Fetch active markets as MarketInfo array */
  async getMarkets(name: SupportedExchange): Promise<MarketInfo[]> {
    const ex = this.getInstance(name);
    const raw = await ex.loadMarkets();
    const markets: MarketInfo[] = [];

    for (const value of Object.values(raw)) {
      const m = value as ccxt.Market | null | undefined;
      if (!m?.active) continue;
      markets.push({
        id:            m.id              ?? '',
        symbol:        m.symbol          ?? '',
        type:          'cex' as const,
        exchange:      name,
        baseCurrency:  m.base            ?? '',
        quoteCurrency: m.quote           ?? '',
        active:        m.active          ?? false,
      });
    }
    return markets;
  }

  /** Disconnect all exchanges gracefully */
  async disconnectAll(): Promise<void> {
    for (const [name, ex] of this.exchanges.entries()) {
      try {
        const closeable = ex as ccxt.Exchange & { close?: () => Promise<void> };
        if (typeof closeable.close === 'function') await closeable.close();
      } catch {
        logger.warn('Failed to close exchange', 'ExchangeClient', { exchange: name });
      }
    }
    this.exchanges.clear();
  }
}
