/**
 * Semantic Similarity Search
 * Cosine similarity search across stored TF-IDF market embeddings.
 *
 * Used by: semantic-dependency-discovery to pre-filter markets for DeepSeek analysis.
 *
 * Algorithm: cosine(A,B) = dot(A,B) / (|A|*|B|)
 * Vectors stored normalized (unit length), so cosine = simple dot product.
 */

import { getAllEmbeddings, getEmbedding } from './vector-embedding-store';
import { logger } from '../utils/logger';

export interface SimilarMarket {
  marketId: string;
  /** Cosine similarity score in [0, 1] — higher = more similar */
  score: number;
}

/**
 * Cosine similarity between two equal-length numeric vectors.
 * Assumes pre-normalized (unit) vectors → result is just dot product.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Clamp to [0,1] — floating point may yield tiny negatives on orthogonal vecs
  return Math.max(0, Math.min(1, dot));
}

/**
 * Find the top-K most semantically similar markets to a given market.
 *
 * Loads all embeddings from Redis, computes cosine similarity against
 * the query market's embedding, returns ranked results (excluding self).
 *
 * @param marketId - Target market to find neighbors for
 * @param topK     - Number of similar markets to return (default 5)
 * @returns Ranked array of {marketId, score}, highest score first
 */
export async function findSimilarMarkets(
  marketId: string,
  topK = 5,
): Promise<SimilarMarket[]> {
  const queryVec = await getEmbedding(marketId);
  if (!queryVec) {
    logger.warn('[SimilaritySearch] No embedding found for query market', { marketId });
    return [];
  }

  const allEmbeddings = await getAllEmbeddings();
  if (allEmbeddings.size === 0) {
    logger.warn('[SimilaritySearch] No embeddings in store — run generateAndStoreEmbeddings first');
    return [];
  }

  const results: SimilarMarket[] = [];
  for (const [candidateId, candidateVec] of allEmbeddings) {
    if (candidateId === marketId) continue; // skip self
    if (candidateVec.length !== queryVec.length) continue; // dimension mismatch
    const score = cosineSimilarity(queryVec, candidateVec);
    results.push({ marketId: candidateId, score });
  }

  // Sort descending by score, take top-K
  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, topK);

  logger.debug('[SimilaritySearch] Top matches', {
    queryMarketId: marketId,
    topK,
    results: topResults.map(r => `${r.marketId}:${r.score.toFixed(3)}`),
  });

  return topResults;
}

/**
 * Batch similarity lookup: find top-K neighbors for each of the given market IDs.
 * Returns a map of marketId → ranked similar markets.
 *
 * More efficient than calling findSimilarMarkets() repeatedly because
 * it loads all embeddings once, then scores against each query.
 */
export async function batchFindSimilarMarkets(
  marketIds: string[],
  topK = 5,
): Promise<Map<string, SimilarMarket[]>> {
  const allEmbeddings = await getAllEmbeddings();
  const resultMap = new Map<string, SimilarMarket[]>();

  if (allEmbeddings.size === 0) {
    logger.warn('[SimilaritySearch] No embeddings in store for batch lookup');
    for (const id of marketIds) resultMap.set(id, []);
    return resultMap;
  }

  for (const marketId of marketIds) {
    const queryVec = allEmbeddings.get(marketId);
    if (!queryVec) {
      logger.debug('[SimilaritySearch] No embedding for market in batch', { marketId });
      resultMap.set(marketId, []);
      continue;
    }

    const candidates: SimilarMarket[] = [];
    for (const [candidateId, candidateVec] of allEmbeddings) {
      if (candidateId === marketId) continue;
      if (candidateVec.length !== queryVec.length) continue;
      candidates.push({ marketId: candidateId, score: cosineSimilarity(queryVec, candidateVec) });
    }

    candidates.sort((a, b) => b.score - a.score);
    resultMap.set(marketId, candidates.slice(0, topK));
  }

  logger.info(`[SimilaritySearch] Batch lookup complete`, {
    queried: marketIds.length,
    totalEmbeddings: allEmbeddings.size,
  });

  return resultMap;
}

/**
 * Filter a candidate list to only markets above a similarity threshold.
 * Useful for semantic dependency discovery to skip weakly-related markets.
 */
export async function filterBySimilarity(
  marketId: string,
  candidateIds: string[],
  minScore = 0.3,
): Promise<string[]> {
  const queryVec = await getEmbedding(marketId);
  if (!queryVec) return candidateIds; // can't filter without embedding — return all

  const allEmbeddings = await getAllEmbeddings();
  const filtered: string[] = [];

  for (const candidateId of candidateIds) {
    const candidateVec = allEmbeddings.get(candidateId);
    if (!candidateVec || candidateVec.length !== queryVec.length) {
      filtered.push(candidateId); // include if no embedding data
      continue;
    }
    const score = cosineSimilarity(queryVec, candidateVec);
    if (score >= minScore) filtered.push(candidateId);
  }

  logger.debug('[SimilaritySearch] filterBySimilarity', {
    marketId,
    input: candidateIds.length,
    output: filtered.length,
    minScore,
  });

  return filtered;
}
