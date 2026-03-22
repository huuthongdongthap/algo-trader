import { describe, it, expect, vi } from 'vitest';
import { adjustRisk, riskLimitsToParams } from '../../src/openclaw/ai-risk-adjuster.js';
import type { RiskParams } from '../../src/openclaw/ai-risk-adjuster.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';
import type { RiskLimits } from '../../src/core/types.js';

vi.mock('../../src/core/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeRouter(response: string): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, model: 'test-model', tokensUsed: 10, latencyMs: 30 }),
  } as unknown as AiRouter;
}

const baseRisk: RiskParams = {
  maxPositionSize: 1000,
  stopLossPercent: 0.05,
  takeProfitPercent: 0.10,
  maxLeverage: 3,
};

describe('adjustRisk', () => {
  describe('happy path', () => {
    it('returns AI-adjusted params within base bounds', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: 800,
        stopLossPercent: 0.03,
        takeProfitPercent: 0.08,
        maxLeverage: 2,
        confidence: 0.85,
        reasoning: 'Bearish sentiment — reduce exposure',
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'bearish', -0.02, router);

      expect(result.maxPositionSize).toBe(800);
      expect(result.stopLossPercent).toBe(0.03);
      expect(result.takeProfitPercent).toBe(0.08);
      expect(result.maxLeverage).toBe(2);
      expect(result.confidence).toBe(0.85);
      expect(result.reasoning).toBe('Bearish sentiment — reduce exposure');
    });

    it('clamps AI response that tries to increase risk beyond base', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: 9999,  // above base
        stopLossPercent: 0.20,  // above base
        takeProfitPercent: 0.50, // above base
        maxLeverage: 10,         // above base
        confidence: 0.9,
        reasoning: 'Trying to be aggressive',
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'bullish', 0.05, router);

      // Must not exceed base
      expect(result.maxPositionSize).toBe(baseRisk.maxPositionSize);
      expect(result.stopLossPercent).toBe(baseRisk.stopLossPercent);
      expect(result.takeProfitPercent).toBe(baseRisk.takeProfitPercent);
      expect(result.maxLeverage).toBe(baseRisk.maxLeverage);
    });

    it('clamps confidence to [0, 1]', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: 500,
        stopLossPercent: 0.02,
        takeProfitPercent: 0.06,
        maxLeverage: 1,
        confidence: 1.5,
        reasoning: 'over-confident',
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'neutral', 0, router);
      expect(result.confidence).toBe(1.0);
    });

    it('handles partial AI response — uses base for missing fields', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: 700,
        confidence: 0.6,
        reasoning: 'partial response',
        // stopLossPercent, takeProfitPercent, maxLeverage missing
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'neutral', 0.01, router);

      expect(result.maxPositionSize).toBe(700);
      expect(result.stopLossPercent).toBe(baseRisk.stopLossPercent);
      expect(result.takeProfitPercent).toBe(baseRisk.takeProfitPercent);
      expect(result.maxLeverage).toBe(baseRisk.maxLeverage);
    });

    it('handles markdown-wrapped JSON', async () => {
      const inner = JSON.stringify({
        maxPositionSize: 600,
        stopLossPercent: 0.04,
        takeProfitPercent: 0.09,
        maxLeverage: 2,
        confidence: 0.7,
        reasoning: 'wrapped',
      });
      const router = makeRouter(`\`\`\`json\n${inner}\n\`\`\``);
      const result = await adjustRisk(baseRisk, 'neutral', 0, router);
      expect(result.maxPositionSize).toBeLessThanOrEqual(baseRisk.maxPositionSize);
    });
  });

  describe('fallback behavior', () => {
    it('returns base params when AI is unavailable', async () => {
      const router = {
        chat: vi.fn().mockRejectedValue(new Error('Gateway timeout')),
      } as unknown as AiRouter;

      const result = await adjustRisk(baseRisk, 'bearish', -0.1, router);

      expect(result.maxPositionSize).toBe(baseRisk.maxPositionSize);
      expect(result.stopLossPercent).toBe(baseRisk.stopLossPercent);
      expect(result.takeProfitPercent).toBe(baseRisk.takeProfitPercent);
      expect(result.maxLeverage).toBe(baseRisk.maxLeverage);
      expect(result.confidence).toBe(1.0);
    });

    it('returns base params when AI returns non-JSON', async () => {
      const router = makeRouter('I recommend reducing your position sizes in this volatile market.');
      const result = await adjustRisk(baseRisk, 'volatile', -0.05, router);

      expect(result.maxPositionSize).toBe(baseRisk.maxPositionSize);
      expect(result.confidence).toBe(1.0);
      expect(result.reasoning).toContain('AI unavailable');
    });
  });

  describe('edge cases', () => {
    it('handles negative PnL correctly', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: 400,
        stopLossPercent: 0.02,
        takeProfitPercent: 0.05,
        maxLeverage: 1,
        confidence: 0.9,
        reasoning: 'Reduce risk after losses',
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'fearful', -500, router);

      expect(result.maxPositionSize).toBe(400);
      expect(result.maxLeverage).toBe(1);
    });

    it('maxLeverage floor is 1 (no fractional leverage from AI)', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: 100,
        stopLossPercent: 0.01,
        takeProfitPercent: 0.02,
        maxLeverage: 0.5,  // below 1 — should be clamped to 1
        confidence: 0.8,
        reasoning: 'ultra conservative',
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'crash', -1000, router);
      expect(result.maxLeverage).toBeGreaterThanOrEqual(1);
    });

    it('maxPositionSize floor is 0', async () => {
      const aiJson = JSON.stringify({
        maxPositionSize: -100, // negative — should become 0
        stopLossPercent: 0.01,
        takeProfitPercent: 0.02,
        maxLeverage: 1,
        confidence: 0.5,
        reasoning: 'extreme caution',
      });
      const router = makeRouter(aiJson);
      const result = await adjustRisk(baseRisk, 'crash', -5000, router);
      expect(result.maxPositionSize).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('riskLimitsToParams', () => {
  it('converts RiskLimits to RiskParams correctly', () => {
    const limits: RiskLimits = {
      maxPositionSize: '2500',
      maxDrawdown: 0.20,
      maxOpenPositions: 5,
      stopLossPercent: 0.05,
      maxLeverage: 4,
    };
    const params = riskLimitsToParams(limits);

    expect(params.maxPositionSize).toBe(2500);
    expect(params.stopLossPercent).toBe(0.05);
    expect(params.takeProfitPercent).toBe(0.10); // 2x stopLoss
    expect(params.maxLeverage).toBe(4);
  });
});
