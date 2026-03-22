import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reviewTrade } from '../../src/openclaw/ai-trade-reviewer.js';
import type { CompletedTrade } from '../../src/openclaw/ai-trade-reviewer.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';

// Mock decision-logger to avoid SQLite I/O in tests
vi.mock('../../src/openclaw/decision-logger.js', () => ({
  getDecisionLogger: vi.fn().mockReturnValue({
    logDecision: vi.fn(),
  }),
}));

vi.mock('../../src/core/logger.js', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeRouter(response: string): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, model: 'test-model', tokensUsed: 20, latencyMs: 80 }),
  } as unknown as AiRouter;
}

const profitableTrade: CompletedTrade = {
  id: 'trade_001',
  market: 'BTC-USD',
  side: 'buy',
  strategy: 'grid-trading',
  entryPrice: 40000,
  exitPrice: 42000,
  size: 0.5,
  pnl: 1000,
  durationMs: 3600000, // 1 hour
  timestamp: Date.now(),
};

const losingTrade: CompletedTrade = {
  id: 'trade_002',
  market: 'ETH-USD',
  side: 'sell',
  strategy: 'dca-bot',
  entryPrice: 2000,
  exitPrice: 2200,
  size: 1,
  pnl: -200,
  durationMs: 1800000, // 30 min
  timestamp: Date.now(),
};

describe('reviewTrade', () => {
  describe('happy path', () => {
    it('returns structured review from valid AI response', async () => {
      const aiJson = JSON.stringify({
        score: 78,
        insights: ['Good entry timing', 'Trend followed correctly'],
        suggestions: ['Consider tighter stop-loss', 'Monitor volume before entry'],
        confidence: 0.88,
      });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(profitableTrade, router);

      expect(result.score).toBe(78);
      expect(result.insights).toEqual(['Good entry timing', 'Trend followed correctly']);
      expect(result.suggestions).toEqual(['Consider tighter stop-loss', 'Monitor volume before entry']);
      expect(result.confidence).toBe(0.88);
    });

    it('clamps score to [0, 100]', async () => {
      const aiJson = JSON.stringify({
        score: 150,
        insights: ['Perfect trade'],
        suggestions: [],
        confidence: 0.95,
      });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(profitableTrade, router);
      expect(result.score).toBe(100);
    });

    it('clamps negative score to 0', async () => {
      const aiJson = JSON.stringify({
        score: -20,
        insights: ['Terrible entry'],
        suggestions: ['Do not trade'],
        confidence: 0.7,
      });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(losingTrade, router);
      expect(result.score).toBe(0);
    });

    it('clamps confidence to [0, 1]', async () => {
      const aiJson = JSON.stringify({
        score: 60,
        insights: ['ok'],
        suggestions: [],
        confidence: 3.5,
      });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(profitableTrade, router);
      expect(result.confidence).toBe(1.0);
    });

    it('handles empty insights and suggestions arrays', async () => {
      const aiJson = JSON.stringify({
        score: 55,
        insights: [],
        suggestions: [],
        confidence: 0.6,
      });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(profitableTrade, router);
      expect(result.insights).toEqual([]);
      expect(result.suggestions).toEqual([]);
    });

    it('handles non-string items in insights/suggestions arrays', async () => {
      const aiJson = JSON.stringify({
        score: 65,
        insights: ['valid insight', 42, null, 'another insight'],
        suggestions: [true, 'valid suggestion'],
        confidence: 0.7,
      });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(profitableTrade, router);
      expect(result.insights).toEqual(['valid insight', 'another insight']);
      expect(result.suggestions).toEqual(['valid suggestion']);
    });

    it('handles markdown-wrapped JSON', async () => {
      const inner = JSON.stringify({
        score: 72,
        insights: ['Momentum captured well'],
        suggestions: ['Reduce size on first entry'],
        confidence: 0.8,
      });
      const router = makeRouter(`\`\`\`json\n${inner}\n\`\`\``);
      const result = await reviewTrade(profitableTrade, router);
      expect(result.score).toBe(72);
    });

    it('stores review in decision-logger', async () => {
      const { getDecisionLogger } = await import('../../src/openclaw/decision-logger.js');
      const mockLogDecision = vi.fn();
      (getDecisionLogger as ReturnType<typeof vi.fn>).mockReturnValue({ logDecision: mockLogDecision });

      const aiJson = JSON.stringify({ score: 80, insights: ['good'], suggestions: [], confidence: 0.85 });
      const router = makeRouter(aiJson);
      await reviewTrade(profitableTrade, router);

      expect(mockLogDecision).toHaveBeenCalledOnce();
      const logged = mockLogDecision.mock.calls[0][0];
      expect(logged.type).toBe('analysis');
      expect(logged.applied).toBe(true);
      expect(logged.input).toContain('trade_001');
    });
  });

  describe('fallback behavior', () => {
    it('returns fallback review when AI is unavailable', async () => {
      const router = {
        chat: vi.fn().mockRejectedValue(new Error('Connection refused')),
      } as unknown as AiRouter;

      const result = await reviewTrade(profitableTrade, router);

      expect(result.score).toBe(60); // profitable fallback
      expect(result.confidence).toBe(0.3);
      expect(result.insights).toHaveLength(1);
      expect(result.suggestions[0]).toContain('AI unavailable');
    });

    it('fallback score is 40 for losing trade', async () => {
      const router = {
        chat: vi.fn().mockRejectedValue(new Error('Timeout')),
      } as unknown as AiRouter;

      const result = await reviewTrade(losingTrade, router);
      expect(result.score).toBe(40);
    });

    it('returns fallback when AI returns non-JSON text', async () => {
      const router = makeRouter('This trade looks interesting but I cannot analyze it properly.');
      const result = await reviewTrade(profitableTrade, router);

      expect(result.confidence).toBe(0.3);
      expect(result.suggestions[0]).toContain('AI unavailable');
    });
  });

  describe('edge cases', () => {
    it('handles zero entry price without division by zero', async () => {
      const zeroEntryTrade: CompletedTrade = {
        ...profitableTrade,
        id: 'trade_zero',
        entryPrice: 0,
        exitPrice: 100,
        pnl: 100,
      };
      const aiJson = JSON.stringify({ score: 70, insights: ['ok'], suggestions: [], confidence: 0.7 });
      const router = makeRouter(aiJson);
      // Should not throw
      const result = await reviewTrade(zeroEntryTrade, router);
      expect(result).toBeDefined();
    });

    it('handles zero PnL trade', async () => {
      const breakEvenTrade: CompletedTrade = {
        ...profitableTrade,
        id: 'trade_breakeven',
        pnl: 0,
      };
      const router = {
        chat: vi.fn().mockRejectedValue(new Error('down')),
      } as unknown as AiRouter;

      const result = await reviewTrade(breakEvenTrade, router);
      // pnl >= 0 → profitable fallback → score 60
      expect(result.score).toBe(60);
    });

    it('handles very short duration trades', async () => {
      const scalpTrade: CompletedTrade = {
        ...profitableTrade,
        id: 'trade_scalp',
        durationMs: 500, // 0.5 seconds
      };
      const aiJson = JSON.stringify({ score: 85, insights: ['Fast scalp'], suggestions: [], confidence: 0.9 });
      const router = makeRouter(aiJson);
      const result = await reviewTrade(scalpTrade, router);
      expect(result.score).toBe(85);
    });
  });
});
