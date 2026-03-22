// AI Signal Consensus Engine — combines ML scoring + OpenClaw AI analysis
// Provides multi-source confidence scoring for trade decisions
// Used by strategy engines to validate signals before execution

import type { SignalScore } from '../ml/signal-model.js';
import type { TradeAnalysis } from './controller.js';

export type ConsensusVerdict = 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';

export interface ConsensusResult {
  /** Final consensus verdict */
  verdict: ConsensusVerdict;
  /** Combined confidence 0-1 (weighted average of ML + AI confidence) */
  confidence: number;
  /** ML signal contribution */
  mlSignal: { score: number; confidence: number } | null;
  /** AI analysis contribution */
  aiAnalysis: { sentiment: string; riskLevel: string } | null;
  /** Human-readable reasoning */
  reasons: string[];
  /** Timestamp of consensus computation */
  timestamp: number;
}

export interface ConsensusConfig {
  /** Weight for ML signal score (0-1, remainder goes to AI) */
  mlWeight: number;
  /** Minimum combined confidence to act on signal */
  minConfidence: number;
  /** Score thresholds for verdict mapping */
  thresholds: {
    strongBuy: number;
    buy: number;
    sell: number;
    strongSell: number;
  };
}

export const DEFAULT_CONSENSUS_CONFIG: ConsensusConfig = {
  mlWeight: 0.6,
  minConfidence: 0.5,
  thresholds: {
    strongBuy: 0.6,
    buy: 0.2,
    sell: -0.2,
    strongSell: -0.6,
  },
};

// Map AI sentiment to numeric score
function sentimentToScore(sentiment: string): number {
  switch (sentiment) {
    case 'bullish': return 0.7;
    case 'bearish': return -0.7;
    default: return 0;
  }
}

// Map AI risk level to confidence modifier
function riskToConfidence(riskLevel: string): number {
  switch (riskLevel) {
    case 'low': return 0.9;
    case 'medium': return 0.6;
    case 'high': return 0.3;
    default: return 0.5;
  }
}

function scoreToVerdict(score: number, thresholds: ConsensusConfig['thresholds']): ConsensusVerdict {
  if (score >= thresholds.strongBuy) return 'strong_buy';
  if (score >= thresholds.buy) return 'buy';
  if (score <= thresholds.strongSell) return 'strong_sell';
  if (score <= thresholds.sell) return 'sell';
  return 'hold';
}

/**
 * Compute consensus from ML signal and/or AI analysis.
 * Either source can be null — consensus degrades gracefully.
 */
export function computeConsensus(
  mlSignal: SignalScore | null,
  aiAnalysis: TradeAnalysis | null,
  config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG,
): ConsensusResult {
  const reasons: string[] = [];
  let combinedScore = 0;
  let combinedConfidence = 0;
  let totalWeight = 0;

  // ML contribution
  if (mlSignal) {
    const mlScore = mlSignal.score * config.mlWeight;
    combinedScore += mlScore;
    combinedConfidence += mlSignal.confidence * config.mlWeight;
    totalWeight += config.mlWeight;
    reasons.push(`ML score: ${mlSignal.score.toFixed(3)} (conf: ${mlSignal.confidence.toFixed(2)})`);
    if (mlSignal.signals.length > 0) {
      reasons.push(`ML signals: ${mlSignal.signals.join(', ')}`);
    }
  }

  // AI contribution
  const aiWeight = 1 - config.mlWeight;
  if (aiAnalysis) {
    const aiScore = sentimentToScore(aiAnalysis.sentiment) * aiWeight;
    const aiConf = riskToConfidence(aiAnalysis.riskLevel) * aiWeight;
    combinedScore += aiScore;
    combinedConfidence += aiConf;
    totalWeight += aiWeight;
    reasons.push(`AI sentiment: ${aiAnalysis.sentiment} (risk: ${aiAnalysis.riskLevel})`);
    if (aiAnalysis.keyFactors.length > 0) {
      reasons.push(`Key factors: ${aiAnalysis.keyFactors.join(', ')}`);
    }
  }

  // Normalize
  if (totalWeight > 0) {
    combinedScore /= totalWeight;
    combinedConfidence /= totalWeight;
  }

  const verdict = scoreToVerdict(combinedScore, config.thresholds);

  return {
    verdict,
    confidence: combinedConfidence,
    mlSignal: mlSignal ? { score: mlSignal.score, confidence: mlSignal.confidence } : null,
    aiAnalysis: aiAnalysis ? { sentiment: aiAnalysis.sentiment, riskLevel: aiAnalysis.riskLevel } : null,
    reasons,
    timestamp: Date.now(),
  };
}

/**
 * Check if consensus result is actionable (confidence meets threshold).
 */
export function isActionable(result: ConsensusResult, config: ConsensusConfig = DEFAULT_CONSENSUS_CONFIG): boolean {
  if (result.verdict === 'hold') return false;
  return result.confidence >= config.minConfidence;
}
