import { describe, it, expect } from 'vitest';
import {
  computeConsensus,
  isActionable,
  DEFAULT_CONSENSUS_CONFIG,
  type ConsensusConfig,
} from '../../src/openclaw/signal-consensus.js';
import type { SignalScore } from '../../src/ml/signal-model.js';
import type { TradeAnalysis } from '../../src/openclaw/controller.js';

const bullishMl: SignalScore = { score: 0.7, confidence: 0.8, signals: ['RSI oversold (25.0)', 'MACD bullish crossover'] };
const bearishMl: SignalScore = { score: -0.6, confidence: 0.75, signals: ['RSI overbought (75.0)'] };
const neutralMl: SignalScore = { score: 0.05, confidence: 0.3, signals: [] };

const bullishAi: TradeAnalysis = { sentiment: 'bullish', riskLevel: 'low', recommendation: 'Buy', keyFactors: ['strong volume'] };
const bearishAi: TradeAnalysis = { sentiment: 'bearish', riskLevel: 'high', recommendation: 'Sell', keyFactors: ['declining momentum'] };
const neutralAi: TradeAnalysis = { sentiment: 'neutral', riskLevel: 'medium', recommendation: 'Hold', keyFactors: [] };

describe('Signal Consensus Engine', () => {
  it('should return strong_buy when both ML and AI are bullish', () => {
    const result = computeConsensus(bullishMl, bullishAi);
    expect(result.verdict).toBe('strong_buy');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.mlSignal).not.toBeNull();
    expect(result.aiAnalysis).not.toBeNull();
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('should return strong_sell when both ML and AI are bearish', () => {
    const result = computeConsensus(bearishMl, bearishAi);
    expect(result.verdict).toBe('strong_sell');
  });

  it('should return hold when signals conflict', () => {
    const result = computeConsensus(bullishMl, bearishAi);
    // With conflicting signals, score should be moderate
    expect(['hold', 'buy', 'sell']).toContain(result.verdict);
  });

  it('should work with ML signal only (no AI)', () => {
    const result = computeConsensus(bullishMl, null);
    expect(result.verdict).toBe('strong_buy');
    expect(result.aiAnalysis).toBeNull();
    expect(result.mlSignal).not.toBeNull();
  });

  it('should work with AI analysis only (no ML)', () => {
    const result = computeConsensus(null, bullishAi);
    expect(result.verdict).toBe('strong_buy');
    expect(result.mlSignal).toBeNull();
    expect(result.aiAnalysis).not.toBeNull();
  });

  it('should return hold with zero score when both null', () => {
    const result = computeConsensus(null, null);
    expect(result.verdict).toBe('hold');
    expect(result.confidence).toBe(0);
  });

  it('should include ML signal reasons', () => {
    const result = computeConsensus(bullishMl, null);
    const allReasons = result.reasons.join(' ');
    expect(allReasons).toContain('ML score');
    expect(allReasons).toContain('RSI oversold');
  });

  it('should include AI key factors', () => {
    const result = computeConsensus(null, bullishAi);
    const allReasons = result.reasons.join(' ');
    expect(allReasons).toContain('AI sentiment: bullish');
    expect(allReasons).toContain('strong volume');
  });

  it('should respect custom config weights', () => {
    const mlHeavy: ConsensusConfig = { ...DEFAULT_CONSENSUS_CONFIG, mlWeight: 0.9 };
    const result = computeConsensus(bearishMl, bullishAi, mlHeavy);
    // ML is heavily weighted and bearish, so should lean sell
    expect(['sell', 'strong_sell']).toContain(result.verdict);
  });

  it('should have timestamp', () => {
    const before = Date.now();
    const result = computeConsensus(bullishMl, bullishAi);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
  });
});

describe('isActionable', () => {
  it('should return true for high-confidence buy', () => {
    const result = computeConsensus(bullishMl, bullishAi);
    expect(isActionable(result)).toBe(true);
  });

  it('should return false for hold verdict', () => {
    const result = computeConsensus(neutralMl, neutralAi);
    expect(isActionable(result)).toBe(false);
  });

  it('should return false for low confidence', () => {
    const strictConfig: ConsensusConfig = { ...DEFAULT_CONSENSUS_CONFIG, minConfidence: 0.99 };
    const result = computeConsensus(bullishMl, bullishAi, strictConfig);
    expect(isActionable(result, strictConfig)).toBe(false);
  });

  it('should return true for sell signal above confidence threshold', () => {
    const result = computeConsensus(bearishMl, bearishAi);
    expect(isActionable(result)).toBe(true);
  });
});
