/**
 * AlphaEar Intelligence Client — calls Python sidecar on host.
 *
 * Sidecar runs bare metal at :8100 (needs Metal GPU for Kronos + FinBERT).
 * CashClaw container connects via host.docker.internal:8100.
 *
 * Capabilities:
 *   - News: 14-source aggregation + Polymarket market discovery
 *   - Sentiment: FinBERT financial text analysis
 *   - Prediction: Kronos time-series forecasting
 *   - Signal tracking: Evolution assessment via Nemotron LLM
 */

import { logger } from '../core/logger.js';

const SIDECAR_URL = process.env['ALPHAEAR_SIDECAR_URL'] || 'http://host.docker.internal:8100';
const TIMEOUT_MS = 30_000;

// ──── Types ────

export interface NewsItem {
  id: string;
  source: string;
  rank: number;
  title: string;
  url: string;
  content?: string;
}

export interface PolymarketDiscovery {
  id: string;
  question: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  volume: string;
  liquidity: string;
}

export interface SentimentResult {
  score: number;
  label: string;
  reason?: string;
}

export interface ForecastPoint {
  close: number;
  high: number;
  low: number;
}

export interface SignalEvolution {
  status: 'STRENGTHENED' | 'WEAKENED' | 'FALSIFIED' | 'UNCHANGED';
  confidence: number;
  reasoning: string;
}

export interface SidecarHealth {
  status: string;
  kronos_loaded: boolean;
  finbert_loaded: boolean;
  news_sources: number;
  polymarket_api: boolean;
}

// ──── Client ────

export class AlphaEarClient {
  private baseUrl: string;
  private healthy = false;
  private lastHealthCheck = 0;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || SIDECAR_URL;
  }

  // ──── News ────

  async fetchHotNews(source = 'wallstreetcn', count = 15): Promise<NewsItem[]> {
    const resp = await this.post<{ items: NewsItem[] }>('/news/hot', { source, count });
    return resp?.items ?? [];
  }

  async discoverPolymarkets(limit = 20): Promise<PolymarketDiscovery[]> {
    const resp = await this.post<{ markets: PolymarketDiscovery[] }>('/news/polymarket', { limit });
    return resp?.markets ?? [];
  }

  async extractContent(url: string): Promise<string | null> {
    const resp = await this.post<{ content: string }>('/news/content', { url });
    return resp?.content ?? null;
  }

  // ──── Sentiment ────

  async analyzeSentiment(text: string): Promise<SentimentResult | null> {
    return this.post<SentimentResult>('/sentiment/analyze', { text });
  }

  async batchSentiment(texts: string[]): Promise<SentimentResult[]> {
    const resp = await this.post<{ results: SentimentResult[] }>('/sentiment/batch', { texts });
    return resp?.results ?? [];
  }

  // ──── Prediction ────

  async forecast(
    prices: number[],
    lookback = 60,
    predLen = 5,
    newsContext = '',
  ): Promise<ForecastPoint[]> {
    const resp = await this.post<{ forecast: ForecastPoint[] }>('/predict/forecast', {
      prices, lookback, pred_len: predLen, news_context: newsContext,
    });
    return resp?.forecast ?? [];
  }

  // ──── Signal Tracking ────

  async trackSignal(
    signalId: string,
    originalThesis: string,
    newInfo: string,
    currentPrice: number,
    entryPrice: number,
  ): Promise<SignalEvolution | null> {
    const resp = await this.post<{ analysis: string }>('/signal/track', {
      signal_id: signalId,
      original_thesis: originalThesis,
      new_information: newInfo,
      current_price: currentPrice,
      entry_price: entryPrice,
    });
    if (!resp?.analysis) return null;
    try {
      const match = resp.analysis.match(/\{[^}]+\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch {
      return null;
    }
  }

  // ──── Health ────

  async checkHealth(): Promise<SidecarHealth | null> {
    try {
      const resp = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) {
        this.healthy = true;
        this.lastHealthCheck = Date.now();
        return resp.json() as Promise<SidecarHealth>;
      }
      this.healthy = false;
      return null;
    } catch {
      this.healthy = false;
      return null;
    }
  }

  get isHealthy(): boolean {
    if (Date.now() - this.lastHealthCheck > 300_000) return false;
    return this.healthy;
  }

  // ──── Internal ────

  private async post<T>(path: string, body: Record<string, unknown>): Promise<T | null> {
    try {
      const resp = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!resp.ok) {
        logger.warn(`AlphaEar ${path} returned ${resp.status}`, 'AlphaEarClient');
        return null;
      }
      return resp.json() as Promise<T>;
    } catch (err) {
      logger.debug(`AlphaEar ${path} unavailable`, 'AlphaEarClient');
      return null;
    }
  }
}

/** Singleton instance */
export const alphaear = new AlphaEarClient();
