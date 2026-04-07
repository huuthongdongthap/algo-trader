import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AlphaEarClient } from '../../src/intelligence/alphaear-client.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('AlphaEarClient', () => {
  let client: AlphaEarClient;

  beforeEach(() => {
    fetchMock.mockReset();
    client = new AlphaEarClient('http://localhost:8100');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchHotNews', () => {
    it('returns news items from sidecar', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{ id: '1', source: 'wsj', rank: 1, title: 'Fed Cuts Rates', url: 'http://wsj.com/1' }],
        count: 1, source: 'wallstreetcn',
      }), { status: 200 }));

      const items = await client.fetchHotNews('wallstreetcn', 5);
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('Fed Cuts Rates');
    });

    it('returns empty array when sidecar unavailable', async () => {
      fetchMock.mockRejectedValueOnce(new Error('connection refused'));
      const items = await client.fetchHotNews();
      expect(items).toEqual([]);
    });
  });

  describe('discoverPolymarkets', () => {
    it('returns Polymarket markets', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        markets: [{ id: 'm1', question: 'Will BTC hit 100k?', slug: 'btc-100k' }],
        count: 1,
      }), { status: 200 }));

      const markets = await client.discoverPolymarkets(10);
      expect(markets).toHaveLength(1);
      expect(markets[0]!.question).toContain('BTC');
    });
  });

  describe('analyzeSentiment', () => {
    it('returns FinBERT sentiment result', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        score: 0.85, label: 'positive', reason: 'bullish tone',
      }), { status: 200 }));

      const result = await client.analyzeSentiment('Bitcoin rally continues');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('positive');
      expect(result!.score).toBe(0.85);
    });

    it('returns null on 503', async () => {
      fetchMock.mockResolvedValueOnce(new Response('service unavailable', { status: 503 }));
      const result = await client.analyzeSentiment('test');
      expect(result).toBeNull();
    });
  });

  describe('batchSentiment', () => {
    it('returns batch results', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        results: [
          { score: 0.9, label: 'positive' },
          { score: -0.7, label: 'negative' },
        ],
        count: 2,
      }), { status: 200 }));

      const results = await client.batchSentiment(['good news', 'bad news']);
      expect(results).toHaveLength(2);
      expect(results[0]!.label).toBe('positive');
      expect(results[1]!.label).toBe('negative');
    });
  });

  describe('forecast', () => {
    it('returns Kronos forecast points', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        forecast: [
          { close: 0.62, high: 0.65, low: 0.59 },
          { close: 0.63, high: 0.66, low: 0.60 },
        ],
        model: 'kronos', device: 'mps',
      }), { status: 200 }));

      const prices = Array.from({ length: 60 }, (_, i) => 0.5 + i * 0.002);
      const forecast = await client.forecast(prices, 60, 2);
      expect(forecast).toHaveLength(2);
      expect(forecast[0]!.close).toBe(0.62);
    });

    it('returns empty array when sidecar down', async () => {
      fetchMock.mockRejectedValueOnce(new Error('timeout'));
      const forecast = await client.forecast([0.5, 0.51, 0.52]);
      expect(forecast).toEqual([]);
    });
  });

  describe('trackSignal', () => {
    it('parses signal evolution JSON from LLM response', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        analysis: 'The signal has been confirmed. {"status": "STRENGTHENED", "confidence": 0.8, "reasoning": "Price moved in expected direction"}',
        model: 'nemotron-nano',
      }), { status: 200 }));

      const result = await client.trackSignal('sig-1', 'BTC will rise', 'ETF approved', 0.65, 0.55);
      expect(result).not.toBeNull();
      expect(result!.status).toBe('STRENGTHENED');
      expect(result!.confidence).toBe(0.8);
    });

    it('returns null on unparseable response', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        analysis: 'I cannot determine the signal status.',
        model: 'nemotron-nano',
      }), { status: 200 }));

      const result = await client.trackSignal('sig-2', 'test', 'test', 0.5, 0.5);
      expect(result).toBeNull();
    });
  });

  describe('checkHealth', () => {
    it('returns health status and marks healthy', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        status: 'healthy', kronos_loaded: true, finbert_loaded: true,
        news_sources: 14, polymarket_api: true,
      }), { status: 200 }));

      const health = await client.checkHealth();
      expect(health).not.toBeNull();
      expect(health!.kronos_loaded).toBe(true);
      expect(client.isHealthy).toBe(true);
    });

    it('marks unhealthy on failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('refused'));
      const health = await client.checkHealth();
      expect(health).toBeNull();
      expect(client.isHealthy).toBe(false);
    });
  });
});
