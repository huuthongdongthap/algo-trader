// Algorithm Tuner: AI-driven parameter adjustment for trading strategies
// Uses OpenClaw AI gateway (complex tier) to analyze performance and propose changes

import type { StrategyName } from '../core/types.js';
import type { AiRouter } from './ai-router.js';

export interface TuningProposal {
  strategy: StrategyName;
  currentParams: Record<string, unknown>;
  suggestedParams: Record<string, unknown>;
  /** Human-readable explanation of why changes are suggested */
  reasoning: string;
  /** 0..1 confidence score */
  confidence: number;
  /** Estimated % improvement (can be negative if AI is uncertain) */
  expectedImprovement: number;
}

export interface PerformanceData {
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  avgPnlPerTrade: string;
  recentPnlTrend: 'improving' | 'stable' | 'degrading';
}

/** Safety bounds: absolute limits for any AI-suggested parameter change */
const SAFETY_BOUNDS = {
  /** Max allowed fractional change in position size (0.5 = ±50%) */
  maxPositionSizeChangeFraction: 0.5,
  /** Max allowed fractional change in spread (1.0 = ±100%) */
  maxSpreadChangeFraction: 1.0,
  /** stop-loss must always be a positive decimal > 0 */
  minStopLoss: 0.001,
} as const;

const SYSTEM_PROMPT = `You are an expert algorithmic trading parameter optimizer.
Analyze strategy performance and suggest conservative parameter adjustments.
Respond ONLY with valid JSON — no markdown, no explanation outside the JSON.

JSON schema:
{
  "suggestedParams": { ...key: value... },
  "reasoning": "string",
  "confidence": 0.0-1.0,
  "expectedImprovement": -100 to 100 (percent)
}`;

export class AlgorithmTuner {
  constructor(private readonly ai: AiRouter) {}

  /**
   * Ask AI for parameter suggestions based on recent performance.
   * Uses 'complex' complexity tier (claude-opus equivalent).
   */
  async proposeTuning(
    strategy: StrategyName,
    currentParams: Record<string, unknown>,
    performanceData: PerformanceData,
  ): Promise<TuningProposal> {
    const prompt = this.buildPrompt(strategy, currentParams, performanceData);

    const response = await this.ai.chat({
      prompt,
      systemPrompt: SYSTEM_PROMPT,
      complexity: 'complex',
      maxTokens: 1024,
    });

    const parsed = this.parseAiResponse(response.content);

    return {
      strategy,
      currentParams,
      suggestedParams: parsed.suggestedParams,
      reasoning: parsed.reasoning,
      confidence: parsed.confidence,
      expectedImprovement: parsed.expectedImprovement,
    };
  }

  /**
   * Sanity check: verify proposed params stay within safety bounds.
   * Returns list of violations (empty = safe).
   */
  validateProposal(proposal: TuningProposal): string[] {
    const violations: string[] = [];
    const { currentParams, suggestedParams } = proposal;

    for (const [key, newVal] of Object.entries(suggestedParams)) {
      const oldVal = currentParams[key];

      // Numeric change checks
      if (typeof newVal === 'number' && typeof oldVal === 'number' && oldVal !== 0) {
        const changeFraction = Math.abs((newVal - oldVal) / oldVal);

        if (key.toLowerCase().includes('position') || key.toLowerCase().includes('size')) {
          if (changeFraction > SAFETY_BOUNDS.maxPositionSizeChangeFraction) {
            violations.push(
              `"${key}": change ${(changeFraction * 100).toFixed(1)}% exceeds max ±50%`,
            );
          }
        }

        if (key.toLowerCase().includes('spread')) {
          if (changeFraction > SAFETY_BOUNDS.maxSpreadChangeFraction) {
            violations.push(
              `"${key}": change ${(changeFraction * 100).toFixed(1)}% exceeds max ±100%`,
            );
          }
        }
      }

      // Never disable stop-loss
      if (
        (key.toLowerCase().includes('stoploss') || key.toLowerCase().includes('stop_loss')) &&
        typeof newVal === 'number' &&
        newVal < SAFETY_BOUNDS.minStopLoss
      ) {
        violations.push(`"${key}": stop-loss cannot be set below ${SAFETY_BOUNDS.minStopLoss}`);
      }

      if (key.toLowerCase().includes('stop') && newVal === false) {
        violations.push(`"${key}": stop-loss must never be disabled`);
      }
    }

    return violations;
  }

  // --- private helpers ---

  private buildPrompt(
    strategy: StrategyName,
    currentParams: Record<string, unknown>,
    perf: PerformanceData,
  ): string {
    return [
      `Strategy type: ${strategy}`,
      '',
      'Current parameters:',
      JSON.stringify(currentParams, null, 2),
      '',
      'Recent performance:',
      `  Win rate: ${(perf.winRate * 100).toFixed(1)}%`,
      `  Sharpe ratio: ${perf.sharpeRatio.toFixed(3)}`,
      `  Max drawdown: ${(perf.maxDrawdown * 100).toFixed(2)}%`,
      `  Total trades: ${perf.totalTrades}`,
      `  Avg PnL/trade: ${perf.avgPnlPerTrade}`,
      `  Recent trend: ${perf.recentPnlTrend}`,
      '',
      'Suggest conservative parameter adjustments to improve risk-adjusted returns.',
      'Keep changes small and explainable. Only suggest parameters present in currentParams.',
    ].join('\n');
  }

  private parseAiResponse(raw: string): {
    suggestedParams: Record<string, unknown>;
    reasoning: string;
    confidence: number;
    expectedImprovement: number;
  } {
    try {
      // Strip any accidental markdown fences
      const cleaned = raw.replace(/```json|```/g, '').trim();
      const data = JSON.parse(cleaned) as {
        suggestedParams?: Record<string, unknown>;
        reasoning?: string;
        confidence?: number;
        expectedImprovement?: number;
      };

      return {
        suggestedParams: data.suggestedParams ?? {},
        reasoning: data.reasoning ?? 'No reasoning provided',
        confidence: Math.max(0, Math.min(1, data.confidence ?? 0.5)),
        expectedImprovement: data.expectedImprovement ?? 0,
      };
    } catch {
      // Fallback: return empty suggestion on parse failure
      return {
        suggestedParams: {},
        reasoning: `AI response could not be parsed: ${raw.slice(0, 200)}`,
        confidence: 0,
        expectedImprovement: 0,
      };
    }
  }
}
