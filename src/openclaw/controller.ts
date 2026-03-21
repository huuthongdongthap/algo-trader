// OpenClaw Controller: central AI brain for trading operations
// Orchestrates AI-powered analysis, strategy evaluation, and reporting

import { AiRouter } from './ai-router.js';
import { loadOpenClawConfig, type OpenClawConfig } from './openclaw-config.js';
import type { TradeResult, StrategyName } from '../core/types.js';

// ---- Input / Output types ------------------------------------------------

export interface TradeAnalysis {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  riskLevel: 'low' | 'medium' | 'high';
  recommendation: string;
  keyFactors: string[];
}

export interface StrategyEvaluation {
  score: number; // 0-100
  strengths: string[];
  weaknesses: string[];
  suggestion: string;
}

export interface ParameterSuggestion {
  parameter: string;
  currentValue: unknown;
  suggestedValue: unknown;
  rationale: string;
}

export interface PerformanceReport {
  summary: string;
  totalTrades: number;
  winRate: string;
  highlights: string[];
  period: string;
}

// ---- Helpers ---------------------------------------------------------------

/** Safely parse JSON from AI response; return fallback on failure */
function safeJsonParse<T>(text: string, fallback: T): T {
  // Strip markdown code fences if present
  const cleaned = text.replace(/```(?:json)?\n?/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

const SYSTEM_PROMPT =
  'You are an expert algorithmic trading analyst. ' +
  'Respond ONLY with valid JSON matching the requested schema. No prose outside JSON.';

// ---- Controller ------------------------------------------------------------

export class OpenClawController {
  private readonly router: AiRouter;

  constructor(config?: OpenClawConfig) {
    this.router = new AiRouter(config ?? loadOpenClawConfig());
  }

  /**
   * Analyze a trade and return structured sentiment + recommendation.
   * Complexity: standard
   */
  async analyzeTrade(tradeData: TradeResult): Promise<TradeAnalysis> {
    const prompt =
      `Analyze this trade and respond with JSON: ` +
      `{"sentiment":"bullish|bearish|neutral","riskLevel":"low|medium|high",` +
      `"recommendation":"string","keyFactors":["string"]}.\n\n` +
      `Trade: ${JSON.stringify(tradeData)}`;

    const res = await this.router.chat({ prompt, systemPrompt: SYSTEM_PROMPT, complexity: 'standard', maxTokens: 512 });

    return safeJsonParse<TradeAnalysis>(res.content, {
      sentiment: 'neutral',
      riskLevel: 'medium',
      recommendation: res.content,
      keyFactors: [],
    });
  }

  /**
   * Evaluate strategy performance against metrics.
   * Complexity: complex
   */
  async evaluateStrategy(
    strategyName: StrategyName,
    metrics: Record<string, unknown>,
  ): Promise<StrategyEvaluation> {
    const prompt =
      `Evaluate trading strategy "${strategyName}" with these metrics and respond with JSON: ` +
      `{"score":0-100,"strengths":["string"],"weaknesses":["string"],"suggestion":"string"}.\n\n` +
      `Metrics: ${JSON.stringify(metrics)}`;

    const res = await this.router.chat({ prompt, systemPrompt: SYSTEM_PROMPT, complexity: 'complex', maxTokens: 768 });

    return safeJsonParse<StrategyEvaluation>(res.content, {
      score: 50,
      strengths: [],
      weaknesses: [],
      suggestion: res.content,
    });
  }

  /**
   * Suggest parameter adjustments for a strategy based on recent performance.
   * Complexity: complex
   */
  async suggestParameters(
    strategy: StrategyName,
    currentParams: Record<string, unknown>,
    performanceData: Record<string, unknown>,
  ): Promise<ParameterSuggestion[]> {
    const prompt =
      `For strategy "${strategy}", suggest parameter improvements. ` +
      `Respond with a JSON array: [{"parameter":"name","currentValue":any,"suggestedValue":any,"rationale":"string"}].\n\n` +
      `Current params: ${JSON.stringify(currentParams)}\n` +
      `Performance: ${JSON.stringify(performanceData)}`;

    const res = await this.router.chat({ prompt, systemPrompt: SYSTEM_PROMPT, complexity: 'complex', maxTokens: 1024 });

    return safeJsonParse<ParameterSuggestion[]>(res.content, []);
  }

  /**
   * Fast AI query for binary or simple decisions.
   * Complexity: simple
   */
  async quickCheck(question: string): Promise<string> {
    const res = await this.router.chat({
      prompt: question,
      systemPrompt: 'You are a concise trading assistant. Answer briefly and directly.',
      complexity: 'simple',
      maxTokens: 256,
    });
    return res.content;
  }

  /**
   * Generate a human-readable performance report for a set of trades.
   * Complexity: standard
   */
  async generateReport(trades: TradeResult[], period: string): Promise<PerformanceReport> {
    const totalTrades = trades.length;
    const wins = trades.filter((t) => parseFloat(t.fees) >= 0).length; // proxy: positive fee means executed
    const winRate = totalTrades > 0 ? `${((wins / totalTrades) * 100).toFixed(1)}%` : '0%';

    const prompt =
      `Write a performance report for ${totalTrades} trades over "${period}". ` +
      `Respond with JSON: {"summary":"string","totalTrades":${totalTrades},"winRate":"${winRate}","highlights":["string"],"period":"${period}"}.\n\n` +
      `Trades sample (first 10): ${JSON.stringify(trades.slice(0, 10))}`;

    const res = await this.router.chat({ prompt, systemPrompt: SYSTEM_PROMPT, complexity: 'standard', maxTokens: 768 });

    return safeJsonParse<PerformanceReport>(res.content, {
      summary: res.content,
      totalTrades,
      winRate,
      highlights: [],
      period,
    });
  }
}
