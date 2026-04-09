/**
 * Relationship Graph Builder
 * Parses raw DeepSeek JSON response into a typed DependencyGraph.
 * Validates relationship structure and filters low-confidence results.
 */

import { logger } from '../utils/logger';
import {
  RelationType,
  type MarketRelationship,
  type DependencyGraph,
} from '../types/semantic-relationships';

/** Minimum confidence threshold — relationships below this are discarded */
const MIN_CONFIDENCE = 0.5;

const VALID_RELATION_TYPES = new Set<string>(Object.values(RelationType));

/** Parse and validate a single raw relationship object from DeepSeek output */
function parseRelationship(raw: Record<string, unknown>): MarketRelationship | null {
  const { marketA, marketB, type, confidence, reasoning } = raw;

  if (typeof marketA !== 'string' || typeof marketB !== 'string') return null;
  if (typeof type !== 'string' || !VALID_RELATION_TYPES.has(type)) return null;
  if (typeof confidence !== 'number' || confidence < MIN_CONFIDENCE || confidence > 1) return null;
  if (typeof reasoning !== 'string') return null;

  return {
    marketA,
    marketB,
    type: type as RelationType,
    confidence,
    reasoning,
  };
}

/**
 * Extract JSON array from raw DeepSeek text response.
 * DeepSeek may wrap output in markdown code fences or plain text.
 */
export function extractJsonArray(text: string): unknown[] {
  // Try direct JSON parse first
  try {
    const parsed = JSON.parse(text.trim());
    if (Array.isArray(parsed)) return parsed;
    // Unwrap { relationships: [...] }
    if (parsed && Array.isArray((parsed as Record<string, unknown>).relationships)) {
      return (parsed as Record<string, unknown>).relationships as unknown[];
    }
  } catch {
    // not clean JSON — try extracting from markdown fences
  }

  // Extract JSON array from ```json ... ``` or ``` ... ``` blocks
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray((parsed as Record<string, unknown>).relationships)) {
        return (parsed as Record<string, unknown>).relationships as unknown[];
      }
    } catch {
      // ignore
    }
  }

  // Last resort: find first [ ... ] block
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // ignore
    }
  }

  return [];
}

/**
 * Build a typed DependencyGraph from all collected batch relationships.
 *
 * @param batchResults - Array of raw DeepSeek text responses, one per batch
 * @param totalMarkets - Total market count used for graph metadata
 */
export function buildDependencyGraph(
  batchResults: string[],
  totalMarkets: number,
): DependencyGraph {
  const relationships: MarketRelationship[] = [];

  for (const rawText of batchResults) {
    try {
      const items = extractJsonArray(rawText);
      for (const item of items) {
        const rel = parseRelationship(item as Record<string, unknown>);
        if (rel) {
          relationships.push(rel);
        }
      }
    } catch (err) {
      logger.warn('[GraphBuilder] Failed to parse batch result', { err });
    }
  }

  // Deduplicate by (marketA, marketB, type) — keep highest confidence
  const seen = new Map<string, MarketRelationship>();
  for (const rel of relationships) {
    const key = `${rel.marketA}:${rel.marketB}:${rel.type}`;
    const existing = seen.get(key);
    if (!existing || rel.confidence > existing.confidence) {
      seen.set(key, rel);
    }
  }

  const unique = Array.from(seen.values());
  logger.info(`[GraphBuilder] Built graph: ${unique.length} relationships from ${totalMarkets} markets`);

  return {
    relationships: unique,
    marketCount: totalMarkets,
    updatedAt: Date.now(),
  };
}
