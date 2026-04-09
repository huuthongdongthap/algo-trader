/**
 * News Impact Analyzer
 * Fetches news from RSS/API sources, calls DeepSeek to assess Polymarket market impact.
 * Publishes impact scores via news-market-correlator.
 *
 * Env: NEWS_FEED_URLS (comma-separated RSS/JSON API URLs)
 */

import { loadLlmConfig } from '../config/llm-config';
import { logger } from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsItem {
  title: string;
  description?: string;
  url?: string;
  publishedAt: number;
  source: string;
}

export interface MarketImpact {
  marketId: string;
  impactDirection: 'UP' | 'DOWN' | 'NEUTRAL';
  magnitude: number; // 0–1
  reasoning: string;
}

export interface NewsImpactResult {
  newsItem: NewsItem;
  impacts: MarketImpact[];
  analyzedAt: number;
}

export interface ActiveMarket {
  id: string;
  question: string;
  slug?: string;
}

// ---------------------------------------------------------------------------
// In-memory cache (5-min TTL keyed by headline slug)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const analysisCache = new Map<string, { result: NewsImpactResult; expiresAt: number }>();

const cacheKey = (h: string) => h.toLowerCase().replace(/\W+/g, '-').slice(0, 80);

function getFromCache(key: string): NewsImpactResult | null {
  const entry = analysisCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { analysisCache.delete(key); return null; }
  return entry.result;
}

const setInCache = (key: string, result: NewsImpactResult) =>
  analysisCache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });

// ---------------------------------------------------------------------------
// DeepSeek API call
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a prediction market analyst. Given a news headline and a list of active Polymarket markets, identify which markets are affected by the news.

Respond ONLY with a JSON array. Each element must have:
- marketId: string (the market's ID from the input list)
- impactDirection: "UP" | "DOWN" | "NEUTRAL"
- magnitude: number from 0.0 to 1.0 (how strongly the market is affected)
- reasoning: string (one sentence max)

Only include markets with magnitude >= 0.1. Output nothing else.`;

async function callDeepSeekForImpact(
  newsItem: NewsItem,
  markets: ActiveMarket[],
): Promise<MarketImpact[]> {
  const llmConfig = loadLlmConfig();
  const { url: llmUrl, model: llmModel, timeoutMs } = llmConfig.primary;

  const marketList = markets
    .map(m => `ID: ${m.id} | Question: ${m.question}`)
    .join('\n');

  const userContent = `News headline: "${newsItem.title}"${newsItem.description ? `\nDescription: "${newsItem.description}"` : ''}

Active Polymarket markets:
${marketList}

Which of these markets are affected by this news?`;

  const body = {
    model: llmModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 1024,
  };

  const resp = await fetch(`${llmUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    throw new Error(`LLM API error: HTTP ${resp.status}`);
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? '[]';

  // Extract JSON array from response (model may wrap in markdown)
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) return [];

  const parsed = JSON.parse(match[0]) as unknown[];
  return parsed.filter(
    (item): item is MarketImpact =>
      typeof item === 'object' && item !== null &&
      'marketId' in item && 'impactDirection' in item && 'magnitude' in item,
  );
}

// ---------------------------------------------------------------------------
// RSS fetch (minimal parser — no external xml2js dependency)
// ---------------------------------------------------------------------------

function parseXmlField(block: string, tag: string): string {
  return block.match(new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, 'i'))?.[1]
    ?? block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))?.[1]
    ?? '';
}

async function fetchRssFeed(url: string): Promise<NewsItem[]> {
  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) return [];
  const xml = await resp.text();
  const hostname = new URL(url).hostname;

  return (xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? []).slice(0, 20).flatMap(block => {
    const title = parseXmlField(block, 'title').trim();
    if (!title) return [];
    const desc = parseXmlField(block, 'description').replace(/<[^>]+>/g, '').trim().slice(0, 300);
    const pubDate = parseXmlField(block, 'pubDate');
    return [{
      title,
      description: desc || undefined,
      url: parseXmlField(block, 'link').trim() || undefined,
      publishedAt: pubDate ? new Date(pubDate).getTime() : Date.now(),
      source: hostname,
    }];
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Fetch news items from all configured feed URLs */
export async function fetchNewsItems(): Promise<NewsItem[]> {
  const feedUrls = (process.env['NEWS_FEED_URLS'] ?? '').split(',').map(s => s.trim()).filter(Boolean);
  if (feedUrls.length === 0) {
    logger.warn('[NewsImpactAnalyzer] No NEWS_FEED_URLS configured');
    return [];
  }

  const results = await Promise.allSettled(feedUrls.map(url => fetchRssFeed(url)));
  const items: NewsItem[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') items.push(...r.value);
    else logger.warn('[NewsImpactAnalyzer] Feed fetch failed', { reason: r.reason });
  }

  // Deduplicate by title
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Analyze a single news item against a list of active markets.
 * Results are cached for 5 minutes to avoid duplicate DeepSeek calls.
 */
export async function analyzeNewsImpact(
  newsItem: NewsItem,
  markets: ActiveMarket[],
): Promise<NewsImpactResult> {
  const key = cacheKey(newsItem.title);
  const cached = getFromCache(key);
  if (cached) {
    logger.debug('[NewsImpactAnalyzer] Cache hit', { title: newsItem.title });
    return cached;
  }

  let impacts: MarketImpact[] = [];
  try {
    impacts = await callDeepSeekForImpact(newsItem, markets);
    logger.info('[NewsImpactAnalyzer] Impact analyzed', {
      title: newsItem.title,
      affectedMarkets: impacts.length,
    });
  } catch (err) {
    logger.error('[NewsImpactAnalyzer] DeepSeek call failed', { err, title: newsItem.title });
  }

  const result: NewsImpactResult = { newsItem, impacts, analyzedAt: Date.now() };
  setInCache(key, result);
  return result;
}

/** Clear expired cache entries (call periodically if running long) */
export function purgeExpiredCache(): void {
  const now = Date.now();
  for (const [key, entry] of analysisCache) {
    if (now > entry.expiresAt) analysisCache.delete(key);
  }
}
