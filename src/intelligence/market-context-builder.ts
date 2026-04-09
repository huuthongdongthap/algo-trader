/**
 * Market Context Builder
 * Fetches active Polymarket markets from Gamma API and batches them into
 * LLM-ready prompt slices (~20 markets per batch).
 *
 * Gamma API: https://gamma-api.polymarket.com/markets?closed=false&limit=100
 */

import { logger } from '../utils/logger';
import type { GammaMarket, MarketPromptBatch } from '../types/semantic-relationships';

const GAMMA_API_BASE = process.env.GAMMA_API_URL || 'https://gamma-api.polymarket.com';
const FETCH_LIMIT = 100;
const BATCH_SIZE = 20;
const FETCH_TIMEOUT_MS = 15_000;

/** Fetch active markets from Gamma API with pagination */
async function fetchGammaMarkets(limit: number): Promise<GammaMarket[]> {
  const url = `${GAMMA_API_BASE}/markets?closed=false&limit=${limit}`;
  const resp = await fetch(url, {
    headers: { 'Accept': 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`Gamma API error: HTTP ${resp.status}`);
  }

  // Gamma API may return an array directly or { data: [...] }
  const raw = await resp.json() as unknown;
  const markets: GammaMarket[] = [];

  const items = Array.isArray(raw) ? raw : (raw as { data?: unknown[] }).data ?? [];
  for (const item of items as Record<string, unknown>[]) {
    if (typeof item.id === 'string' && typeof item.question === 'string') {
      markets.push({
        id: item.id,
        question: item.question,
        description: typeof item.description === 'string' ? item.description : undefined,
        endDate: typeof item.endDate === 'string' ? item.endDate : undefined,
        volume: typeof item.volume === 'string' ? item.volume : undefined,
      });
    }
  }

  return markets;
}

/** Split an array into chunks of chunkSize */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** Format a single market as a numbered prompt entry */
function formatMarket(m: GammaMarket, idx: number): string {
  const desc = m.description ? ` — ${m.description.slice(0, 120)}` : '';
  return `${idx + 1}. [ID:${m.id}] ${m.question}${desc}`;
}

/**
 * Build prompt text for a single batch of markets.
 * Returned string is injected into the DeepSeek relationship-discovery prompt.
 */
export function buildBatchPrompt(batch: GammaMarket[]): string {
  return batch.map((m, i) => formatMarket(m, i)).join('\n');
}

/**
 * Fetch all active Polymarket markets and return them as ordered prompt batches.
 * Each batch contains BATCH_SIZE (~20) markets ready for one DeepSeek call.
 */
export async function buildMarketBatches(): Promise<MarketPromptBatch[]> {
  logger.info('[MarketContextBuilder] Fetching active markets from Gamma API');

  const markets = await fetchGammaMarkets(FETCH_LIMIT);
  logger.info(`[MarketContextBuilder] Fetched ${markets.length} markets`);

  if (markets.length === 0) {
    logger.warn('[MarketContextBuilder] No markets returned from Gamma API');
    return [];
  }

  const chunks = chunk(markets, BATCH_SIZE);
  return chunks.map((slice, i) => ({
    markets: slice,
    batchIndex: i,
    totalBatches: chunks.length,
  }));
}
