// Scan Polymarket markets for arbitrage and spread opportunities
// Binary markets: YES + NO token prices should sum to ~1.0 (USDC)
import type { ClobClient, RawMarket } from './clob-client.js';
import { logger } from '../core/logger.js';
import { safeParseFloat } from '../core/utils.js';

const MIN_VOLUME_USDC = 1_000;    // $1K daily volume minimum
const MIN_SPREAD_PCT = 0.02;      // 2% spread threshold for arb detection
const MAX_PRICE_SUM_DELTA = 0.05; // YES+NO should be within 5 cents of 1.0

export interface MarketOpportunity {
  conditionId: string;
  description: string;
  yesTokenId: string;
  noTokenId: string;
  yesMidPrice: number;
  noMidPrice: number;
  priceSum: number;
  /** Deviation from 1.0: positive = overpriced, negative = underpriced */
  priceSumDelta: number;
  yesSpread: number;
  noSpread: number;
  volume: number;
  /** Score: higher = more attractive */
  score: number;
}

export interface ScanResult {
  scannedAt: number;
  totalMarkets: number;
  activeMarkets: number;
  opportunities: MarketOpportunity[];
}

export class MarketScanner {
  constructor(private client: ClobClient) {}

  /** Scan all active markets and return ranked opportunities */
  async scan(options: { minVolume?: number; minSpreadPct?: number } = {}): Promise<ScanResult> {
    const minVolume = options.minVolume ?? MIN_VOLUME_USDC;
    const minSpread = options.minSpreadPct ?? MIN_SPREAD_PCT;

    logger.info('Starting market scan', 'MarketScanner');
    const rawMarkets = await this.fetchRawMarkets();
    const active = rawMarkets.filter(m => m.active && safeParseFloat(m.volume) >= minVolume);

    logger.debug('Filtered markets', 'MarketScanner', { total: rawMarkets.length, active: active.length });

    const opportunities: MarketOpportunity[] = [];

    for (const market of active) {
      const opp = await this.analyzeMarket(market).catch(err => {
        logger.warn('Failed to analyze market', 'MarketScanner', {
          conditionId: market.condition_id,
          err: String(err),
        });
        return null;
      });
      if (opp && this.isOpportunity(opp, minSpread)) {
        opportunities.push(opp);
      }
    }

    // Rank by score descending
    opportunities.sort((a, b) => b.score - a.score);

    logger.info('Scan complete', 'MarketScanner', { opportunities: opportunities.length });
    return {
      scannedAt: Date.now(),
      totalMarkets: rawMarkets.length,
      activeMarkets: active.length,
      opportunities,
    };
  }

  /** Get top N opportunities from a fresh scan */
  async getTopOpportunities(n: number = 10): Promise<MarketOpportunity[]> {
    const result = await this.scan();
    return result.opportunities.slice(0, n);
  }

  private async fetchRawMarkets(): Promise<RawMarket[]> {
    // ClobClient.getMarkets returns mapped MarketInfo; we need raw for token IDs
    // Fetch directly to preserve token metadata
    const res = await fetch('https://clob.polymarket.com/markets', {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Failed to fetch markets: ${res.status}`);
    return res.json() as Promise<RawMarket[]>;
  }

  private async analyzeMarket(market: RawMarket): Promise<MarketOpportunity | null> {
    const yesToken = market.tokens.find(t => t.outcome === 'Yes');
    const noToken = market.tokens.find(t => t.outcome === 'No');
    if (!yesToken || !noToken) return null;

    const [yesPrice, noPrice] = await Promise.all([
      this.client.getPrice(yesToken.token_id),
      this.client.getPrice(noToken.token_id),
    ]);

    const yesMid = safeParseFloat(yesPrice.mid);
    const noMid = safeParseFloat(noPrice.mid);
    const yesBid = safeParseFloat(yesPrice.bid);
    const yesAsk = safeParseFloat(yesPrice.ask);
    const noBid = safeParseFloat(noPrice.bid);
    const noAsk = safeParseFloat(noPrice.ask);

    const priceSum = yesMid + noMid;
    const priceSumDelta = priceSum - 1.0;
    const yesSpread = yesAsk - yesBid;
    const noSpread = noAsk - noBid;
    const volume = safeParseFloat(market.volume);

    // Score = |delta| * volume weight - spread penalty
    const score = Math.abs(priceSumDelta) * Math.log10(Math.max(volume, 1)) - (yesSpread + noSpread);

    return {
      conditionId: market.condition_id,
      description: market.description,
      yesTokenId: yesToken.token_id,
      noTokenId: noToken.token_id,
      yesMidPrice: yesMid,
      noMidPrice: noMid,
      priceSum,
      priceSumDelta,
      yesSpread,
      noSpread,
      volume,
      score,
    };
  }

  private isOpportunity(opp: MarketOpportunity, minSpreadPct: number): boolean {
    const hasArb = Math.abs(opp.priceSumDelta) > MAX_PRICE_SUM_DELTA;
    const hasSpread = opp.yesSpread > minSpreadPct || opp.noSpread > minSpreadPct;
    return hasArb || hasSpread;
  }
}
