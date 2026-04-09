/**
 * Vector Embedding Store
 * Generates TF-IDF feature vectors from market titles/descriptions and stores in Redis.
 * Pure TypeScript — no external ML libraries.
 *
 * Key schema: `embed:{marketId}` → JSON float array
 * Vocabulary built across all markets then frozen for consistent dimensionality.
 */

import { getRedisClient } from '../redis/index';
import { logger } from '../utils/logger';
import type { GammaMarket } from '../types/semantic-relationships';

const EMBED_KEY_PREFIX = 'embed:';
const VOCAB_KEY = 'embed:__vocab__';
const EMBED_TTL_SECONDS = 7200; // 2h — embeddings stay fresh longer than dep graphs
const MIN_TOKEN_LENGTH = 3;
const MAX_VOCAB_SIZE = 1024;

/** Tokenize text: lowercase, strip punctuation, split on whitespace */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= MIN_TOKEN_LENGTH);
}

/** Compute term frequency map for a token array */
function computeTF(tokens: string[]): Map<string, number> {
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const total = tokens.length || 1;
  const tf = new Map<string, number>();
  for (const [term, count] of freq) tf.set(term, count / total);
  return tf;
}

/** Build IDF map from a collection of per-doc token sets */
function buildIDF(docTokenSets: string[][]): Map<string, number> {
  const docCount = docTokenSets.length || 1;
  const dfMap = new Map<string, number>();
  for (const tokens of docTokenSets) {
    const unique = new Set(tokens);
    for (const t of unique) dfMap.set(t, (dfMap.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [term, df] of dfMap) idf.set(term, Math.log(docCount / (df + 1)) + 1);
  return idf;
}

/** Build sorted vocabulary from IDF map, capped at MAX_VOCAB_SIZE */
function buildVocabulary(idf: Map<string, number>): string[] {
  return [...idf.entries()]
    .sort((a, b) => b[1] - a[1])   // highest IDF = most discriminative
    .slice(0, MAX_VOCAB_SIZE)
    .map(([term]) => term)
    .sort();                         // stable alphabetical order for index consistency
}

/** Compute TF-IDF vector for one document given a fixed vocabulary + IDF */
function computeTfIdfVector(
  tf: Map<string, number>,
  idf: Map<string, number>,
  vocab: string[],
): number[] {
  return vocab.map(term => (tf.get(term) ?? 0) * (idf.get(term) ?? 0));
}

/** Normalize a vector to unit length (L2 norm) */
export function normalizeVector(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vec.map(() => 0);
  return vec.map(v => v / norm);
}

/** Redis key for a market embedding */
function embedKey(marketId: string): string {
  return `${EMBED_KEY_PREFIX}${marketId}`;
}

/** Persist a single embedding to Redis */
export async function storeEmbedding(marketId: string, vector: number[]): Promise<void> {
  try {
    const redis = getRedisClient();
    await redis.setex(embedKey(marketId), EMBED_TTL_SECONDS, JSON.stringify(vector));
  } catch (err) {
    logger.warn('[VectorEmbedStore] Failed to store embedding', { marketId, err });
  }
}

/** Retrieve a single embedding from Redis; returns null on miss */
export async function getEmbedding(marketId: string): Promise<number[] | null> {
  try {
    const redis = getRedisClient();
    const raw = await redis.get(embedKey(marketId));
    return raw ? (JSON.parse(raw) as number[]) : null;
  } catch (err) {
    logger.warn('[VectorEmbedStore] Failed to fetch embedding', { marketId, err });
    return null;
  }
}

/** Retrieve all stored market embeddings as a map of marketId → vector */
export async function getAllEmbeddings(): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  try {
    const redis = getRedisClient();
    // Use SCAN instead of KEYS to avoid blocking Redis
    const marketKeys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${EMBED_KEY_PREFIX}*`, 'COUNT', '200');
      cursor = nextCursor;
      for (const k of keys) {
        if (k !== VOCAB_KEY) marketKeys.push(k);
      }
    } while (cursor !== '0');
    if (marketKeys.length === 0) return result;

    const values = await redis.mget(...marketKeys);
    for (let i = 0; i < marketKeys.length; i++) {
      const raw = values[i];
      if (!raw) continue;
      const marketId = marketKeys[i].slice(EMBED_KEY_PREFIX.length);
      result.set(marketId, JSON.parse(raw) as number[]);
    }
  } catch (err) {
    logger.warn('[VectorEmbedStore] Failed to fetch all embeddings', { err });
  }
  return result;
}

/**
 * Batch-generate TF-IDF embeddings for all provided markets and store in Redis.
 * Returns the number of embeddings successfully stored.
 */
export async function generateAndStoreEmbeddings(markets: GammaMarket[]): Promise<number> {
  if (markets.length === 0) return 0;

  logger.info(`[VectorEmbedStore] Generating embeddings for ${markets.length} markets`);

  // Tokenize each market's combined text
  const marketTexts = markets.map(m =>
    `${m.question} ${m.description ?? ''}`.trim()
  );
  const docTokenSets = marketTexts.map(tokenize);

  // Build shared IDF + vocabulary across all markets
  const idf = buildIDF(docTokenSets);
  const vocab = buildVocabulary(idf);

  logger.debug(`[VectorEmbedStore] Vocabulary size: ${vocab.length}`);

  // Persist vocabulary for cross-session consistency
  try {
    const redis = getRedisClient();
    await redis.setex(VOCAB_KEY, EMBED_TTL_SECONDS, JSON.stringify(vocab));
  } catch (err) {
    logger.warn('[VectorEmbedStore] Failed to persist vocabulary', { err });
  }

  // Compute + store embeddings
  let stored = 0;
  for (let i = 0; i < markets.length; i++) {
    const tf = computeTF(docTokenSets[i]);
    const rawVec = computeTfIdfVector(tf, idf, vocab);
    const normalized = normalizeVector(rawVec);
    await storeEmbedding(markets[i].id, normalized);
    stored++;
  }

  logger.info(`[VectorEmbedStore] Stored ${stored}/${markets.length} embeddings`);
  return stored;
}
