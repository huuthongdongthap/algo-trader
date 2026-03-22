/**
 * LLM Sentiment Strategy — Uses local MLX model to score market sentiment
 * and filter trading decisions. LLM acts as RISK FILTER, not signal generator.
 *
 * Flow: Scan markets → LLM estimates probability → Compare vs market price
 *       → If edge > threshold → Signal trade → Risk manager approves → Execute
 */

import { EventEmitter } from 'events';
import { LlmRouter, ChatMessage } from '../../lib/llm-router.js';
import type { RunnableStrategy } from '../../engine/strategy-runner.js';
import type { MarketOpportunity } from '../../polymarket/market-scanner.js';
import { logger } from '../../core/logger.js';

export interface LlmSentimentConfig {
  /** Minimum edge (LLM prob vs market price) to trigger trade */
  minEdge: number;
  /** Minimum LLM confidence to trust the estimate */
  minConfidence: number;
  /** Maximum concurrent LLM calls */
  maxConcurrent: number;
  /** Scan interval in ms */
  scanIntervalMs: number;
  /** Capital allocated in USDC */
  capitalUsdc: number;
  /** Kelly fraction for position sizing (0.25 = quarter Kelly) */
  kellyFraction: number;
}

interface LlmEstimate {
  probability: number;
  confidence: number;
  reasoning: string;
}

interface TradeSignal {
  conditionId: string;
  question: string;
  side: 'YES' | 'NO';
  marketPrice: number;
  llmProbability: number;
  edge: number;
  confidence: number;
  positionSize: number;
}

const DEFAULT_CONFIG: LlmSentimentConfig = {
  minEdge: 0.05,
  minConfidence: 0.65,
  maxConcurrent: 2,
  scanIntervalMs: 60_000,
  capitalUsdc: 1000,
  kellyFraction: 0.25,
};

export class LlmSentimentStrategy extends EventEmitter implements RunnableStrategy {
  private config: LlmSentimentConfig;
  private router: LlmRouter;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private signals: TradeSignal[] = [];
  private activeCalls = 0;

  constructor(config?: Partial<LlmSentimentConfig>, router?: LlmRouter) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.router = router || new LlmRouter();
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info('LLM Sentiment Strategy started', 'LlmSentiment');
    this.emit('started');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    logger.info('LLM Sentiment Strategy stopped', 'LlmSentiment');
    this.emit('stopped');
  }

  getStatus(): Record<string, unknown> {
    return { running: this.running, signals: this.signals.length, activeCalls: this.activeCalls };
  }

  /** Evaluate a market opportunity using LLM probability estimation */
  async evaluate(opportunity: MarketOpportunity): Promise<TradeSignal | null> {
    if (this.activeCalls >= this.config.maxConcurrent) return null;
    this.activeCalls++;

    try {
      const estimate = await this.estimateProbability(opportunity.description);
      if (estimate.confidence < this.config.minConfidence) return null;

      const yesEdge = estimate.probability - opportunity.yesMidPrice;
      const noEdge = (1 - estimate.probability) - opportunity.noMidPrice;

      let side: 'YES' | 'NO';
      let edge: number;
      let marketPrice: number;

      if (yesEdge > noEdge && yesEdge > this.config.minEdge) {
        side = 'YES'; edge = yesEdge; marketPrice = opportunity.yesMidPrice;
      } else if (noEdge > this.config.minEdge) {
        side = 'NO'; edge = noEdge; marketPrice = opportunity.noMidPrice;
      } else {
        return null;
      }

      const positionSize = this.kellySize(edge, estimate.confidence);
      const signal: TradeSignal = {
        conditionId: opportunity.conditionId,
        question: opportunity.description,
        side, marketPrice,
        llmProbability: estimate.probability,
        edge, confidence: estimate.confidence, positionSize,
      };

      this.signals.push(signal);
      this.emit('signal', signal);
      logger.info(
        side + ' edge=' + edge.toFixed(3) + ' conf=' + estimate.confidence.toFixed(2) + ' size=$' + positionSize.toFixed(0),
        'LlmSentiment'
      );
      return signal;
    } finally {
      this.activeCalls--;
    }
  }

  private async estimateProbability(question: string): Promise<LlmEstimate> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: 'You are a prediction market analyst. Estimate the probability (0-1) that the event will happen. Reply ONLY with JSON: {probability: 0.XX, confidence: 0.XX, reasoning: brief}',
      },
      { role: 'user', content: question },
    ];

    const response = await this.router.chat({ messages, maxTokens: 150, temperature: 0.1 });

    try {
      const parsed = JSON.parse(response.content) as LlmEstimate;
      return {
        probability: Math.max(0, Math.min(1, parsed.probability || 0.5)),
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
        reasoning: parsed.reasoning || '',
      };
    } catch {
      return { probability: 0.5, confidence: 0, reasoning: 'parse_error' };
    }
  }

  private kellySize(edge: number, confidence: number): number {
    const adjustedEdge = edge * confidence;
    const odds = 1;
    const kellyPct = (adjustedEdge * (odds + 1) - (1 - adjustedEdge)) / odds;
    const fractionalKelly = Math.max(0, kellyPct * this.config.kellyFraction);
    return Math.min(fractionalKelly * this.config.capitalUsdc, this.config.capitalUsdc * 0.1);
  }

  getSignals(): TradeSignal[] { return [...this.signals]; }
  clearSignals(): void { this.signals = []; }
}
