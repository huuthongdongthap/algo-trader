/**
 * Arbitrage Module Tests
 */

import { describe, it, expect, vi } from 'vitest';

describe('SpreadDetector', () => {
  it('should be constructable', async () => {
    const { SpreadDetector } = await import('../spread-detector');
    const detector = new SpreadDetector();
    expect(detector).toBeDefined();
    expect(typeof detector.scan).toBe('function');
    expect(typeof detector.start).toBe('function');
    expect(typeof detector.stop).toBe('function');
  });

  it('should use custom config', async () => {
    const { SpreadDetector } = await import('../spread-detector');
    const detector = new SpreadDetector({
      minSpreadPercent: 0.5,
      checkIntervalMs: 500,
    });
    expect(detector).toBeDefined();
  });
});

describe('SignalScorer', () => {
  it('should be constructable', async () => {
    const { SignalScorer } = await import('../signal-scorer');
    const scorer = new SignalScorer();
    expect(scorer).toBeDefined();
    expect(typeof scorer.score).toBe('function');
    expect(typeof scorer.scoreAll).toBe('function');
    expect(typeof scorer.filterActionable).toBe('function');
  });

  it('should score opportunities with strong spread', async () => {
    const { SignalScorer } = await import('../signal-scorer');
    const scorer = new SignalScorer();

    const opp = {
      id: 'test-1',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'okx',
      buyPrice: 50000,
      sellPrice: 50500,
      spread: 500,
      spreadPercent: 1.0,
      timestamp: Date.now(),
      latency: 10,
    };

    const score = scorer.score(opp);
    expect(score.totalScore).toBeGreaterThan(0);
    expect(score.recommendation).toBeDefined();
    expect(['STRONG_BUY', 'BUY', 'HOLD', 'SKIP']).toContain(score.recommendation);
  });

  it('should filter actionable signals', async () => {
    const { SignalScorer } = await import('../signal-scorer');
    const scorer = new SignalScorer();

    const opps = [
      {
        id: 'test-1',
        symbol: 'BTC/USDT',
        buyExchange: 'binance',
        sellExchange: 'okx',
        buyPrice: 50000,
        sellPrice: 50500,
        spread: 500,
        spreadPercent: 1.0,
        timestamp: Date.now(),
        latency: 10,
      },
      {
        id: 'test-2',
        symbol: 'ETH/USDT',
        buyExchange: 'okx',
        sellExchange: 'bybit',
        buyPrice: 3000,
        sellPrice: 3001,
        spread: 1,
        spreadPercent: 0.03,
        timestamp: Date.now(),
        latency: 100,
      },
    ];

    const scores = scorer.scoreAll(opps);
    const actionable = scorer.filterActionable(scores);

    expect(actionable.length).toBeLessThanOrEqual(opps.length);
    expect(actionable.every(s => s.recommendation === 'STRONG_BUY' || s.recommendation === 'BUY')).toBe(true);
  });
});

describe('RegimeDetector', () => {
  it('should be constructable with mock Redis', async () => {
    const mockRedis = {
      hgetall: vi.fn().mockResolvedValue({}),
      pipeline: vi.fn(() => ({
        hset: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      })),
    };

    const { RegimeDetector } = await import('../regime-detector');
    const detector = new RegimeDetector(mockRedis as any);
    expect(detector).toBeDefined();
    expect(typeof detector.detectRegime).toBe('function');
    expect(typeof detector.getCurrentRegime).toBe('function');
  });

  it('should return regime with empty data', async () => {
    const mockRedis = {
      hgetall: vi.fn().mockResolvedValue({}),
    };

    const { RegimeDetector } = await import('../regime-detector');
    const detector = new RegimeDetector(mockRedis as any);

    const metrics = await detector.detectRegime('BTC/USDT', ['binance']);

    expect(metrics.regime).toBeDefined();
    expect(metrics.confidence).toBeGreaterThan(0);
    expect(metrics.confidence).toBeLessThanOrEqual(1);
  });

  it('should track regime history', async () => {
    const mockRedis = {
      hgetall: vi.fn().mockResolvedValue({}),
    };

    const { RegimeDetector } = await import('../regime-detector');
    const detector = new RegimeDetector(mockRedis as any);

    expect(detector.getCurrentRegime()).toBe('NORMAL');
    expect(detector.getHistory()).toEqual([]);
  });
});
