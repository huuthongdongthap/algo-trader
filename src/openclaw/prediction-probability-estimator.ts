// Prediction Probability Estimator — asks OpenClaw for a calibrated P(YES) estimate
// Input: market question + current YES price (implied probability from orderbook)
// Output: { estimatedProbability, confidence, reasoning, edge, direction }

import { AiRouter } from './ai-router.js';
import { loadOpenClawConfig } from './openclaw-config.js';
import { getCategoryHint, detectCategory } from './category-prompts.js';
import { logger } from '../core/logger.js';

export interface PredictionInput {
  marketId: string;
  question: string;
  /** Resolution criteria or additional context (optional) */
  resolutionCriteria?: string;
  /** Current YES token mid-price (= market implied probability, 0-1) */
  yesPrice: number;
}

export interface PredictionSignal {
  marketId: string;
  /** Our LLM-estimated probability that the market resolves YES (0-1) */
  ourProb: number;
  /** Market implied probability from current YES price (0-1) */
  marketProb: number;
  /** edge = ourProb - marketProb; positive → buy YES, negative → buy NO */
  edge: number;
  /** Recommended trade direction */
  direction: 'buy_yes' | 'buy_no' | 'skip';
  /** LLM confidence in the estimate (0-1) */
  confidence: number;
  /** LLM reasoning text */
  reasoning: string;
  /** Model used for estimation */
  model: string;
  /** Latency in milliseconds */
  latencyMs: number;
}

interface RawEstimateJson {
  probability?: number;
  confidence?: number;
  reasoning?: string;
}

// Minimum |edge| to generate a signal (skip near-zero edges)
const MIN_EDGE_THRESHOLD = 0.05;

export class PredictionProbabilityEstimator {
  private readonly router: AiRouter;

  constructor(router?: AiRouter) {
    this.router = router ?? new AiRouter(loadOpenClawConfig());
  }

  /**
   * Estimate probability and compute edge vs market implied probability.
   * Returns a PredictionSignal with direction = 'skip' when edge < threshold.
   */
  async estimate(input: PredictionInput): Promise<PredictionSignal> {
    const startMs = Date.now();

    const prompt = this.buildPrompt(input);
    const categoryHint = getCategoryHint(input.question);
    const category = detectCategory(input.question);
    const res = await this.router.chat({
      prompt,
      systemPrompt: [
        'You are a superforecaster trained in calibrated probability estimation.',
        'Use reference class forecasting: start with base rates for similar events, then adjust for specifics.',
        'Avoid anchoring, overconfidence, and narrative bias.',
        'Do NOT ask for or assume any market price. Give your independent estimate.',
        categoryHint,
        'Respond ONLY with valid JSON — no markdown, no extra text.',
      ].join(' '),
      // Use 'simple' tier → Nemotron (fast, 35-50 t/s) for quick probability estimates
      // Escalate to 'standard' (DeepSeek) only for complex strategy optimization
      complexity: 'simple',
      maxTokens: 2000,
    });

    const latencyMs = Date.now() - startMs;
    const parsed = this.parseResponse(res.content);
    const edge = parsed.probability - input.yesPrice;
    const direction = this.resolveDirection(edge);

    logger.debug('Prediction estimate', 'PredictionEstimator', {
      marketId: input.marketId,
      category,
      ourProb: parsed.probability,
      marketProb: input.yesPrice,
      edge,
      direction,
    });

    return {
      marketId: input.marketId,
      ourProb: parsed.probability,
      marketProb: input.yesPrice,
      edge,
      direction,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      model: res.model,
      latencyMs,
    };
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private buildPrompt(input: PredictionInput): string {
    // BLIND strategy: do NOT show market price to avoid anchoring bias.
    // The model estimates independently; edge is computed externally.
    const lines = [
      `Prediction market question: "${input.question}"`,
    ];
    if (input.resolutionCriteria) {
      lines.push(`Resolution criteria: ${input.resolutionCriteria}`);
    }
    lines.push(
      '',
      'Estimate using this framework:',
      '1. BASE RATE: Out of 100 similar events in history, how many happened? (frequency format)',
      '2. INSIDE VIEW: What specific factors make THIS case different from the reference class?',
      '3. DE-BIAS: Are you anchored? Overconfident? Neglecting base rates? Adjust toward base rate.',
      '4. FINAL: Combine outside + inside views. State probability.',
      '',
      'Do NOT guess what the market thinks. Give YOUR independent estimate.',
      '',
      'Respond with ONLY this JSON:',
      '{"probability":0.0-1.0,"confidence":0.0-1.0,"reasoning":"base rate X/100, adjusted because..."}',
    );
    return lines.join('\n');
  }

  private parseResponse(raw: string): { probability: number; confidence: number; reasoning: string } {
    try {
      // Strip DeepSeek R1 think blocks and markdown fences
      const cleaned = raw
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .replace(/```(?:json)?\n?/g, '')
        .trim();
      const match = cleaned.match(/\{[\s\S]*?\}/g)?.find(m => m.includes('probability'));
      if (!match) throw new Error('No JSON in response');

      const data = JSON.parse(match) as RawEstimateJson;
      return {
        probability: typeof data.probability === 'number'
          ? Math.max(0.01, Math.min(0.99, data.probability)) : 0.5,
        confidence: typeof data.confidence === 'number'
          ? Math.max(0, Math.min(1, data.confidence)) : 0.5,
        reasoning: typeof data.reasoning === 'string'
          ? data.reasoning.slice(0, 200) : 'No reasoning provided',
      };
    } catch {
      return { probability: 0.5, confidence: 0.3, reasoning: `Parse error: ${raw.slice(0, 80)}` };
    }
  }

  private resolveDirection(edge: number): PredictionSignal['direction'] {
    if (edge > MIN_EDGE_THRESHOLD) return 'buy_yes';
    if (edge < -MIN_EDGE_THRESHOLD) return 'buy_no';
    return 'skip';
  }
}
