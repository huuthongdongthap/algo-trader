// Scan Kalshi markets and find cross-platform arb opportunities vs Polymarket
// Matches markets by keyword similarity, compares YES prices (both normalized 0-1)
import type { KalshiClient, KalshiMarket } from './kalshi-client.js';
import { logger } from '../core/logger.js';

const MIN_SPREAD_THRESHOLD = 0.03; // 3% minimum spread to flag as opportunity
const MIN_KALSHI_VOLUME = 100;     // minimum contract volume

export interface CrossPlatformOpportunity {
  kalshiMarket: KalshiMarket;
  polymarketConditionId: string;
  /** Kalshi YES mid price normalized 0-1 */
  kalshiPrice: number;
  /** Polymarket YES mid price 0-1 */
  polymarketPrice: number;
  /** Absolute price difference */
  spread: number;
  /** 'buy-kalshi' = Kalshi cheaper; 'buy-polymarket' = Polymarket cheaper */
  direction: 'buy-kalshi' | 'buy-polymarket';
}

/** Minimal Polymarket price map passed in by caller */
export type PolymarketPriceMap = Map<string, { conditionId: string; title: string; midPrice: number }>;

export class KalshiMarketScanner {
  constructor(private client: KalshiClient) {}

  /** Fetch all open Kalshi markets with sufficient volume */
  async scanMarkets(): Promise<KalshiMarket[]> {
    logger.info('Scanning Kalshi markets', 'KalshiMarketScanner');
    const markets = await this.client.getMarkets({ status: 'open', limit: 200 });
    const active = markets.filter(m => m.status === 'open' && m.volume >= MIN_KALSHI_VOLUME);
    logger.debug('Kalshi active markets', 'KalshiMarketScanner', { count: active.length });
    return active;
  }

  /**
   * Find arbitrage opportunities between Kalshi and Polymarket.
   * polymarketPrices: map of keyword -> { conditionId, title, midPrice 0-1 }
   */
  async findArbOpportunities(
    polymarketPrices: PolymarketPriceMap,
  ): Promise<CrossPlatformOpportunity[]> {
    const kalshiMarkets = await this.scanMarkets();
    const opportunities: CrossPlatformOpportunity[] = [];

    const polyEntries = Array.from(polymarketPrices.values());

    for (const km of kalshiMarkets) {
      const match = this.matchMarket(km, polyEntries);
      if (!match) continue;

      // Kalshi prices are in cents (0-99), normalize to 0-1
      const kalshiMid = ((km.yes_bid + km.yes_ask) / 2) / 100;
      const polyMid = match.midPrice;

      const spread = Math.abs(kalshiMid - polyMid);
      if (spread < MIN_SPREAD_THRESHOLD) continue;

      const direction: CrossPlatformOpportunity['direction'] =
        kalshiMid < polyMid ? 'buy-kalshi' : 'buy-polymarket';

      opportunities.push({
        kalshiMarket: km,
        polymarketConditionId: match.conditionId,
        kalshiPrice: kalshiMid,
        polymarketPrice: polyMid,
        spread,
        direction,
      });

      logger.debug('Arb opportunity found', 'KalshiMarketScanner', {
        ticker: km.ticker,
        spread: spread.toFixed(4),
        direction,
      });
    }

    // Rank by spread descending
    opportunities.sort((a, b) => b.spread - a.spread);
    logger.info('Arb scan complete', 'KalshiMarketScanner', { opportunities: opportunities.length });
    return opportunities;
  }

  /**
   * Match a Kalshi market to a Polymarket entry by keyword overlap.
   * Splits titles into words, counts common tokens (case-insensitive, min 4 chars).
   */
  matchMarkets(
    kalshiMarkets: KalshiMarket[],
    polyEntries: Array<{ conditionId: string; title: string; midPrice: number }>,
  ): Map<string, { conditionId: string; title: string; midPrice: number }> {
    const result = new Map<string, { conditionId: string; title: string; midPrice: number }>();
    for (const km of kalshiMarkets) {
      const match = this.matchMarket(km, polyEntries);
      if (match) result.set(km.ticker, match);
    }
    return result;
  }

  // --- private helpers ---

  private matchMarket(
    km: KalshiMarket,
    polyEntries: Array<{ conditionId: string; title: string; midPrice: number }>,
  ): { conditionId: string; title: string; midPrice: number } | null {
    const kalshiWords = this.keywords(`${km.title} ${km.subtitle ?? ''}`);
    let bestScore = 0;
    let bestMatch: typeof polyEntries[number] | null = null;

    for (const entry of polyEntries) {
      const polyWords = this.keywords(entry.title);
      const common = kalshiWords.filter(w => polyWords.includes(w)).length;
      const score = common / Math.max(kalshiWords.length, polyWords.length, 1);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = entry;
      }
    }

    // Require at least 30% keyword overlap
    return bestScore >= 0.3 ? bestMatch : null;
  }

  private keywords(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 4);
  }
}
