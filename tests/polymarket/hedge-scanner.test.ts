import { describe, it, expect, vi } from 'vitest';
import { HedgeScanner } from '../../src/polymarket/hedge-scanner.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';
import type { GammaMarket } from '../../src/polymarket/gamma-client.js';

function makeGammaMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: 'm-1', question: 'Will event happen?', slug: 'event-happen',
    conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
    yesPrice: 0.8, noPrice: 0.2, volume: 100000, volume24h: 5000,
    liquidity: 50000, endDate: '2026-12-31', active: true, closed: false,
    resolved: false, outcome: null,
    ...overrides,
  };
}

// Mock AI router that returns empty implications (no hedges found)
function makeMockRouter(response?: string): AiRouter {
  const defaultResp = '{"implied_by":[],"implies":[]}';
  return {
    chat: vi.fn().mockResolvedValue({
      content: response ?? defaultResp,
      model: 'test-model',
      tokensUsed: 100,
      latencyMs: 50,
    }),
  } as unknown as AiRouter;
}

describe('HedgeScanner', () => {
  describe('constructor', () => {
    it('should create scanner with defaults', () => {
      const scanner = new HedgeScanner(makeMockRouter());
      expect(scanner).toBeDefined();
    });

    it('should accept custom config', () => {
      const scanner = new HedgeScanner(makeMockRouter(), {
        maxRelatedMarkets: 10,
        maxTier: 2,
        gammaTimeout: 5000,
      });
      expect(scanner).toBeDefined();
    });
  });

  describe('scanForMarket', () => {
    it('should return scan result with target market', async () => {
      const ai = makeMockRouter();
      const scanner = new HedgeScanner(ai);

      // Mock the internal gamma client calls
      const target = makeGammaMarket({ id: 'target', question: 'Will BTC hit 100k?' });

      // We need to mock GammaClient.getTrending - since HedgeScanner creates it internally,
      // we test via scanForMarket which accepts a GammaMarket directly
      // but still calls fetchRelatedMarkets internally. Let's mock fetch.
      const mockTrending = [
        makeGammaMarket({ id: 'other-1', question: 'Will ETH hit 10k?' }),
        makeGammaMarket({ id: 'other-2', question: 'Will market crash?' }),
      ];

      // Override the private gamma client's getTrending
      const proto = Object.getPrototypeOf(scanner);
      const origFetch = proto.fetchRelatedMarkets;
      (scanner as any).fetchRelatedMarkets = vi.fn().mockResolvedValue(mockTrending);

      const result = await scanner.scanForMarket(target);

      expect(result.targetMarket.id).toBe('target');
      expect(result.scannedAt).toBeGreaterThan(0);
      expect(result.marketsScanned).toBe(2);
      expect(Array.isArray(result.portfolios)).toBe(true);
      expect(result.cached).toBe(false);
      expect(ai.chat).toHaveBeenCalledTimes(1);
    });

    it('should return empty portfolios when LLM finds no implications', async () => {
      const ai = makeMockRouter('{"implied_by":[],"implies":[]}');
      const scanner = new HedgeScanner(ai);
      (scanner as any).fetchRelatedMarkets = vi.fn().mockResolvedValue([
        makeGammaMarket({ id: 'other' }),
      ]);

      const result = await scanner.scanForMarket(makeGammaMarket());
      expect(result.portfolios).toHaveLength(0);
    });

    it('should use LLM cache on second call', async () => {
      const ai = makeMockRouter();
      const scanner = new HedgeScanner(ai);
      const mockMarkets = [makeGammaMarket({ id: 'other' })];
      (scanner as any).fetchRelatedMarkets = vi.fn().mockResolvedValue(mockMarkets);

      const target = makeGammaMarket();
      await scanner.scanForMarket(target);
      expect(ai.chat).toHaveBeenCalledTimes(1);

      const result2 = await scanner.scanForMarket(target);
      expect(result2.cached).toBe(true);
      // Should NOT call LLM again
      expect(ai.chat).toHaveBeenCalledTimes(1);
    });

    it('should clear cache', async () => {
      const ai = makeMockRouter();
      const scanner = new HedgeScanner(ai);
      (scanner as any).fetchRelatedMarkets = vi.fn().mockResolvedValue([makeGammaMarket({ id: 'o' })]);

      await scanner.scanForMarket(makeGammaMarket());
      expect(scanner.getCacheSize()).toBe(1);
      scanner.clearCache();
      expect(scanner.getCacheSize()).toBe(0);
    });

    it('should return portfolios when LLM finds implications', async () => {
      // LLM says other-1 implies target (high probability necessary relationship)
      const llmResponse = JSON.stringify({
        implied_by: [{
          market_id: 'other-1',
          market_question: 'Military operation?',
          explanation: 'capture requires operation',
          counterexample_attempt: 'impossible',
        }],
        implies: [],
      });
      const ai = makeMockRouter(llmResponse);
      const scanner = new HedgeScanner(ai);

      const target = makeGammaMarket({ id: 'target', question: 'City captured?', yesPrice: 0.8, noPrice: 0.2 });
      const other = makeGammaMarket({ id: 'other-1', question: 'Military operation?', yesPrice: 0.15, noPrice: 0.85 });
      (scanner as any).fetchRelatedMarkets = vi.fn().mockResolvedValue([other]);

      const result = await scanner.scanForMarket(target);
      // Should find a hedge portfolio: buy YES on target (0.8) + buy NO on other (0.85)
      // Coverage = 0.8 + 0.2*0.98 = 0.996 → TIER 1
      expect(result.portfolios.length).toBeGreaterThanOrEqual(1);
      if (result.portfolios.length > 0) {
        expect(result.portfolios[0].tier).toBeLessThanOrEqual(3);
      }
    });
  });

  describe('scanMultiple', () => {
    it('should handle errors gracefully', async () => {
      const scanner = new HedgeScanner(makeMockRouter());
      // Mock fetchRelatedMarkets to throw (simulating API failure)
      (scanner as any).gamma = {
        getBySlug: vi.fn().mockRejectedValue(new Error('API unavailable')),
        getTrending: vi.fn().mockRejectedValue(new Error('API unavailable')),
      };
      const results = await scanner.scanMultiple(['nonexistent-slug']);
      expect(results).toHaveLength(0); // failed but didn't throw
    });
  });
});
