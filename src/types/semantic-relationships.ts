/**
 * Semantic Relationship Types
 * Typed structures for cross-market dependency graphs discovered via DeepSeek.
 *
 * Used by: semantic-dependency-discovery, relationship-graph-builder, semantic-cache
 * Consumed by: Signal Engine (Phase 03)
 */

/** Classification of logical relationship between two prediction markets */
export enum RelationType {
  /** Market A outcome directly causes Market B outcome */
  CAUSAL = 'CAUSAL',
  /** Markets cannot both resolve YES (e.g. "A wins" vs "B wins") */
  MUTUAL_EXCLUSION = 'MUTUAL_EXCLUSION',
  /** Market B outcome depends on Market A outcome as a precondition */
  CONDITIONAL = 'CONDITIONAL',
  /** Markets tend to move together due to shared underlying events */
  CORRELATED = 'CORRELATED',
}

/** Directional relationship between two Polymarket prediction markets */
export interface MarketRelationship {
  /** Polymarket market ID (source/driver market) */
  marketA: string;
  /** Polymarket market ID (target/dependent market) */
  marketB: string;
  /** Nature of the logical dependency */
  type: RelationType;
  /** Confidence score 0–1 from DeepSeek analysis */
  confidence: number;
  /** Human-readable explanation from DeepSeek */
  reasoning: string;
}

/** Full dependency graph for a batch of analyzed markets */
export interface DependencyGraph {
  /** All discovered relationships across analyzed markets */
  relationships: MarketRelationship[];
  /** Total number of markets included in this analysis batch */
  marketCount: number;
  /** Unix timestamp (ms) when the graph was built */
  updatedAt: number;
}

/** Raw market descriptor fetched from Gamma API — minimal fields needed for LLM prompt */
export interface GammaMarket {
  id: string;
  question: string;
  description?: string;
  endDate?: string;
  volume?: string;
}

/** Prompt batch: a slice of GammaMarkets ready for one DeepSeek call */
export interface MarketPromptBatch {
  markets: GammaMarket[];
  batchIndex: number;
  totalBatches: number;
}
