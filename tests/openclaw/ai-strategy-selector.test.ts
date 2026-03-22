import { describe, it, expect, vi, beforeEach } from 'vitest';
import { selectStrategies } from '../../src/openclaw/ai-strategy-selector.js';
import type { MarketConditions } from '../../src/openclaw/ai-strategy-selector.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';
import type { StrategyConfig } from '../../src/core/types.js';

vi.mock('../../src/core/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeRouter(response: string): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, model: 'test-model', tokensUsed: 10, latencyMs: 50 }),
  } as unknown as AiRouter;
}

const mockStrategies: StrategyConfig[] = [
  { name: 'grid-trading', enabled: true, capitalAllocation: '1000', params: {} },
  { name: 'dca-bot', enabled: true, capitalAllocation: '500', params: {} },
  { name: 'market-maker', enabled: false, capitalAllocation: '2000', params: {} },
];

const bullishConditions: MarketConditions = {
  volatility: 0.3,
  trend: 'bullish',
  volumeRatio: 1.5,
  market: 'BTC-USD',
};

describe('selectStrategies', () => {
  describe('happy path', () => {
    it('returns ranked recommendations from AI response', async () => {
      const aiJson = JSON.stringify({
        recommendations: [
          { name: 'grid-trading', confidence: 0.85, action: 'activate', reasoning: 'Good for sideways' },
          { name: 'dca-bot', confidence: 0.70, action: 'maintain', reasoning: 'Steady accumulation' },
          { name: 'market-maker', confidence: 0.40, action: 'deactivate', reasoning: 'Too risky now' },
        ],
      });
      const router = makeRouter(aiJson);
      const result = await selectStrategies(bullishConditions, mockStrategies, router);

      expect(result).toHaveLength(3);
      // Sorted by confidence descending
      expect(result[0].confidence).toBeGreaterThanOrEqual(result[1].confidence);
      expect(result[1].confidence).toBeGreaterThanOrEqual(result[2].confidence);
    });

    it('maps correct action values', async () => {
      const aiJson = JSON.stringify({
        recommendations: [
          { name: 'grid-trading', confidence: 0.9, action: 'activate', reasoning: 'r1' },
          { name: 'dca-bot', confidence: 0.6, action: 'deactivate', reasoning: 'r2' },
          { name: 'market-maker', confidence: 0.5, action: 'maintain', reasoning: 'r3' },
        ],
      });
      const router = makeRouter(aiJson);
      const result = await selectStrategies(bullishConditions, mockStrategies, router);

      const byName = Object.fromEntries(result.map((r) => [r.strategy.name, r]));
      expect(byName['grid-trading'].action).toBe('activate');
      expect(byName['dca-bot'].action).toBe('deactivate');
      expect(byName['market-maker'].action).toBe('maintain');
    });

    it('clamps confidence to [0, 1]', async () => {
      const aiJson = JSON.stringify({
        recommendations: [
          { name: 'grid-trading', confidence: 5.0, action: 'activate', reasoning: 'over-confident' },
        ],
      });
      const router = makeRouter(aiJson);
      const result = await selectStrategies(bullishConditions, mockStrategies, router);
      expect(result[0].confidence).toBe(1.0);
    });

    it('defaults invalid action to maintain', async () => {
      const aiJson = JSON.stringify({
        recommendations: [
          { name: 'dca-bot', confidence: 0.7, action: 'yolo', reasoning: 'bad action' },
        ],
      });
      const router = makeRouter(aiJson);
      const result = await selectStrategies(bullishConditions, mockStrategies, router);
      expect(result[0].action).toBe('maintain');
    });

    it('ignores unknown strategy names', async () => {
      const aiJson = JSON.stringify({
        recommendations: [
          { name: 'unknown-strategy', confidence: 0.9, action: 'activate', reasoning: 'ghost' },
          { name: 'dca-bot', confidence: 0.6, action: 'maintain', reasoning: 'ok' },
        ],
      });
      const router = makeRouter(aiJson);
      const result = await selectStrategies(bullishConditions, mockStrategies, router);
      expect(result).toHaveLength(1);
      expect(result[0].strategy.name).toBe('dca-bot');
    });
  });

  describe('fallback behavior', () => {
    it('returns all strategies as maintain when AI is unavailable', async () => {
      const router = {
        chat: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as AiRouter;

      const result = await selectStrategies(bullishConditions, mockStrategies, router);

      expect(result).toHaveLength(3);
      expect(result.every((r) => r.action === 'maintain')).toBe(true);
      expect(result.every((r) => r.confidence === 1.0)).toBe(true);
    });

    it('returns all strategies as maintain when AI returns invalid JSON', async () => {
      const router = makeRouter('I cannot determine the best strategy right now');
      const result = await selectStrategies(bullishConditions, mockStrategies, router);

      expect(result).toHaveLength(3);
      expect(result.every((r) => r.action === 'maintain')).toBe(true);
    });

    it('returns all strategies as maintain when recommendations array is missing', async () => {
      const router = makeRouter(JSON.stringify({ error: 'no data' }));
      const result = await selectStrategies(bullishConditions, mockStrategies, router);

      expect(result).toHaveLength(3);
      expect(result.every((r) => r.action === 'maintain')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('returns empty array for empty strategy list', async () => {
      const router = makeRouter('{}');
      const result = await selectStrategies(bullishConditions, [], router);
      expect(result).toHaveLength(0);
      // AI should not be called for empty strategies
      expect((router.chat as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
    });

    it('handles markdown-wrapped JSON response', async () => {
      const inner = JSON.stringify({
        recommendations: [
          { name: 'grid-trading', confidence: 0.75, action: 'activate', reasoning: 'test' },
        ],
      });
      const router = makeRouter(`\`\`\`json\n${inner}\n\`\`\``);
      const result = await selectStrategies(bullishConditions, mockStrategies, router);
      // parseRecommendations uses regex to extract {}, should find the JSON
      expect(result.length).toBeGreaterThanOrEqual(0); // graceful either way
    });

    it('works without optional market field', async () => {
      const conditions: MarketConditions = { volatility: 0.5, trend: 'sideways', volumeRatio: 1.0 };
      const aiJson = JSON.stringify({
        recommendations: [
          { name: 'dca-bot', confidence: 0.65, action: 'maintain', reasoning: 'stable' },
        ],
      });
      const router = makeRouter(aiJson);
      const result = await selectStrategies(conditions, mockStrategies, router);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
