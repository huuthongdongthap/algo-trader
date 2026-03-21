// Market data feeds: orderbook, OHLCV candles, funding rates, cross-exchange price comparison
// Uses polling for compatibility across all CCXT exchanges

import { logger } from '../core/logger.js';
import { sleep } from '../core/utils.js';
import type { ExchangeClient, Orderbook, SupportedExchange } from './exchange-client.js';

export interface OHLCVCandle {
  timestamp: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

export interface FundingRate {
  exchange: SupportedExchange;
  symbol: string;
  /** Funding rate as decimal string e.g. "0.0001" */
  rate: string;
  /** Next funding timestamp in ms */
  nextFundingTime: number;
}

export interface CrossExchangePrice {
  exchange: SupportedExchange;
  symbol: string;
  bid: string;
  ask: string;
  mid: string;
}

export interface PriceSpread {
  highExchange: SupportedExchange;
  lowExchange: SupportedExchange;
  symbol: string;
  spreadPercent: string;
  highAsk: string;
  lowBid: string;
}

export class MarketData {
  constructor(private client: ExchangeClient) {}

  /** Fetch orderbook snapshot up to given depth */
  async getOrderbook(
    exchange: SupportedExchange,
    symbol: string,
    depth: number = 20,
  ): Promise<Orderbook> {
    const ex = this.client.getInstance(exchange);
    const raw = await ex.fetchOrderBook(symbol, depth);
    return {
      symbol,
      bids: raw.bids.slice(0, depth).map(entry => [String(entry[0] ?? 0), String(entry[1] ?? 0)] as [string, string]),
      asks: raw.asks.slice(0, depth).map(entry => [String(entry[0] ?? 0), String(entry[1] ?? 0)] as [string, string]),
      timestamp: raw.timestamp ?? Date.now(),
    };
  }

  /** Fetch OHLCV candles — primary use: backtesting data */
  async getOHLCV(
    exchange: SupportedExchange,
    symbol: string,
    timeframe: string = '1h',
    limit: number = 100,
  ): Promise<OHLCVCandle[]> {
    const ex = this.client.getInstance(exchange);
    const raw = await ex.fetchOHLCV(symbol, timeframe, undefined, limit);
    // OHLCV tuple: [timestamp, open, high, low, close, volume]
    type OHLCVTuple = [number, number, number, number, number, number];
    return (raw as OHLCVTuple[]).map(candle => ({
      timestamp: candle[0] ?? 0,
      open: String(candle[1] ?? 0),
      high: String(candle[2] ?? 0),
      low: String(candle[3] ?? 0),
      close: String(candle[4] ?? 0),
      volume: String(candle[5] ?? 0),
    }));
  }

  /** Fetch perpetual futures funding rate — key for funding-rate-arb strategy */
  async getFundingRate(
    exchange: SupportedExchange,
    symbol: string,
  ): Promise<FundingRate | null> {
    const ex = this.client.getInstance(exchange);

    if (!ex.has['fetchFundingRate']) {
      logger.warn('Exchange does not support funding rates', 'MarketData', { exchange });
      return null;
    }

    try {
      const raw = await ex.fetchFundingRate(symbol);
      return {
        exchange,
        symbol,
        rate: String(raw.fundingRate ?? 0),
        nextFundingTime: raw.fundingDatetime
          ? new Date(raw.fundingDatetime).getTime()
          : (raw.nextFundingDatetime
            ? new Date(raw.nextFundingDatetime).getTime()
            : Date.now() + 8 * 3600 * 1000),
      };
    } catch (err) {
      logger.error('Failed to fetch funding rate', 'MarketData', {
        exchange, symbol, error: String(err),
      });
      return null;
    }
  }

  /** Compare prices for a symbol across multiple exchanges */
  async getCrossExchangePrices(
    exchanges: SupportedExchange[],
    symbol: string,
  ): Promise<CrossExchangePrice[]> {
    const results = await Promise.allSettled(
      exchanges.map(async ex => {
        const ticker = await this.client.getTicker(ex, symbol);
        const bidNum = parseFloat(ticker.bid);
        const askNum = parseFloat(ticker.ask);
        const mid = ((bidNum + askNum) / 2).toFixed(8);
        return { exchange: ex, symbol, bid: ticker.bid, ask: ticker.ask, mid };
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<CrossExchangePrice> => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /** Find best spread opportunity across exchanges for a symbol */
  getBestSpread(prices: CrossExchangePrice[]): PriceSpread | null {
    if (prices.length < 2) return null;

    let bestSpread = -Infinity;
    let result: PriceSpread | null = null;

    for (let i = 0; i < prices.length; i++) {
      for (let j = 0; j < prices.length; j++) {
        if (i === j) continue;
        const buyAt = parseFloat(prices[i].ask);   // buy on exchange i
        const sellAt = parseFloat(prices[j].bid);  // sell on exchange j
        const spreadPct = ((sellAt - buyAt) / buyAt) * 100;

        if (spreadPct > bestSpread) {
          bestSpread = spreadPct;
          result = {
            highExchange: prices[j].exchange,
            lowExchange: prices[i].exchange,
            symbol: prices[i].symbol,
            spreadPercent: spreadPct.toFixed(4),
            highAsk: prices[i].ask,
            lowBid: prices[j].bid,
          };
        }
      }
    }
    return result;
  }

  /**
   * Poll prices for a symbol at given interval — emits via callback.
   * Returns a stop function to cancel polling.
   */
  startPricePolling(
    exchange: SupportedExchange,
    symbol: string,
    intervalMs: number,
    onTick: (price: CrossExchangePrice) => void,
  ): () => void {
    let running = true;

    const poll = async () => {
      while (running) {
        try {
          const ticker = await this.client.getTicker(exchange, symbol);
          const bidNum = parseFloat(ticker.bid);
          const askNum = parseFloat(ticker.ask);
          onTick({
            exchange,
            symbol,
            bid: ticker.bid,
            ask: ticker.ask,
            mid: ((bidNum + askNum) / 2).toFixed(8),
          });
        } catch (err) {
          logger.warn('Price poll failed', 'MarketData', { exchange, symbol, error: String(err) });
        }
        await sleep(intervalMs);
      }
    };

    poll();
    return () => { running = false; };
  }
}
