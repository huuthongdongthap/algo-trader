/**
 * Semantic Dependency Discovery
 * Orchestrates cross-market relationship detection using DeepSeek (OpenAI-compatible).
 *
 * Flow:
 *   1. buildMarketBatches() — fetch + slice from Gamma API
 *   2. Check Redis cache — skip API if cached
 *   3. Call DeepSeek per batch with structured prompt
 *   4. buildDependencyGraph() — parse + deduplicate relationships
 *   5. Cache result + publish to NATS `intelligence.dependencies.updated`
 */

import { loadLlmConfig } from '../config/llm-config';
import { buildMarketBatches, buildBatchPrompt } from './market-context-builder';
import { buildDependencyGraph } from './relationship-graph-builder';
import { getCachedGraph, setCachedGraph } from './semantic-cache';
import { getMessageBus } from '../messaging/index';
import { Topics } from '../messaging/topic-schema';
import { logger } from '../utils/logger';
import type { DependencyGraph, GammaMarket } from '../types/semantic-relationships';

const DEEPSEEK_TIMEOUT_MS = 90_000;
const RETRY_LIMIT = 3;
const RETRY_DELAY_MS = 2_000;

/** System prompt instructing DeepSeek to output structured JSON relationships */
const SYSTEM_PROMPT = `You are a prediction market analyst. Given a list of Polymarket markets, identify logical dependencies between them.

Respond ONLY with a JSON array of relationship objects. Each object must have:
- marketA: string (ID of first market)
- marketB: string (ID of second market)
- type: one of "CAUSAL" | "MUTUAL_EXCLUSION" | "CONDITIONAL" | "CORRELATED"
- confidence: number 0.0–1.0
- reasoning: string (1-2 sentences max)

Only include relationships with confidence >= 0.6. Output nothing else.`;

/** Call DeepSeek (or local LLM gateway) for one batch of markets */
async function callDeepSeekForBatch(
  markets: GammaMarket[],
  llmUrl: string,
  llmModel: string,
): Promise<string> {
  const userContent = `Analyze these Polymarket markets for logical dependencies:\n\n${buildBatchPrompt(markets)}`;

  const body = {
    model: llmModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 2048,
  };

  const resp = await fetch(`${llmUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEEPSEEK_TIMEOUT_MS),
  });

  if (!resp.ok) {
    throw new Error(`LLM API error: HTTP ${resp.status}`);
  }

  const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}

/** Retry wrapper with exponential backoff */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T | null> {
  for (let attempt = 1; attempt <= RETRY_LIMIT; attempt++) {
    try {
      return await fn();
    } catch (err) {
      logger.warn(`[SemanticDiscovery] ${label} attempt ${attempt}/${RETRY_LIMIT} failed`, { err });
      if (attempt < RETRY_LIMIT) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  return null;
}

/**
 * Run full semantic dependency discovery pipeline.
 * Returns the merged DependencyGraph for all analyzed markets.
 */
export async function discoverSemanticDependencies(): Promise<DependencyGraph | null> {
  logger.info('[SemanticDiscovery] Starting dependency discovery');

  const batches = await buildMarketBatches().catch(err => {
    logger.error('[SemanticDiscovery] Failed to fetch market batches', { err });
    return [] as Awaited<ReturnType<typeof buildMarketBatches>>;
  });

  if (batches.length === 0) {
    logger.warn('[SemanticDiscovery] No market batches to process');
    return null;
  }

  const allMarketIds = batches.flatMap(b => b.markets.map(m => m.id));

  // Cache check — avoid re-calling DeepSeek within TTL
  const cached = await getCachedGraph(allMarketIds);
  if (cached) {
    logger.info(`[SemanticDiscovery] Returning cached graph (${cached.relationships.length} rels)`);
    return cached;
  }

  const llmConfig = loadLlmConfig();
  const llmUrl = llmConfig.primary.url;
  const llmModel = llmConfig.primary.model;

  logger.info(`[SemanticDiscovery] Calling LLM for ${batches.length} batches via ${llmUrl}`);

  // Process batches sequentially to respect rate limits
  const batchResults: string[] = [];
  for (const batch of batches) {
    const result = await withRetry(
      () => callDeepSeekForBatch(batch.markets, llmUrl, llmModel),
      `batch ${batch.batchIndex + 1}/${batch.totalBatches}`,
    );
    if (result) batchResults.push(result);
  }

  const graph = buildDependencyGraph(batchResults, allMarketIds.length);

  // Cache the result
  await setCachedGraph(allMarketIds, graph);

  // Publish to NATS for downstream consumers (Signal Engine Phase 03)
  try {
    const bus = getMessageBus();
    if (bus.isConnected()) {
      await bus.publish(Topics.INTELLIGENCE_DEPENDENCIES, graph, 'semantic-discovery');
      logger.info('[SemanticDiscovery] Published graph to NATS');
    }
  } catch (err) {
    // Non-fatal — graph is still returned and cached
    logger.warn('[SemanticDiscovery] NATS publish failed', { err });
  }

  logger.info(`[SemanticDiscovery] Completed: ${graph.relationships.length} relationships discovered`);
  return graph;
}
