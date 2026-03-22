// AI Trade Reviewer: post-trade analysis using OpenClaw AI
// Pattern recognition, scoring, and learning loop via decision-logger
// Falls back to neutral review if AI is unavailable

import type { AiRouter } from './ai-router.js';
import type { OrderSide, StrategyName } from '../core/types.js';
import { getDecisionLogger } from './decision-logger.js';
import { logger } from '../core/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompletedTrade {
  id: string;
  market: string;
  side: OrderSide;
  strategy: StrategyName;
  entryPrice: number;
  exitPrice: number;
  size: number;
  /** Realized PnL (positive = profit) */
  pnl: number;
  /** Trade duration in milliseconds */
  durationMs: number;
  timestamp: number;
}

export interface TradeReview {
  /** 0-100: overall trade quality score */
  score: number;
  insights: string[];
  suggestions: string[];
  /** AI confidence in this review */
  confidence: number;
}

// Shape AI should return as JSON
interface RawReviewJson {
  score?: number;
  insights?: unknown[];
  suggestions?: unknown[];
  confidence?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string');
}

function pnlPercent(trade: CompletedTrade): number {
  if (trade.entryPrice === 0) return 0;
  return ((trade.exitPrice - trade.entryPrice) / trade.entryPrice) * 100 *
    (trade.side === 'sell' ? -1 : 1);
}

function parseReview(content: string): TradeReview | null {
  const match = content.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: RawReviewJson;
  try {
    parsed = JSON.parse(match[0]) as RawReviewJson;
  } catch {
    return null;
  }

  return {
    score: typeof parsed.score === 'number'
      ? Math.max(0, Math.min(100, parsed.score)) : 50,
    insights: toStringArray(parsed.insights),
    suggestions: toStringArray(parsed.suggestions),
    confidence: typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
  };
}

function buildTradeContext(trade: CompletedTrade): string {
  const returnPct = pnlPercent(trade).toFixed(2);
  const durationSec = (trade.durationMs / 1000).toFixed(0);
  const outcome = trade.pnl >= 0 ? 'profitable' : 'losing';

  return [
    `Market: ${trade.market}`,
    `Strategy: ${trade.strategy}`,
    `Side: ${trade.side}`,
    `Entry: ${trade.entryPrice} → Exit: ${trade.exitPrice} (${returnPct}%)`,
    `Size: ${trade.size}`,
    `PnL: ${trade.pnl.toFixed(4)} (${outcome})`,
    `Duration: ${durationSec}s`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Review a completed trade with AI: score quality, identify patterns, suggest improvements.
 * Stores review in decision-logger for the learning loop.
 * Falls back to neutral review if AI is unavailable.
 */
export async function reviewTrade(
  trade: CompletedTrade,
  router: AiRouter,
  dbPath = 'data/algo-trade.db',
): Promise<TradeReview> {
  const tradeContext = buildTradeContext(trade);

  const prompt = [
    'You are a quantitative trading analyst. Review this completed trade.',
    'Identify what went right or wrong, recognize patterns, and suggest improvements.',
    'Respond ONLY with valid JSON.',
    '',
    tradeContext,
    '',
    'JSON shape:',
    '{"score":0-100,"insights":["what went right/wrong"],"suggestions":["how to improve"],"confidence":0.0}',
  ].join('\n');

  let review: TradeReview;

  try {
    const res = await router.chat({
      prompt,
      systemPrompt: 'You are a quantitative trade analyst. Provide actionable post-trade analysis. Respond with valid JSON only.',
      complexity: 'standard',
      maxTokens: 512,
    });

    const parsed = parseReview(res.content);

    if (!parsed) {
      logger.warn('AI trade reviewer could not parse response, using fallback', 'OpenClaw');
      review = fallback(trade);
    } else {
      review = parsed;
      logger.debug('AI trade review complete', 'OpenClaw', {
        tradeId: trade.id,
        score: review.score,
        confidence: review.confidence,
      });
    }

    // Store in decision-logger for learning loop
    const decisionLogger = getDecisionLogger(dbPath);
    decisionLogger.logDecision({
      id: `review_${trade.id}_${Date.now()}`,
      timestamp: Date.now(),
      type: 'analysis',
      input: `Trade ${trade.id}: ${trade.market} ${trade.side} pnl=${trade.pnl.toFixed(4)}`,
      output: `score=${review.score} insights=${review.insights.length}`,
      model: 'ai-trade-reviewer',
      tokensUsed: 0,
      latencyMs: 0,
      applied: true,
      confidence: review.confidence,
    });
  } catch (err) {
    logger.warn('AI trade reviewer unavailable, using fallback', 'OpenClaw', {
      tradeId: trade.id,
      error: err instanceof Error ? err.message : String(err),
    });
    review = fallback(trade);
  }

  return review;
}

/** Fallback: neutral review based on PnL sign only */
function fallback(trade: CompletedTrade): TradeReview {
  const profitable = trade.pnl >= 0;
  return {
    score: profitable ? 60 : 40,
    insights: [profitable ? 'Trade was profitable' : 'Trade resulted in a loss'],
    suggestions: ['AI unavailable — manual review recommended'],
    confidence: 0.3,
  };
}
