/**
 * Probability Calibrator Strategy
 * Uses a local LLM (Ollama/MLX via OpenAI-compatible API) to estimate
 * true probabilities for binary prediction markets and detect mispricing.
 *
 * Default model: qwen2.5-coder:32b via Ollama on localhost:11434
 * All LLM calls use fetch() with OpenAI chat completions format.
 */

import { BinaryMarket } from '../arbitrage/types';

export interface CalibratorConfig {
  /** Local LLM base URL (default: http://127.0.0.1:11434) */
  llmBaseUrl: string;
  /** Model identifier served by Ollama/MLX (default: qwen2.5-coder:32b) */
  llmModel: string;
  /** Minimum confidence to act on an estimate (default: 0.7) */
  confidenceThreshold: number;
  /** Max parallel LLM requests to avoid OOM on local GPU (default: 2) */
  maxConcurrentRequests: number;
}

const DEFAULT_CONFIG: CalibratorConfig = {
  llmBaseUrl: 'http://127.0.0.1:11434',
  llmModel: 'qwen2.5-coder:32b',
  confidenceThreshold: 0.7,
  maxConcurrentRequests: 2,
};

export interface ProbabilityEstimate {
  probability: number;
  confidence: number;
  reasoning: string;
}

export interface SentimentScore {
  /** -1.0 (very negative) to +1.0 (very positive) */
  sentiment: number;
  impact: 'high' | 'medium' | 'low';
}

export interface MispricingSignal {
  mispriced: boolean;
  /** 'overpriced-yes' | 'underpriced-yes' | 'fair' */
  direction: string;
  /** Absolute edge as fraction (e.g. 0.08 = 8%) */
  edge: number;
}

/** Semaphore to limit concurrent LLM calls */
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release(): void {
    const next = this.queue.shift();
    if (next) { next(); } else { this.permits++; }
  }
}

export class ProbabilityCalibratorStrategy {
  private config: CalibratorConfig;
  private semaphore: Semaphore;

  constructor(config: Partial<CalibratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.semaphore = new Semaphore(this.config.maxConcurrentRequests);
  }

  /**
   * Ask the local LLM for a probability estimate on a binary question.
   * Returns probability 0–1, confidence 0–1, and a brief reasoning string.
   */
  async estimateProbability(question: string, context?: string): Promise<ProbabilityEstimate> {
    const systemPrompt = [
      'You are a probability calibration expert for prediction markets.',
      'Respond ONLY with valid JSON in this exact shape:',
      '{"probability": <0-1 float>, "confidence": <0-1 float>, "reasoning": "<one sentence>"}',
      'probability = your best estimate that the event resolves YES.',
      'confidence = how certain you are (0 = no idea, 1 = certain).',
    ].join('\n');

    const userPrompt = context
      ? `Question: ${question}\n\nAdditional context:\n${context}`
      : `Question: ${question}`;

    const raw = await this.callLLM(systemPrompt, userPrompt);
    return this.parseProbabilityResponse(raw);
  }

  /**
   * Score sentiment of a news snippet for potential market impact.
   */
  async scoreSentiment(newsText: string): Promise<SentimentScore> {
    const systemPrompt = [
      'You are a financial news sentiment analyst.',
      'Respond ONLY with valid JSON:',
      '{"sentiment": <-1.0 to 1.0>, "impact": "high"|"medium"|"low"}',
      'sentiment: -1=very negative, 0=neutral, +1=very positive for the market outcome.',
      'impact: expected influence on prediction market prices.',
    ].join('\n');

    const raw = await this.callLLM(systemPrompt, `Analyze: ${newsText}`);
    return this.parseSentimentResponse(raw);
  }

  /**
   * Compare LLM probability estimate against market price to find edge.
   * Returns mispricing signal with direction and magnitude.
   */
  detectMispricing(market: BinaryMarket, estimatedProb: number): MispricingSignal {
    const marketProb = market.yesPrice; // YES token price ≈ implied probability
    const edge = Math.abs(estimatedProb - marketProb);

    if (edge < 0.03) {
      return { mispriced: false, direction: 'fair', edge };
    }

    const direction = estimatedProb > marketProb ? 'underpriced-yes' : 'overpriced-yes';
    return { mispriced: true, direction, edge };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
    await this.semaphore.acquire();
    try {
      const response = await fetch(`${this.config.llmBaseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.llmModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1, // low temp for consistent structured output
          max_tokens: 256,
        }),
      });

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as LLMResponse;
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      this.semaphore.release();
    }
  }

  private parseProbabilityResponse(raw: string): ProbabilityEstimate {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found');
      const parsed = JSON.parse(match[0]) as Partial<ProbabilityEstimate>;
      return {
        probability: clamp(Number(parsed.probability ?? 0.5), 0, 1),
        confidence: clamp(Number(parsed.confidence ?? 0.5), 0, 1),
        reasoning: String(parsed.reasoning ?? 'No reasoning provided'),
      };
    } catch {
      return { probability: 0.5, confidence: 0, reasoning: 'Failed to parse LLM response' };
    }
  }

  private parseSentimentResponse(raw: string): SentimentScore {
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found');
      const parsed = JSON.parse(match[0]) as Partial<SentimentScore>;
      const impact = ['high', 'medium', 'low'].includes(parsed.impact as string)
        ? (parsed.impact as SentimentScore['impact'])
        : 'medium';
      return {
        sentiment: clamp(Number(parsed.sentiment ?? 0), -1, 1),
        impact,
      };
    } catch {
      return { sentiment: 0, impact: 'low' };
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Minimal OpenAI-compatible chat completion response */
interface LLMResponse {
  choices?: Array<{ message?: { content?: string } }>;
}
