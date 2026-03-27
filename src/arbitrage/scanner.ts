/**
 * Multi-Exchange Scanner
 * Real-time price fetching and order book depth analysis
 */

import ccxt from 'ccxt';
import { PricePoint, OrderBook, OrderBookLevel, ExchangeId, ScannerConfig } from './types';
import { DEFAULT_SCANNER_CONFIG, EXCHANGE_FEE_RATES } from './config';
import { logger } from '../utils/logger';

// CCXT exchange interface for type safety
interface CcxtExchange {
  fetchTicker(symbol: string): Promise<{ bid: number; ask: number; baseVolume?: number }>;
  fetchOrderBook(symbol: string, depth?: number): Promise<{
    bids: [number, number][];
    asks: [number, number][];
  }>;
  close(): Promise<void>;
}

export class MultiExchangeScanner {
  private exchanges: Map<ExchangeId, CcxtExchange> = new Map();
  private config: ScannerConfig;
  private running = false;

  constructor(config: Partial<ScannerConfig> = {}) {
    this.config = { ...DEFAULT_SCANNER_CONFIG, ...config };
    this.initExchanges();
  }

  private initExchanges(): void {
    const exchangeConfigs: Record<string, { apiKey: string; secret: string }> = {
      binance: { apiKey: process.env.BINANCE_API_KEY || '', secret: process.env.BINANCE_SECRET || '' },
      coinbase: { apiKey: process.env.COINBASE_API_KEY || '', secret: process.env.COINBASE_SECRET || '' },
      kraken: { apiKey: process.env.KRAKEN_API_KEY || '', secret: process.env.KRAKEN_SECRET || '' },
    };

    (Object.keys(exchangeConfigs) as ExchangeId[]).forEach((id) => {
      if (this.config.exchanges.includes(id)) {
        const exchange = new (ccxt as any)[id](exchangeConfigs[id]) as CcxtExchange;
        this.exchanges.set(id, exchange);
      }
    });
  }

  async fetchPrice(exchange: ExchangeId, symbol: string): Promise<PricePoint | null> {
    try {
      const ccxtExchange = this.exchanges.get(exchange);
      if (!ccxtExchange) throw new Error(`Exchange ${exchange} not initialized`);

      const ticker = await ccxtExchange.fetchTicker(symbol);
      return {
        exchange,
        symbol,
        bid: ticker.bid ?? 0,
        ask: ticker.ask ?? 0,
        timestamp: Date.now(),
        volume24h: ticker.baseVolume,
      };
    } catch (error) {
      logger.error(`Failed to fetch price from ${exchange}:`, { error });
      return null;
    }
  }

  async fetchOrderBook(exchange: ExchangeId, symbol: string, depth = 10): Promise<OrderBook | null> {
    try {
      const ccxtExchange = this.exchanges.get(exchange);
      if (!ccxtExchange) throw new Error(`Exchange ${exchange} not initialized`);

      const book = await ccxtExchange.fetchOrderBook(symbol, depth);
      return {
        exchange,
        symbol,
        bids: book.bids.map((level: [number, number]) => ({ price: level[0], amount: level[1] }) as OrderBookLevel),
        asks: book.asks.map((level: [number, number]) => ({ price: level[0], amount: level[1] }) as OrderBookLevel),
        timestamp: Date.now(),
      };
    } catch (error) {
      logger.error(`Failed to fetch order book from ${exchange}:`, { error });
      return null;
    }
  }

  async fetchAllPrices(symbol: string): Promise<PricePoint[]> {
    const results = await Promise.allSettled(
      this.config.exchanges.map((ex) => this.fetchPrice(ex, symbol))
    );
    return results
      .filter((r): r is PromiseFulfilledResult<PricePoint> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((p): p is PricePoint => p !== null);
  }

  async findBestSpread(symbol: string): Promise<{ bestBid: PricePoint; bestAsk: PricePoint; spread: number } | null> {
    const prices = await this.fetchAllPrices(symbol);
    if (prices.length < 2) return null;

    const sortedByBid = [...prices].sort((a, b) => b.bid - a.bid);
    const sortedByAsk = [...prices].sort((a, b) => a.ask - b.ask);

    const bestBid = sortedByBid[0];
    const bestAsk = sortedByAsk[0];

    if (bestBid.exchange === bestAsk.exchange) return null;

    const spread = ((bestBid.bid - bestAsk.ask) / bestAsk.ask) * 100;
    return { bestBid, bestAsk, spread };
  }

  getExchangeFee(exchange: ExchangeId): number {
    return EXCHANGE_FEE_RATES[exchange] ?? 0.001;
  }

  async startScanning(): Promise<void> {
    this.running = true;
    while (this.running) {
      await Promise.all(
        this.config.symbols.map((symbol) => this.findBestSpread(symbol))
      );
      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
    }
  }

  stopScanning(): void {
    this.running = false;
  }

  async destroy(): Promise<void> {
    this.stopScanning();
    await Promise.all(Array.from(this.exchanges.values()).map((ex) => ex.close()));
  }
}
