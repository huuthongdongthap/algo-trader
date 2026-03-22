import { describe, it, expect, vi } from 'vitest';
import { AlgorithmTuner, type TuningProposal, type PerformanceData } from '../../src/openclaw/algorithm-tuner.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';

function makeMockRouter(response: string): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, model: 'test-model' }),
  } as unknown as AiRouter;
}

function makePerf(overrides: Partial<PerformanceData> = {}): PerformanceData {
  return {
    winRate: 0.55,
    sharpeRatio: 1.2,
    maxDrawdown: 0.08,
    totalTrades: 100,
    avgPnlPerTrade: '0.003',
    recentPnlTrend: 'stable',
    ...overrides,
  };
}

describe('AlgorithmTuner', () => {
  describe('proposeTuning', () => {
    it('should parse valid AI response', async () => {
      const aiResponse = JSON.stringify({
        suggestedParams: { gridSpacing: 0.005 },
        reasoning: 'Tighter grid for current volatility',
        confidence: 0.8,
        expectedImprovement: 5,
      });
      const router = makeMockRouter(aiResponse);
      const tuner = new AlgorithmTuner(router);
      const proposal = await tuner.proposeTuning(
        'grid-dca',
        { gridSpacing: 0.01 },
        makePerf(),
      );
      expect(proposal.suggestedParams.gridSpacing).toBe(0.005);
      expect(proposal.confidence).toBe(0.8);
      expect(proposal.reasoning).toContain('Tighter grid');
    });

    it('should handle malformed AI response gracefully', async () => {
      const router = makeMockRouter('this is not json');
      const tuner = new AlgorithmTuner(router);
      const proposal = await tuner.proposeTuning('grid-dca', {}, makePerf());
      expect(proposal.suggestedParams).toEqual({});
      expect(proposal.confidence).toBe(0);
      expect(proposal.reasoning).toContain('could not be parsed');
    });

    it('should handle markdown-wrapped JSON', async () => {
      const aiResponse = '```json\n{"suggestedParams":{"size":10},"reasoning":"ok","confidence":0.7,"expectedImprovement":2}\n```';
      const router = makeMockRouter(aiResponse);
      const tuner = new AlgorithmTuner(router);
      const proposal = await tuner.proposeTuning('grid-dca', { size: 8 }, makePerf());
      expect(proposal.suggestedParams.size).toBe(10);
    });

    it('should clamp confidence to [0,1]', async () => {
      const aiResponse = JSON.stringify({
        suggestedParams: {},
        reasoning: 'test',
        confidence: 5.0,
        expectedImprovement: 0,
      });
      const router = makeMockRouter(aiResponse);
      const tuner = new AlgorithmTuner(router);
      const proposal = await tuner.proposeTuning('grid-dca', {}, makePerf());
      expect(proposal.confidence).toBe(1);
    });
  });

  describe('validateProposal', () => {
    const tuner = new AlgorithmTuner({} as AiRouter);

    it('should pass safe changes', () => {
      const proposal: TuningProposal = {
        strategy: 'grid-dca',
        currentParams: { positionSize: 100, spreadPct: 0.02 },
        suggestedParams: { positionSize: 120, spreadPct: 0.025 },
        reasoning: 'ok',
        confidence: 0.8,
        expectedImprovement: 3,
      };
      expect(tuner.validateProposal(proposal)).toEqual([]);
    });

    it('should flag position size change > 50%', () => {
      const proposal: TuningProposal = {
        strategy: 'grid-dca',
        currentParams: { positionSize: 100 },
        suggestedParams: { positionSize: 200 },
        reasoning: 'double',
        confidence: 0.9,
        expectedImprovement: 10,
      };
      const violations = tuner.validateProposal(proposal);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]).toContain('exceeds max');
    });

    it('should flag spread change > 100%', () => {
      const proposal: TuningProposal = {
        strategy: 'grid-dca',
        currentParams: { spreadPct: 0.01 },
        suggestedParams: { spreadPct: 0.05 },
        reasoning: 'widen',
        confidence: 0.7,
        expectedImprovement: 5,
      };
      const violations = tuner.validateProposal(proposal);
      expect(violations.length).toBeGreaterThan(0);
    });

    it('should flag stop-loss below minimum', () => {
      const proposal: TuningProposal = {
        strategy: 'grid-dca',
        currentParams: { stopLoss: 0.05 },
        suggestedParams: { stopLoss: 0.0001 },
        reasoning: 'tight stop',
        confidence: 0.6,
        expectedImprovement: -1,
      };
      const violations = tuner.validateProposal(proposal);
      expect(violations.some(v => v.includes('stop-loss cannot'))).toBe(true);
    });

    it('should flag disabling stop-loss', () => {
      const proposal: TuningProposal = {
        strategy: 'grid-dca',
        currentParams: { stopEnabled: true },
        suggestedParams: { stopEnabled: false },
        reasoning: 'disable stop',
        confidence: 0.3,
        expectedImprovement: -5,
      };
      const violations = tuner.validateProposal(proposal);
      expect(violations.some(v => v.includes('must never be disabled'))).toBe(true);
    });

    it('should allow new non-numeric params', () => {
      const proposal: TuningProposal = {
        strategy: 'grid-dca',
        currentParams: { mode: 'aggressive' },
        suggestedParams: { mode: 'conservative' },
        reasoning: 'safe',
        confidence: 0.9,
        expectedImprovement: 2,
      };
      expect(tuner.validateProposal(proposal)).toEqual([]);
    });
  });
});
