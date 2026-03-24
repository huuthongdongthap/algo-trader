// Polymarket Gamma API client — ported from PolyClaw (chainstacklabs/polyclaw)
// HTTP client for browsing markets, searching, and fetching live prices

import { CircuitBreaker } from '../resilience/circuit-breaker.js';
import { rateLimiterRegistry } from '../resilience/rate-limiter.js';
import { resilientFetch } from '../resilience/resilient-fetch.js';
import type { TokenBucket } from '../resilience/rate-limiter.js';

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string | null;
  yesPrice: number;
  noPrice: number;
  volume: number;
  volume24h: number;
  liquidity: number;
  endDate: string;
  active: boolean;
  closed: boolean;
  resolved: boolean;
  outcome: string | null;
}

export interface GammaMarketGroup {
  id: string;
  title: string;
  slug: string;
  description: string;
  markets: GammaMarket[];
}

// ---------------------------------------------------------------------------
// Parser (exported for testing)
// ---------------------------------------------------------------------------

/** Parse raw Gamma API market JSON into GammaMarket. */
export function parseMarket(data: Record<string, unknown>): GammaMarket {
  const clobTokens = parseJsonArray(data['clobTokenIds'] as string | undefined);
  const prices = parseJsonArray(data['outcomePrices'] as string | undefined, ['0.5', '0.5']);

  return {
    id: String(data['id'] ?? ''),
    question: String(data['question'] ?? ''),
    slug: String(data['slug'] ?? ''),
    conditionId: String(data['conditionId'] ?? ''),
    yesTokenId: clobTokens[0] ?? '',
    noTokenId: clobTokens[1] ?? null,
    yesPrice: parseFloat(String(prices[0] ?? '0.5')),
    noPrice: parseFloat(String(prices[1] ?? '0.5')),
    volume: toFloat(data['volume']),
    volume24h: toFloat(data['volume24hr']),
    liquidity: toFloat(data['liquidity']),
    endDate: String(data['endDate'] ?? ''),
    active: Boolean(data['active'] ?? true),
    closed: Boolean(data['closed'] ?? false),
    resolved: Boolean(data['resolved'] ?? false),
    outcome: data['outcome'] != null ? String(data['outcome']) : null,
  };
}

/** Parse raw Gamma API event JSON into GammaMarketGroup. */
export function parseEvent(data: Record<string, unknown>): GammaMarketGroup {
  const markets = Array.isArray(data['markets']) ? data['markets'] : [];
  return {
    id: String(data['id'] ?? ''),
    title: String(data['title'] ?? ''),
    slug: String(data['slug'] ?? ''),
    description: String(data['description'] ?? ''),
    markets: markets.map((m: Record<string, unknown>) => parseMarket(m)),
  };
}

// ---------------------------------------------------------------------------
// GammaClient
// ---------------------------------------------------------------------------

export class GammaClient {
  private readonly timeout: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly rateLimiter: TokenBucket;

  constructor(timeout = 30_000) {
    this.timeout = timeout;
    this.circuitBreaker = new CircuitBreaker({
      name: 'gamma-api',
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxAttempts: 2,
    });
    this.rateLimiter = rateLimiterRegistry.getOrCreate('polymarket');
  }

  /** Get trending markets by 24h volume. */
  async getTrending(limit = 20): Promise<GammaMarket[]> {
    const params = new URLSearchParams({
      closed: 'false', limit: String(limit),
      order: 'volume24hr', ascending: 'false',
    });
    const data = await this.fetchJson(`${GAMMA_API_BASE}/markets?${params}`);
    return (data as Record<string, unknown>[]).map(parseMarket);
  }

  /** Search markets by keyword (client-side filter — Gamma has no server search). */
  async search(query: string, limit = 20): Promise<GammaMarket[]> {
    const fetchLimit = Math.max(500, limit * 10);
    const params = new URLSearchParams({
      closed: 'false', limit: String(fetchLimit),
      order: 'volume24hr', ascending: 'false',
    });
    const data = await this.fetchJson(`${GAMMA_API_BASE}/markets?${params}`);
    const queryLower = query.toLowerCase();
    const matches: GammaMarket[] = [];

    for (const raw of data as Record<string, unknown>[]) {
      const question = String(raw['question'] ?? '').toLowerCase();
      const slug = String(raw['slug'] ?? '').toLowerCase();
      if (question.includes(queryLower) || slug.includes(queryLower)) {
        matches.push(parseMarket(raw));
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }

  /** Get single market by ID. */
  async getMarket(marketId: string): Promise<GammaMarket> {
    const data = await this.fetchJson(`${GAMMA_API_BASE}/markets/${marketId}`);
    return parseMarket(data as Record<string, unknown>);
  }

  /** Get market by slug. */
  async getMarketBySlug(slug: string): Promise<GammaMarket> {
    const params = new URLSearchParams({ slug });
    const data = await this.fetchJson(`${GAMMA_API_BASE}/markets?${params}`);
    const arr = data as Record<string, unknown>[];
    if (arr.length === 0) throw new Error(`Market not found: ${slug}`);
    return parseMarket(arr[0]);
  }

  /** Get events/groups with their markets. */
  async getEvents(limit = 20): Promise<GammaMarketGroup[]> {
    const params = new URLSearchParams({
      closed: 'false', limit: String(limit),
      order: 'volume24hr', ascending: 'false',
    });
    const data = await this.fetchJson(`${GAMMA_API_BASE}/events?${params}`);
    return (data as Record<string, unknown>[]).map(parseEvent);
  }

  /** Get current prices for token IDs from CLOB API. */
  async getPrices(tokenIds: string[]): Promise<Record<string, number>> {
    if (tokenIds.length === 0) return {};
    const params = new URLSearchParams({ token_ids: tokenIds.join(',') });
    const data = await this.fetchJson(`https://clob.polymarket.com/prices?${params}`);
    return data as Record<string, number>;
  }

  private async fetchJson(url: string): Promise<unknown> {
    const res = await resilientFetch(url, {}, {
      circuitBreaker: this.circuitBreaker,
      rateLimiter: this.rateLimiter,
      label: 'GammaClient',
      maxRetries: 3,
      timeoutMs: this.timeout,
    });
    if (!res.ok) throw new Error(`Gamma API error: ${res.status} ${res.statusText}`);
    return res.json();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseJsonArray(value: string | undefined, fallback: string[] = []): string[] {
  if (!value) return fallback;
  try { return JSON.parse(value) as string[]; } catch { return fallback; }
}

function toFloat(v: unknown): number {
  return parseFloat(String(v ?? 0)) || 0;
}
