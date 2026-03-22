// AI Strategy Selector: uses OpenClaw AI to recommend which strategies to activate
// Analyzes market conditions (volatility, trend, volume) and ranks strategies by suitability

import type { AiRouter } from './ai-router.js';
import type { StrategyConfig } from '../core/types.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MarketConditions {
  /** 0-1 scale: 0 = calm, 1 = extremely volatile */
  volatility: number;
  /** 'bullish' | 'bearish' | 'sideways' */
  trend: 'bullish' | 'bearish' | 'sideways';
  /** Relative volume vs average: 1.0 = normal, 2.0 = double */
  volumeRatio: number;
  /** Optional: market symbol for context */
  market?: string;
}

export interface StrategyRecommendation {
  strategy: StrategyConfig;
  /** 0-1: AI confidence that this strategy suits current conditions */
  confidence: number;
  /** 'activate' | 'deactivate' | 'maintain' */
  action: 'activate' | 'deactivate' | 'maintain';
  reasoning: string;
}

// Shape AI should return per strategy
interface RawStrategyRec {
  name?: string;
  confidence?: number;
  action?: string;
  reasoning?: string;
}

interface RawAiOutput {
  recommendations?: RawStrategyRec[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string');
}
// Suppress unused warning – exported for tests if needed
void toStringArray;

function parseRecommendations(
  content: string,
  strategies: StrategyConfig[],
): StrategyRecommendation[] {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return [];

  let parsed: RawAiOutput;
  try {
    parsed = JSON.parse(match[0]) as RawAiOutput;
  } catch {
    return [];
  }

  if (!Array.isArray(parsed.recommendations)) return [];

  const validActions = ['activate', 'deactivate', 'maintain'] as const;
  const result: StrategyRecommendation[] = [];

  for (const rec of parsed.recommendations) {
    const strategy = strategies.find((s) => s.name === rec.name);
    if (!strategy) continue;

    const action = validActions.includes(rec.action as typeof validActions[number])
      ? (rec.action as StrategyRecommendation['action'])
      : 'maintain';

    result.push({
      strategy,
      confidence: typeof rec.confidence === 'number'
        ? Math.max(0, Math.min(1, rec.confidence))
        : 0.5,
      action,
      reasoning: typeof rec.reasoning === 'string' ? rec.reasoning : '',
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Use AI to rank and recommend strategy activations based on market conditions.
 * Falls back to returning all strategies as-is (maintain) if AI is unavailable.
 */
export async function selectStrategies(
  marketConditions: MarketConditions,
  availableStrategies: StrategyConfig[],
  router: AiRouter,
): Promise<StrategyRecommendation[]> {
  if (availableStrategies.length === 0) return [];

  const strategyNames = availableStrategies.map((s) => s.name);

  const prompt = [
    'You are a quant strategy selector. Given market conditions, recommend which strategies to activate, deactivate, or maintain.',
    'Respond ONLY with valid JSON.',
    '',
    `Market conditions:`,
    `  volatility: ${marketConditions.volatility.toFixed(2)} (0=calm, 1=extreme)`,
    `  trend: ${marketConditions.trend}`,
    `  volumeRatio: ${marketConditions.volumeRatio.toFixed(2)} (1.0=normal)`,
    ...(marketConditions.market ? [`  market: ${marketConditions.market}`] : []),
    '',
    `Available strategies: ${strategyNames.join(', ')}`,
    '',
    'JSON shape:',
    '{"recommendations":[{"name":"strategy-name","confidence":0.0,"action":"activate|deactivate|maintain","reasoning":"brief"}]}',
  ].join('\n');

  try {
    const res = await router.chat({
      prompt,
      systemPrompt: 'You are a quantitative strategy selector. Respond with valid JSON only.',
      complexity: 'complex',
      maxTokens: 512,
    });

    const recommendations = parseRecommendations(res.content, availableStrategies);

    if (recommendations.length === 0) {
      logger.warn('AI strategy selector returned empty recommendations, using fallback', 'OpenClaw');
      return fallback(availableStrategies);
    }

    // Sort by confidence descending
    recommendations.sort((a, b) => b.confidence - a.confidence);

    logger.debug('AI strategy selection complete', 'OpenClaw', {
      count: recommendations.length,
      topStrategy: recommendations[0]?.strategy.name,
    });

    return recommendations;
  } catch (err) {
    logger.warn('AI strategy selector unavailable, using fallback', 'OpenClaw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback(availableStrategies);
  }
}

/** Fallback: return all strategies as-is with maintain action */
function fallback(strategies: StrategyConfig[]): StrategyRecommendation[] {
  return strategies.map((s) => ({
    strategy: s,
    confidence: 1.0,
    action: 'maintain' as const,
    reasoning: 'AI unavailable — maintaining current state',
  }));
}
