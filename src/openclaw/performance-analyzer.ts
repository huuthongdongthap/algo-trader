// Performance Analyzer: feeds trade snapshot data to OpenClaw AI for analysis
// Handles anomaly detection, daily reports, and structured AI response parsing
import type { AiRouter } from './ai-router.js';
import type { TradeSnapshot } from './trade-observer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthAssessment = 'healthy' | 'warning' | 'critical';

export interface AnalysisResult {
  assessment: HealthAssessment;
  insights: string[];
  suggestions: string[];
  confidence: number;   // 0-1
}

export interface AnomalyReport {
  detected: boolean;
  anomalies: string[];
  severity: 'none' | 'low' | 'medium' | 'high';
}

export interface DailyReport {
  date: string;
  summary: string;
  topPerformingStrategies: string[];
  riskFlags: string[];
  recommendations: string[];
  overallScore: number;   // 0-100
}

// Shape we expect AI to return as JSON for analyzeSnapshot
interface RawAnalysisJson {
  assessment?: string;
  insights?: unknown[];
  suggestions?: unknown[];
  confidence?: number;
}

// Shape we expect AI to return as JSON for detectAnomalies
interface RawAnomalyJson {
  detected?: boolean;
  anomalies?: unknown[];
  severity?: string;
}

// Shape we expect AI to return as JSON for generateDailyReport
interface RawDailyJson {
  date?: string;
  summary?: string;
  topPerformingStrategies?: unknown[];
  riskFlags?: unknown[];
  recommendations?: unknown[];
  overallScore?: number;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function snapshotToText(snapshot: TradeSnapshot): string {
  return [
    `Timestamp: ${new Date(snapshot.timestamp).toISOString()}`,
    `Recent trades: ${snapshot.recentTrades.length}`,
    `Win rate: ${(snapshot.winRate * 100).toFixed(1)}%`,
    `Avg return: ${snapshot.avgReturn.toFixed(4)}`,
    `Drawdown: ${(snapshot.drawdown * 100).toFixed(2)}%`,
    `Active strategies: ${snapshot.activeStrategies.join(', ') || 'none'}`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

function tryParseJson<T>(text: string): T | null {
  // Extract first JSON object/array from the response (AI may wrap in markdown)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

function toStringArray(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((v): v is string => typeof v === 'string');
}

// ---------------------------------------------------------------------------
// PerformanceAnalyzer
// ---------------------------------------------------------------------------

export class PerformanceAnalyzer {
  private readonly ai: AiRouter;

  constructor(ai: AiRouter) {
    this.ai = ai;
  }

  /**
   * Analyze a single snapshot with standard complexity.
   * Returns structured assessment, insights, and suggestions.
   */
  async analyzeSnapshot(snapshot: TradeSnapshot): Promise<AnalysisResult> {
    const prompt = [
      'You are a quantitative trading analyst. Analyze this trading snapshot and respond ONLY with valid JSON.',
      '',
      snapshotToText(snapshot),
      '',
      'Respond with this exact JSON shape:',
      '{"assessment":"healthy|warning|critical","insights":["..."],"suggestions":["..."],"confidence":0.0}',
    ].join('\n');

    const response = await this.ai.chat({
      prompt,
      systemPrompt: 'You are a concise quant analyst. Always respond with valid JSON only.',
      complexity: 'standard',
      maxTokens: 512,
    });

    const parsed = tryParseJson<RawAnalysisJson>(response.content);
    if (!parsed) {
      // Fallback: wrap raw text as a single insight
      return {
        assessment: 'warning',
        insights: [response.content.slice(0, 300)],
        suggestions: ['Unable to parse structured response — review raw AI output.'],
        confidence: 0.3,
      };
    }

    const assessment = ['healthy', 'warning', 'critical'].includes(parsed.assessment ?? '')
      ? (parsed.assessment as HealthAssessment)
      : 'warning';

    return {
      assessment,
      insights: toStringArray(parsed.insights),
      suggestions: toStringArray(parsed.suggestions),
      confidence: typeof parsed.confidence === 'number' ? Math.min(1, Math.max(0, parsed.confidence)) : 0.5,
    };
  }

  /**
   * AI-powered anomaly detection. Uses simple complexity for fast response.
   */
  async detectAnomalies(snapshot: TradeSnapshot): Promise<AnomalyReport> {
    const prompt = [
      'Identify trading anomalies in this snapshot. Respond ONLY with valid JSON.',
      '',
      snapshotToText(snapshot),
      '',
      'JSON shape: {"detected":true,"anomalies":["..."],"severity":"none|low|medium|high"}',
    ].join('\n');

    const response = await this.ai.chat({
      prompt,
      systemPrompt: 'You are a risk monitoring system. Respond with valid JSON only.',
      complexity: 'simple',
      maxTokens: 256,
    });

    const parsed = tryParseJson<RawAnomalyJson>(response.content);
    if (!parsed) {
      return { detected: false, anomalies: [], severity: 'none' };
    }

    const validSeverities = ['none', 'low', 'medium', 'high'];
    const severity = validSeverities.includes(parsed.severity ?? '')
      ? (parsed.severity as AnomalyReport['severity'])
      : 'none';

    return {
      detected: parsed.detected ?? false,
      anomalies: toStringArray(parsed.anomalies),
      severity,
    };
  }

  /**
   * Comprehensive daily report from multiple snapshots. Uses complex model.
   */
  async generateDailyReport(snapshots: TradeSnapshot[]): Promise<DailyReport> {
    const date = new Date().toISOString().slice(0, 10);

    const summaryLines = snapshots.map((s, i) =>
      `[${i + 1}] ${new Date(s.timestamp).toISOString()} | trades=${s.recentTrades.length} ` +
      `winRate=${(s.winRate * 100).toFixed(1)}% drawdown=${(s.drawdown * 100).toFixed(2)}% ` +
      `strategies=${s.activeStrategies.join(',') || 'none'}`
    );

    const prompt = [
      `Generate a comprehensive daily trading report for ${date}. Respond ONLY with valid JSON.`,
      '',
      'Snapshots:',
      summaryLines.join('\n'),
      '',
      'JSON shape:',
      '{"date":"YYYY-MM-DD","summary":"...","topPerformingStrategies":["..."],' +
      '"riskFlags":["..."],"recommendations":["..."],"overallScore":0}',
    ].join('\n');

    const response = await this.ai.chat({
      prompt,
      systemPrompt: 'You are a senior quantitative analyst writing a daily trading report. Respond with valid JSON only.',
      complexity: 'complex',
      maxTokens: 1024,
    });

    const parsed = tryParseJson<RawDailyJson>(response.content);
    if (!parsed) {
      return {
        date,
        summary: response.content.slice(0, 500),
        topPerformingStrategies: [],
        riskFlags: ['Could not parse structured AI response.'],
        recommendations: [],
        overallScore: 0,
      };
    }

    const score = typeof parsed.overallScore === 'number'
      ? Math.min(100, Math.max(0, parsed.overallScore))
      : 0;

    return {
      date: typeof parsed.date === 'string' ? parsed.date : date,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      topPerformingStrategies: toStringArray(parsed.topPerformingStrategies),
      riskFlags: toStringArray(parsed.riskFlags),
      recommendations: toStringArray(parsed.recommendations),
      overallScore: score,
    };
  }
}
