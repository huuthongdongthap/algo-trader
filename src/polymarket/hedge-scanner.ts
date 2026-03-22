// Hedge Scanner: wires PolyClaw hedge-discovery into the Polymarket trading pipeline
// Uses GammaClient for market browsing + AiRouter for LLM implication analysis
// Produces ranked HedgePortfolio[] for a given target market

import { GammaClient, type GammaMarket } from './gamma-client.js';
import { scanForHedges } from './hedge-discovery.js';
import { sortPortfolios, filterByTier, type HedgePortfolio } from './hedge-coverage.js';
import type { AiRouter } from '../openclaw/ai-router.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HedgeScanConfig {
  /** Max related markets to send to LLM (controls cost) */
  maxRelatedMarkets?: number;
  /** Maximum tier to include (1=HIGH only, 2=+GOOD, 3=+MODERATE, 4=all) */
  maxTier?: number;
  /** Gamma API timeout in ms */
  gammaTimeout?: number;
}

export interface HedgeScanResult {
  targetMarket: GammaMarket;
  portfolios: HedgePortfolio[];
  marketsScanned: number;
  scannedAt: number;
}

const DEFAULTS: Required<HedgeScanConfig> = {
  maxRelatedMarkets: 30,
  maxTier: 3,
  gammaTimeout: 15_000,
};

// ---------------------------------------------------------------------------
// HedgeScanner
// ---------------------------------------------------------------------------

export class HedgeScanner {
  private readonly gamma: GammaClient;
  private readonly ai: AiRouter;
  private readonly config: Required<HedgeScanConfig>;

  constructor(ai: AiRouter, config: HedgeScanConfig = {}) {
    this.ai = ai;
    this.config = { ...DEFAULTS, ...config };
    this.gamma = new GammaClient(this.config.gammaTimeout);
  }

  /**
   * Scan for hedge opportunities for a given market slug.
   * 1. Fetch target market from Gamma API
   * 2. Fetch trending markets as potential hedges
   * 3. Use LLM to find logical implications
   * 4. Build and rank portfolios
   */
  async scanBySlug(slug: string): Promise<HedgeScanResult> {
    logger.info('Starting hedge scan', 'HedgeScanner', { slug });

    const targetMarket = await this.gamma.getMarketBySlug(slug);
    return this.scanForMarket(targetMarket);
  }

  /**
   * Scan for hedge opportunities given a target GammaMarket object.
   */
  async scanForMarket(targetMarket: GammaMarket): Promise<HedgeScanResult> {
    const otherMarkets = await this.fetchRelatedMarkets(targetMarket.id);

    logger.debug('Calling LLM for implication analysis', 'HedgeScanner', {
      target: targetMarket.question,
      candidates: otherMarkets.length,
    });

    const portfolios = await scanForHedges(targetMarket, otherMarkets, this.ai);
    const sorted = sortPortfolios(filterByTier(portfolios, this.config.maxTier));

    logger.info('Hedge scan complete', 'HedgeScanner', {
      target: targetMarket.question,
      portfoliosFound: sorted.length,
    });

    return {
      targetMarket,
      portfolios: sorted,
      marketsScanned: otherMarkets.length,
      scannedAt: Date.now(),
    };
  }

  /**
   * Batch scan: find hedges for multiple markets at once.
   * Useful for portfolio-wide hedge analysis.
   */
  async scanMultiple(slugs: string[]): Promise<HedgeScanResult[]> {
    const results: HedgeScanResult[] = [];
    for (const slug of slugs) {
      const result = await this.scanBySlug(slug).catch(err => {
        logger.warn('Hedge scan failed for market', 'HedgeScanner', {
          slug, error: String(err),
        });
        return null;
      });
      if (result) results.push(result);
    }
    return results;
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async fetchRelatedMarkets(excludeId: string): Promise<GammaMarket[]> {
    const trending = await this.gamma.getTrending(this.config.maxRelatedMarkets + 10);
    return trending
      .filter(m => m.id !== excludeId && m.active && !m.resolved)
      .slice(0, this.config.maxRelatedMarkets);
  }
}
