import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AiSignalGenerator } from '../../src/openclaw/ai-signal-generator.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';

function makeMockRouter(response: string): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, model: 'test-model' }),
  } as unknown as AiRouter;
}

describe('AiSignalGenerator', () => {
  describe('generateSignal', () => {
    it('should generate signal from valid AI response', async () => {
      const router = makeMockRouter('{"action":"buy","strength":"strong","confidence":0.85,"reasoning":"uptrend detected"}');
      const gen = new AiSignalGenerator(router);
      const signal = await gen.generateSignal('BTC-USD', 'momentum', { price: 60000 });
      expect(signal.action).toBe('buy');
      expect(signal.strength).toBe('strong');
      expect(signal.confidence).toBe(0.85);
      expect(signal.reasoning).toBe('uptrend detected');
      expect(signal.market).toBe('BTC-USD');
      expect(signal.strategy).toBe('momentum');
      expect(signal.model).toBe('test-model');
      expect(signal.id).toContain('sig_');
    });

    it('should fallback to hold on invalid action', async () => {
      const router = makeMockRouter('{"action":"yolo","strength":"moderate","confidence":0.5,"reasoning":"test"}');
      const gen = new AiSignalGenerator(router);
      const signal = await gen.generateSignal('ETH', 'grid', {});
      expect(signal.action).toBe('hold');
    });

    it('should fallback to moderate on invalid strength', async () => {
      const router = makeMockRouter('{"action":"sell","strength":"mega","confidence":0.5}');
      const gen = new AiSignalGenerator(router);
      const signal = await gen.generateSignal('ETH', 'grid', {});
      expect(signal.strength).toBe('moderate');
    });

    it('should clamp confidence to [0,1]', async () => {
      const router = makeMockRouter('{"action":"buy","strength":"strong","confidence":5.0}');
      const gen = new AiSignalGenerator(router);
      const signal = await gen.generateSignal('ETH', 'grid', {});
      expect(signal.confidence).toBe(1);
    });

    it('should handle non-JSON response gracefully', async () => {
      const router = makeMockRouter('I think you should buy more');
      const gen = new AiSignalGenerator(router);
      const signal = await gen.generateSignal('ETH', 'grid', {});
      expect(signal.action).toBe('hold');
      expect(signal.strength).toBe('weak');
      expect(signal.confidence).toBe(0.3);
    });

    it('should handle markdown-wrapped JSON', async () => {
      const router = makeMockRouter('```json\n{"action":"sell","strength":"weak","confidence":0.4,"reasoning":"bearish"}\n```');
      const gen = new AiSignalGenerator(router);
      const signal = await gen.generateSignal('ETH', 'grid', {});
      expect(signal.action).toBe('sell');
    });
  });

  describe('getSignals', () => {
    it('should return recent signals newest first', async () => {
      const router = makeMockRouter('{"action":"buy","strength":"strong","confidence":0.9,"reasoning":"a"}');
      const gen = new AiSignalGenerator(router);
      await gen.generateSignal('BTC', 'strat', {});
      await gen.generateSignal('ETH', 'strat', {});
      const signals = gen.getSignals();
      expect(signals).toHaveLength(2);
      expect(signals[0].market).toBe('ETH'); // newest first
    });

    it('should filter by market', async () => {
      const router = makeMockRouter('{"action":"hold","strength":"moderate","confidence":0.5}');
      const gen = new AiSignalGenerator(router);
      await gen.generateSignal('BTC', 'strat', {});
      await gen.generateSignal('ETH', 'strat', {});
      const btcOnly = gen.getSignals('BTC');
      expect(btcOnly).toHaveLength(1);
      expect(btcOnly[0].market).toBe('BTC');
    });

    it('should respect limit', async () => {
      const router = makeMockRouter('{"action":"hold","strength":"moderate","confidence":0.5}');
      const gen = new AiSignalGenerator(router);
      for (let i = 0; i < 5; i++) await gen.generateSignal(`M${i}`, 'strat', {});
      expect(gen.getSignals(undefined, 3)).toHaveLength(3);
    });
  });

  describe('getLatestSignal', () => {
    it('should return latest signal for market', async () => {
      const router = makeMockRouter('{"action":"buy","strength":"strong","confidence":0.9}');
      const gen = new AiSignalGenerator(router);
      await gen.generateSignal('BTC', 'strat', {});
      (router.chat as any).mockResolvedValue({ content: '{"action":"sell","strength":"weak","confidence":0.4}', model: 'test' });
      await gen.generateSignal('BTC', 'strat', {});
      const latest = gen.getLatestSignal('BTC');
      expect(latest?.action).toBe('sell');
    });

    it('should return undefined for unknown market', () => {
      const gen = new AiSignalGenerator(makeMockRouter('{}'));
      expect(gen.getLatestSignal('UNKNOWN')).toBeUndefined();
    });
  });

  describe('getStats', () => {
    it('should compute stats', async () => {
      const router = makeMockRouter('{"action":"buy","strength":"strong","confidence":0.8}');
      const gen = new AiSignalGenerator(router);
      await gen.generateSignal('BTC', 's1', {});
      (router.chat as any).mockResolvedValue({ content: '{"action":"sell","strength":"weak","confidence":0.6}', model: 'test' });
      await gen.generateSignal('ETH', 's2', {});

      const stats = gen.getStats();
      expect(stats.totalSignals).toBe(2);
      expect(stats.actionBreakdown.buy).toBe(1);
      expect(stats.actionBreakdown.sell).toBe(1);
      expect(stats.avgConfidence).toBeCloseTo(0.7, 1);
      expect(stats.markets).toContain('BTC');
      expect(stats.markets).toContain('ETH');
    });

    it('should return zero stats when empty', () => {
      const gen = new AiSignalGenerator(makeMockRouter('{}'));
      const stats = gen.getStats();
      expect(stats.totalSignals).toBe(0);
      expect(stats.avgConfidence).toBe(0);
    });
  });
});
