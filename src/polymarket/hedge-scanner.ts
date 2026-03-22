// Hedge Scanner: wires PolyClaw hedge-discovery into the Polymarket trading pipeline
// Uses GammaClient for market browsing + AiRouter for LLM implication analysis
// Produces ranked HedgePortfolio[] for a given target market
// Includes in-memory LLM cache (TTL-based) to reduce API costs by ~70%

import { GammaClient, type GammaMarket } from './gamma-client.js';
import { scanForHedges } from './hedge-discovery.js';
import { sortPortfolios, filterByTier, type HedgePortfolio } from './hedge-coverage.js';
import type { AiRouter } from '../openclaw/ai-router.js';
import type { KellyPositionSizer, SizingResult } from './kelly-position-sizer.js';
import { logger } from '../core/logger.js';
import { createHash } from 'crypto';

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
  /** LLM cache TTL in ms (default 30 min) */
  cacheTtlMs?: number;
  /** Max concurrent LLM calls for batch scan */
  concurrency?: number;
}

export interface HedgeScanResult {
  targetMarket: GammaMarket;
  portfolios: HedgePortfolio[];
  marketsScanned: number;
  scannedAt: number;
  cached: boolean;
}

interface CacheEntry {
  portfolios: HedgePortfolio[];
  marketsScanned: number;
  expiresAt: number;
}

const DEFAULTS: Required<HedgeScanConfig> = {
  maxRelatedMarkets: 30,
  maxTier: 3,
  gammaTimeout: 15_000,
  cacheTtlMs: 30 * 60_000, // 30 minutes
  concurrency: 3,
};

// ---------------------------------------------------------------------------
// HedgeScanner
// ---------------------------------------------------------------------------

export class HedgeScanner {
  private readonly gamma: GammaClient;
  private readonly ai: AiRouter;
  private readonly config: Required<HedgeScanConfig>;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(ai: AiRouter, config: HedgeScanConfig = {}) {
    this.ai = ai;
    this.config = { ...DEFAULTS, ...config };
    this.gamma = new GammaClient(this.config.gammaTimeout);
  }

  /** Get number of cached entries */
  getCacheSize(): number { return this.cache.size; }

  /** Clear LLM cache */
  clearCache(): void { this.cache.clear(); }

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
    const cacheKey = this.buildCacheKey(targetMarket.id, otherMarkets);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('LLM cache hit', 'HedgeScanner', { target: targetMarket.question });
      return {
        targetMarket,
        portfolios: cached.portfolios,
        marketsScanned: cached.marketsScanned,
        scannedAt: Date.now(),
        cached: true,
      };
    }

    logger.debug('Calling LLM for implication analysis', 'HedgeScanner', {
      target: targetMarket.question,
      candidates: otherMarkets.length,
    });

    const portfolios = await scanForHedges(targetMarket, otherMarkets, this.ai);
    const sorted = sortPortfolios(filterByTier(portfolios, this.config.maxTier));

    // Store in cache
    this.cache.set(cacheKey, {
      portfolios: sorted,
      marketsScanned: otherMarkets.length,
      expiresAt: Date.now() + this.config.cacheTtlMs,
    });
    this.pruneExpiredCache();

    logger.info('Hedge scan complete', 'HedgeScanner', {
      target: targetMarket.question,
      portfoliosFound: sorted.length,
    });

    return {
      targetMarket,
      portfolios: sorted,
      marketsScanned: otherMarkets.length,
      scannedAt: Date.now(),
      cached: false,
    };
  }

  /**
   * Batch scan: find hedges for multiple markets at once.
   * Respects concurrency limit to avoid overwhelming LLM.
   */
  async scanMultiple(slugs: string[]): Promise<HedgeScanResult[]> {
    const results: HedgeScanResult[] = [];
    const queue = [...slugs];

    while (queue.length > 0) {
      const batch = queue.splice(0, this.config.concurrency);
      const batchResults = await Promise.allSettled(
        batch.map(slug => this.scanBySlug(slug)),
      );
      for (const r of batchResults) {
        if (r.status === 'fulfilled') {
          results.push(r.value);
        } else {
          logger.warn('Hedge scan failed for market', 'HedgeScanner', {
            error: String(r.reason),
          });
        }
      }
    }
    return results;
  }

  /**
   * Scan top trending markets for hedge opportunities.
   * Convenience method: fetches trending → scans each as target.
   */
  async scanTopMarkets(limit = 10): Promise<HedgeScanResult[]> {
    const trending = await this.gamma.getTrending(limit);
    const results: HedgeScanResult[] = [];

    for (const target of trending) {
      const result = await this.scanForMarket(target).catch(err => {
        logger.warn('Hedge scan failed', 'HedgeScanner', {
          target: target.question, error: String(err),
        });
        return null;
      });
      if (result && result.portfolios.length > 0) results.push(result);
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

  private buildCacheKey(targetId: string, others: GammaMarket[]): string {
    const ids = others.map(m => m.id).sort().join(',');
    return createHash('md5').update(`${targetId}:${ids}`).digest('hex');
  }

  /**
   * Size hedge portfolios using Kelly Criterion.
   * Attaches optimal position size to each portfolio.
   */
  sizePortfolios(
    portfolios: HedgePortfolio[],
    kellySizer: KellyPositionSizer,
    strategy = 'polyclaw-hedge',
  ): SizedHedge[] {
    const sizing = kellySizer.getSize(strategy);

    return portfolios.map(p => ({
      ...p,
      sizeUsdc: sizing.size,
      sizingMethod: sizing.method,
      kellyFraction: sizing.kellyAdjusted,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────

  private pruneExpiredCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) this.cache.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Sized hedge type
// ---------------------------------------------------------------------------

export interface SizedHedge extends HedgePortfolio {
  sizeUsdc: number;
  sizingMethod: SizingResult['method'];
  kellyFraction: number;
}
