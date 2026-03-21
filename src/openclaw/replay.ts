// Replay engine — re-run past AI decisions against current market data for backtesting
// Measures AI tuner consistency: would the AI make the same call today?

import type { AiDecision } from './decision-logger.js';

export interface MarketSnapshot {
  /** Arbitrary current market context passed back into the AI simulator */
  [key: string]: unknown;
}

export interface ReplayResult {
  decision: AiDecision;
  /** Output the AI would produce if re-run with current data */
  simulatedOutput: string;
  /** Confidence of the replayed decision */
  simulatedConfidence: number;
  /** Actual recorded outcome from original decision (optional, set externally) */
  actualOutcome?: string;
  /** True if replayed output semantically matches original output */
  match: boolean;
}

export interface AccuracyReport {
  total: number;
  matched: number;
  accuracyPct: number;
  /** Breakdown of match rate per decision type */
  byType: Record<string, { total: number; matched: number; pct: number }>;
  /** Average confidence delta (simulated - original) */
  avgConfidenceDelta: number;
}

/**
 * Simulate re-running a single AI decision with current market data.
 * In production, replace the stub body with a real AI call (e.g. OpenAI / local LLM).
 * The stub uses deterministic hashing so unit tests are predictable without mocking.
 */
export async function replayDecision(
  decision: AiDecision,
  currentData: MarketSnapshot
): Promise<ReplayResult> {
  // --- Replace this block with actual AI call in production ---
  const contextKey = JSON.stringify(currentData).length + decision.type.length;
  const simulatedConfidence = Math.min(1, Math.max(0, decision.confidence + (contextKey % 11 - 5) / 100));
  const simulatedOutput = `[replay:${decision.type}] confidence=${simulatedConfidence.toFixed(3)} input_len=${decision.input.length}`;
  // -----------------------------------------------------------

  const match = _outputsMatch(decision.output, simulatedOutput, decision.type);

  return { decision, simulatedOutput, simulatedConfidence, match };
}

/**
 * Replay a batch of decisions concurrently (Promise.all).
 * Pass the same currentData snapshot for consistent comparison.
 */
export async function replayBatch(
  decisions: AiDecision[],
  currentData: MarketSnapshot
): Promise<ReplayResult[]> {
  return Promise.all(decisions.map(d => replayDecision(d, currentData)));
}

/**
 * Calculate what percentage of past AI decisions would still be made today.
 * High accuracy = AI tuner is consistent; low accuracy = drift detected.
 */
export function calculateAccuracy(results: ReplayResult[]): AccuracyReport {
  if (results.length === 0) {
    return { total: 0, matched: 0, accuracyPct: 0, byType: {}, avgConfidenceDelta: 0 };
  }

  const byType: Record<string, { total: number; matched: number; pct: number }> = {};
  let matched = 0;
  let totalConfDelta = 0;

  for (const r of results) {
    const t = r.decision.type;
    if (!byType[t]) byType[t] = { total: 0, matched: 0, pct: 0 };
    byType[t].total++;
    if (r.match) {
      matched++;
      byType[t].matched++;
    }
    totalConfDelta += r.simulatedConfidence - r.decision.confidence;
  }

  // Finalise per-type percentages
  for (const entry of Object.values(byType)) {
    entry.pct = entry.total ? (entry.matched / entry.total) * 100 : 0;
  }

  return {
    total: results.length,
    matched,
    accuracyPct: (matched / results.length) * 100,
    byType,
    avgConfidenceDelta: totalConfDelta / results.length,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Loose semantic match: for real AI outputs use embedding cosine similarity.
 * Here we compare normalised type prefix and confidence bucket (±0.1 tolerance).
 */
function _outputsMatch(original: string, simulated: string, type: string): boolean {
  const orig = original.toLowerCase();
  const sim  = simulated.toLowerCase();

  // Both mention the same decision type = rough semantic alignment
  if (!sim.includes(type)) return false;

  // Extract confidence values if present and compare within tolerance
  const origConf  = _extractConfidence(orig);
  const simConf   = _extractConfidence(sim);
  if (origConf !== null && simConf !== null) {
    return Math.abs(origConf - simConf) <= 0.1;
  }

  // Fallback: first 30 chars overlap
  return orig.slice(0, 30) === sim.slice(0, 30);
}

function _extractConfidence(text: string): number | null {
  const m = text.match(/confidence[=:\s]+([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}
