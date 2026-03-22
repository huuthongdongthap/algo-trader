// AI Risk Adjuster: dynamically adjusts risk parameters using AI sentiment analysis
// Conservative bias: AI can only REDUCE risk, never increase beyond base params
// Falls back to base risk params if AI is unavailable

import type { AiRouter } from './ai-router.js';
import type { RiskLimits } from '../core/types.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RiskParams {
  maxPositionSize: number;
  stopLossPercent: number;
  takeProfitPercent: number;
  maxLeverage: number;
}

export interface AdjustedRiskParams extends RiskParams {
  /** 0-1: AI confidence in these adjustments */
  confidence: number;
  reasoning: string;
}

// Shape AI should return as JSON
interface RawRiskJson {
  maxPositionSize?: number;
  stopLossPercent?: number;
  takeProfitPercent?: number;
  maxLeverage?: number;
  confidence?: number;
  reasoning?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert RiskLimits (core type) to RiskParams for convenience.
 * takeProfitPercent defaults to 2x stopLoss if not derivable.
 */
export function riskLimitsToParams(limits: RiskLimits): RiskParams {
  return {
    maxPositionSize: parseFloat(limits.maxPositionSize),
    stopLossPercent: limits.stopLossPercent,
    takeProfitPercent: limits.stopLossPercent * 2,
    maxLeverage: limits.maxLeverage,
  };
}

/**
 * Enforce conservative constraint: each adjusted param must be <= base param.
 * AI is never allowed to increase risk beyond the base.
 */
function clampToBase(adjusted: RiskParams, base: RiskParams): RiskParams {
  return {
    maxPositionSize: Math.min(adjusted.maxPositionSize, base.maxPositionSize),
    stopLossPercent: Math.min(adjusted.stopLossPercent, base.stopLossPercent),
    takeProfitPercent: Math.min(adjusted.takeProfitPercent, base.takeProfitPercent),
    maxLeverage: Math.min(adjusted.maxLeverage, base.maxLeverage),
  };
}

function parseAdjustedRisk(content: string, base: RiskParams): AdjustedRiskParams | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: RawRiskJson;
  try {
    parsed = JSON.parse(match[0]) as RawRiskJson;
  } catch {
    return null;
  }

  const proposed: RiskParams = {
    maxPositionSize: typeof parsed.maxPositionSize === 'number'
      ? Math.max(0, parsed.maxPositionSize) : base.maxPositionSize,
    stopLossPercent: typeof parsed.stopLossPercent === 'number'
      ? Math.max(0, parsed.stopLossPercent) : base.stopLossPercent,
    takeProfitPercent: typeof parsed.takeProfitPercent === 'number'
      ? Math.max(0, parsed.takeProfitPercent) : base.takeProfitPercent,
    maxLeverage: typeof parsed.maxLeverage === 'number'
      ? Math.max(1, parsed.maxLeverage) : base.maxLeverage,
  };

  const clamped = clampToBase(proposed, base);

  return {
    ...clamped,
    confidence: typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
    reasoning: typeof parsed.reasoning === 'string'
      ? parsed.reasoning : 'AI adjustment applied',
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Adjust risk parameters based on market sentiment and recent PnL.
 * AI can only REDUCE risk below base params — never increase.
 * Falls back to base params unchanged if AI is unavailable.
 */
export async function adjustRisk(
  baseRisk: RiskParams,
  marketSentiment: string,
  recentPnl: number,
  router: AiRouter,
): Promise<AdjustedRiskParams> {
  const pnlContext = recentPnl >= 0
    ? `Recent PnL: +${recentPnl.toFixed(4)} (profitable)`
    : `Recent PnL: ${recentPnl.toFixed(4)} (losing)`;

  const prompt = [
    'You are a conservative risk manager. Adjust trading risk parameters based on market sentiment and recent performance.',
    'IMPORTANT: You may only REDUCE risk parameters, never increase them beyond the base values.',
    'Respond ONLY with valid JSON.',
    '',
    'Base risk parameters:',
    `  maxPositionSize: ${baseRisk.maxPositionSize}`,
    `  stopLossPercent: ${baseRisk.stopLossPercent}`,
    `  takeProfitPercent: ${baseRisk.takeProfitPercent}`,
    `  maxLeverage: ${baseRisk.maxLeverage}`,
    '',
    `Market sentiment: ${marketSentiment}`,
    pnlContext,
    '',
    'JSON shape:',
    '{"maxPositionSize":0.0,"stopLossPercent":0.0,"takeProfitPercent":0.0,"maxLeverage":1.0,"confidence":0.0,"reasoning":"brief"}',
  ].join('\n');

  try {
    const res = await router.chat({
      prompt,
      systemPrompt: 'You are a conservative risk manager. Always reduce risk when uncertain. Respond with valid JSON only.',
      complexity: 'standard',
      maxTokens: 256,
    });

    const adjusted = parseAdjustedRisk(res.content, baseRisk);

    if (!adjusted) {
      logger.warn('AI risk adjuster could not parse response, using base params', 'OpenClaw');
      return fallback(baseRisk);
    }

    logger.debug('AI risk adjustment applied', 'OpenClaw', {
      sentiment: marketSentiment,
      recentPnl,
      confidence: adjusted.confidence,
    });

    return adjusted;
  } catch (err) {
    logger.warn('AI risk adjuster unavailable, using base params', 'OpenClaw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return fallback(baseRisk);
  }
}

/** Fallback: return base params unchanged with full confidence */
function fallback(base: RiskParams): AdjustedRiskParams {
  return {
    ...base,
    confidence: 1.0,
    reasoning: 'AI unavailable — using base risk params unchanged',
  };
}
