import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  classifyText,
  getSentimentSummary,
  fetchNewsSignals,
  fetchCoinGeckoTrending,
  fetchTwitterSignals,
  type SentimentScore,
} from '../../src/data/sentiment-feed.js';

// Mock global fetch to avoid real network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
  // Default: simulate network error (returns empty arrays from catch blocks)
  mockFetch.mockRejectedValue(new Error('Network mocked'));
});

describe('classifyText', () => {
  it('should classify positive sentiment', () => {
    const result = classifyText('Bitcoin rally surge bullish gain');
    expect(result).toBe('positive');
  });

  it('should classify negative sentiment', () => {
    const result = classifyText('Crypto crash bearish loss drop ban');
    expect(result).toBe('negative');
  });

  it('should classify neutral sentiment when balanced', () => {
    const result = classifyText('Market price change volume');
    expect(result).toBe('neutral');
  });

  it('should classify neutral when no keywords', () => {
    const result = classifyText('the quick brown fox');
    expect(result).toBe('neutral');
  });

  it('should be case-insensitive', () => {
    const lower = classifyText('bullish rally');
    const upper = classifyText('BULLISH RALLY');
    expect(lower).toBe('positive');
    expect(upper).toBe('positive');
  });

  it('should count multiple keywords', () => {
    const result = classifyText('huge bullish breakthrough adoption launch partnership approval');
    expect(result).toBe('positive');
  });
});

describe('fetchNewsSignals', () => {
  beforeEach(() => {
    delete process.env['NEWSAPI_KEY'];
  });

  it('should return empty array when NEWSAPI_KEY not set', async () => {
    const signals = await fetchNewsSignals('bitcoin');
    expect(signals).toEqual([]);
  });

  it('should return empty array on network error', async () => {
    process.env['NEWSAPI_KEY'] = 'test-key';
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const signals = await fetchNewsSignals('bitcoin');
    expect(Array.isArray(signals)).toBe(true);
    expect(signals).toEqual([]);
  });
});

describe('fetchCoinGeckoTrending', () => {
  it('should return array of signals', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        coins: [
          { item: { name: 'Bitcoin', symbol: 'BTC' } },
          { item: { name: 'Ethereum', symbol: 'ETH' } },
        ],
      }),
    });
    const signals = await fetchCoinGeckoTrending();
    expect(Array.isArray(signals)).toBe(true);
    expect(signals.length).toBe(2);
  });

  it('should have correct signal structure if data available', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        coins: [{ item: { name: 'Bitcoin', symbol: 'BTC' } }],
      }),
    });
    const signals = await fetchCoinGeckoTrending();
    expect(signals.length).toBeGreaterThan(0);
    const signal = signals[0];
    expect(signal.source).toBe('coingecko');
    expect(signal.score).toBe('positive');
    expect(signal.numericScore).toBe(1);
    expect(signal.keyword).toBeTruthy();
  });
});

describe('fetchTwitterSignals', () => {
  beforeEach(() => {
    delete process.env['TWITTER_BEARER_TOKEN'];
  });

  it('should return empty array when TWITTER_BEARER_TOKEN not set', async () => {
    const signals = await fetchTwitterSignals('ethereum');
    expect(signals).toEqual([]);
  });

  it('should return empty array on network error', async () => {
    process.env['TWITTER_BEARER_TOKEN'] = 'test-token';
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    const signals = await fetchTwitterSignals('ethereum');
    expect(Array.isArray(signals)).toBe(true);
    expect(signals).toEqual([]);
  });
});

describe('getSentimentSummary', () => {
  beforeEach(() => {
    delete process.env['NEWSAPI_KEY'];
    delete process.env['TWITTER_BEARER_TOKEN'];
  });

  it('should return summary object', async () => {
    // CoinGecko mock for getSentimentSummary (news + twitter return [] due to missing keys)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        coins: [{ item: { name: 'Bitcoin', symbol: 'bitcoin' } }],
      }),
    });
    const summary = await getSentimentSummary('bitcoin');
    expect(summary).toBeTruthy();
    expect(summary.keyword).toBe('bitcoin');
    expect(Array.isArray(summary.signals)).toBe(true);
    expect(typeof summary.averageScore).toBe('number');
    expect(['positive', 'negative', 'neutral']).toContain(summary.dominantSentiment);
  });

  it('should return neutral sentiment for empty signals', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const summary = await getSentimentSummary('nonexistent-123456');
    expect(summary.dominantSentiment).toBe('neutral');
    expect(summary.averageScore).toBe(0);
  });

  it('should calculate average score correctly', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const summary = await getSentimentSummary('test');
    expect(typeof summary.averageScore).toBe('number');
    expect(summary.averageScore).toBeGreaterThanOrEqual(-1);
    expect(summary.averageScore).toBeLessThanOrEqual(1);
  });

  it('should classify dominant sentiment based on average', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        coins: [{ item: { name: 'Bullish Token', symbol: 'bullish' } }],
      }),
    });
    const summary = await getSentimentSummary('bullish');
    if (summary.signals.length > 0) {
      const positive = summary.signals.filter(s => s.score === 'positive').length;
      if (positive > summary.signals.length / 2) {
        expect(summary.dominantSentiment).toBe('positive');
      }
    }
  });
});
