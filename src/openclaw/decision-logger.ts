// Decision Logger — in-memory circular buffer + SQLite persistence for AI trading decisions
// Provides structured audit trail: analysis, tuning, alert, report decision types

import { initDecisionStore, type DecisionStore } from './decision-store.js';

export type DecisionType = 'analysis' | 'tuning' | 'alert' | 'report';

export interface AiDecision {
  id: string;
  timestamp: number;
  type: DecisionType;
  /** Short summary of what was fed to the AI (avoid storing raw large inputs) */
  input: string;
  /** Short summary of AI response */
  output: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
  /** Whether this decision was actually applied to trading logic */
  applied: boolean;
  /** 0-1 confidence score from AI response */
  confidence: number;
}

export interface DecisionStats {
  total: number;
  byType: Record<DecisionType, number>;
  avgConfidence: number;
  avgLatencyMs: number;
}

const BUFFER_SIZE = 500;

export class DecisionLogger {
  private buffer: AiDecision[] = [];
  private head = 0; // next write index (circular)
  private count = 0; // total items in buffer (capped at BUFFER_SIZE)
  private store: DecisionStore;

  constructor(dbPath = 'data/algo-trade.db') {
    this.store = initDecisionStore(dbPath);
  }

  /** Log a decision to both memory buffer and SQLite */
  logDecision(decision: AiDecision): void {
    // Write into circular slot
    this.buffer[this.head] = decision;
    this.head = (this.head + 1) % BUFFER_SIZE;
    if (this.count < BUFFER_SIZE) this.count++;

    // Persist to store
    this.store.saveDecision({
      id:             decision.id,
      timestamp:      decision.timestamp,
      type:           decision.type,
      input_summary:  decision.input,
      output_summary: decision.output,
      model:          decision.model,
      tokens:         decision.tokensUsed,
      latency_ms:     decision.latencyMs,
      applied:        decision.applied ? 1 : 0,
      confidence:     decision.confidence,
    });
  }

  /** Return last N decisions from memory buffer (newest first) */
  getRecentDecisions(limit = 20): AiDecision[] {
    if (this.count === 0) return [];
    const n = Math.min(limit, this.count);
    const result: AiDecision[] = [];
    for (let i = 1; i <= n; i++) {
      const idx = (this.head - i + BUFFER_SIZE) % BUFFER_SIZE;
      result.push(this.buffer[idx]);
    }
    return result;
  }

  /** Filter in-memory buffer by decision type */
  getDecisionsByType(type: DecisionType): AiDecision[] {
    return this.getRecentDecisions(this.count).filter(d => d.type === type);
  }

  /** Aggregate stats across all in-memory buffered decisions */
  getStats(): DecisionStats {
    const decisions = this.getRecentDecisions(this.count);
    const byType: Record<string, number> = {};
    let totalConf = 0;
    let totalLatency = 0;

    for (const d of decisions) {
      byType[d.type] = (byType[d.type] ?? 0) + 1;
      totalConf += d.confidence;
      totalLatency += d.latencyMs;
    }

    const total = decisions.length;
    return {
      total,
      byType: byType as Record<DecisionType, number>,
      avgConfidence: total ? totalConf / total : 0,
      avgLatencyMs:  total ? totalLatency / total : 0,
    };
  }

  /** Query decisions from persistent store (bypasses memory buffer, full history) */
  queryFromStore(filters: Parameters<DecisionStore['queryDecisions']>[0]): ReturnType<DecisionStore['queryDecisions']> {
    return this.store.queryDecisions(filters);
  }

  /** Get persistent stats for a rolling window (e.g. last 24h = 86_400_000 ms) */
  getStoreStats(periodMs: number): ReturnType<DecisionStore['getDecisionStats']> {
    return this.store.getDecisionStats(periodMs);
  }

  close(): void { this.store.close(); }
}

let _logger: DecisionLogger | null = null;

export function getDecisionLogger(dbPath = 'data/algo-trade.db'): DecisionLogger {
  if (!_logger) _logger = new DecisionLogger(dbPath);
  return _logger;
}
