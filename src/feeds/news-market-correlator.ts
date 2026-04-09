/**
 * News Market Correlator
 * Matches news headlines to relevant Polymarket markets via keyword pre-filter,
 * then calls news-impact-analyzer for DeepSeek scoring.
 * Publishes results to NATS topic `intelligence.news.impact`.
 */

import { fetchNewsItems, analyzeNewsImpact, purgeExpiredCache } from './news-impact-analyzer';
import type { NewsItem, NewsImpactResult, ActiveMarket } from './news-impact-analyzer';
import { getMessageBus } from '../messaging/index';
import { logger } from '../utils/logger';

// Define locally — do NOT modify topic-schema.ts
const INTELLIGENCE_NEWS_IMPACT = 'intelligence.news.impact';

// ---------------------------------------------------------------------------
// Keyword pre-filter (reduces expensive DeepSeek calls)
// ---------------------------------------------------------------------------

/** Extract significant tokens from a headline (lowercase, min 4 chars, alpha only) */
function extractKeywords(text: string): Set<string> {
  const STOP_WORDS = new Set(['that','this','with','from','they','will','have',
    'been','when','what','which','were','their','said','more','than','about']);
  return new Set(
    text.toLowerCase()
      .split(/\W+/)
      .filter(w => w.length >= 4 && !STOP_WORDS.has(w)),
  );
}

/**
 * Pre-filter markets by keyword overlap with headline.
 * Returns markets that share at least one significant token with the headline,
 * plus a small random sample of others to avoid missing semantic matches.
 */
export function preFilterMarkets(headline: string, markets: ActiveMarket[]): ActiveMarket[] {
  const headlineKw = extractKeywords(headline);
  if (headlineKw.size === 0) return markets.slice(0, 20);

  const matched: ActiveMarket[] = [];
  const unmatched: ActiveMarket[] = [];

  for (const market of markets) {
    const marketKw = extractKeywords(market.question);
    const overlap = [...headlineKw].some(kw => marketKw.has(kw));
    if (overlap) matched.push(market);
    else unmatched.push(market);
  }

  // Include up to 5 unmatched markets as semantic safety net (DeepSeek catches semantic matches)
  const safetyNet = unmatched.slice(0, 5);

  logger.debug('[NewsMarketCorrelator] Pre-filter result', {
    headline: headline.slice(0, 60),
    matched: matched.length,
    safetyNet: safetyNet.length,
  });

  return [...matched, ...safetyNet];
}

// ---------------------------------------------------------------------------
// NATS publish helper
// ---------------------------------------------------------------------------

async function publishImpact(result: NewsImpactResult): Promise<void> {
  try {
    const bus = getMessageBus();
    if (!bus.isConnected()) return;
    await bus.publish(INTELLIGENCE_NEWS_IMPACT, result, 'news-correlator');
    logger.debug('[NewsMarketCorrelator] Published impact', {
      title: result.newsItem.title.slice(0, 60),
      affected: result.impacts.length,
    });
  } catch (err) {
    // Non-fatal — caller still receives result
    logger.warn('[NewsMarketCorrelator] NATS publish failed', { err });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CorrelatorRunOptions {
  /** Active Polymarket markets to correlate against */
  markets: ActiveMarket[];
  /** If true, publish results to NATS (default: true) */
  publish?: boolean;
  /** Max news items to process per run (default: 10) */
  maxItems?: number;
}

export interface CorrelatorRunResult {
  processed: number;
  totalImpacts: number;
  results: NewsImpactResult[];
}

/**
 * Run full correlation pipeline:
 * 1. Fetch news items
 * 2. Pre-filter markets per headline (keyword match)
 * 3. Call DeepSeek for impact scoring (cached)
 * 4. Publish to NATS
 */
export async function runNewsMarketCorrelation(
  options: CorrelatorRunOptions,
): Promise<CorrelatorRunResult> {
  const { markets, publish = true, maxItems = 10 } = options;
  purgeExpiredCache();

  logger.info('[NewsMarketCorrelator] Starting correlation run', {
    totalMarkets: markets.length,
    maxItems,
  });

  let newsItems: NewsItem[] = [];
  try {
    newsItems = (await fetchNewsItems()).slice(0, maxItems);
  } catch (err) {
    logger.error('[NewsMarketCorrelator] Failed to fetch news', { err });
    return { processed: 0, totalImpacts: 0, results: [] };
  }

  if (newsItems.length === 0) {
    logger.info('[NewsMarketCorrelator] No news items to process');
    return { processed: 0, totalImpacts: 0, results: [] };
  }

  const results: NewsImpactResult[] = [];

  for (const item of newsItems) {
    const candidateMarkets = preFilterMarkets(item.title, markets);
    if (candidateMarkets.length === 0) {
      logger.debug('[NewsMarketCorrelator] No candidate markets', { title: item.title });
      continue;
    }

    const result = await analyzeNewsImpact(item, candidateMarkets);

    if (result.impacts.length > 0) {
      results.push(result);
      if (publish) await publishImpact(result);
    }
  }

  const totalImpacts = results.reduce((sum, r) => sum + r.impacts.length, 0);

  logger.info('[NewsMarketCorrelator] Correlation run complete', {
    processed: newsItems.length,
    withImpacts: results.length,
    totalImpacts,
  });

  return { processed: newsItems.length, totalImpacts, results };
}

/**
 * Correlate a single news headline against markets without fetching from feeds.
 * Useful for ad-hoc or streaming news sources.
 */
export async function correlateHeadline(
  headline: string,
  description: string | undefined,
  markets: ActiveMarket[],
  publish = true,
): Promise<NewsImpactResult> {
  const newsItem: NewsItem = {
    title: headline,
    description,
    publishedAt: Date.now(),
    source: 'direct',
  };

  const candidateMarkets = preFilterMarkets(headline, markets);
  const result = await analyzeNewsImpact(newsItem, candidateMarkets);

  if (result.impacts.length > 0 && publish) {
    await publishImpact(result);
  }

  return result;
}
