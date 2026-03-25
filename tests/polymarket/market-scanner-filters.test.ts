import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketScanner, type ScanOptions } from '../../src/polymarket/market-scanner.js';
import type { ClobClient, RawMarket } from '../../src/polymarket/clob-client.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a RawMarket with sensible defaults, overridable per-field. */
function makeMarket(overrides: Partial<RawMarket> = {}): RawMarket {
  return {
    condition_id: overrides.condition_id ?? 'cond-1',
    question_id: 'q-1',
    tokens: [
      { token_id: 'yes-1', outcome: 'Yes' },
      { token_id: 'no-1', outcome: 'No' },
    ],
    minimum_order_size: '5',
    minimum_tick_size: '0.01',
    description: 'Will event X happen?',
    active: true,
    volume: '50000',
    ...overrides,
  };
}

/** ISO date string N days from now. */
function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

/**
 * Build a mock ClobClient whose paper mode returns the given markets.
 * getPrice returns YES=0.60/NO=0.50 so priceSum=1.10 (delta=0.10 > 0.05 → arb detected).
 * Spreads are 0.10 each so isOpportunity always passes with default minSpreadPct.
 */
function makeMockClient(): ClobClient {
  return {
    isPaperMode: true,
    getPrice: vi.fn().mockImplementation((tokenId: string) => {
      if (tokenId.includes('yes')) {
        return Promise.resolve({ mid: '0.60', bid: '0.55', ask: '0.65' });
      }
      return Promise.resolve({ mid: '0.50', bid: '0.45', ask: '0.55' });
    }),
    getOrderBook: vi.fn(),
    getMarkets: vi.fn(),
    postOrder: vi.fn(),
    cancelOrder: vi.fn(),
  } as unknown as ClobClient;
}

/**
 * Patch scanner internals so fetchRawMarkets returns our controlled data
 * instead of calling Gamma/CLOB APIs.
 */
function stubFetchRawMarkets(scanner: MarketScanner, markets: RawMarket[]): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (scanner as any).fetchRawMarkets = vi.fn().mockResolvedValue(markets);
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('MarketScanner — DNA strategy filters', () => {
  let client: ClobClient;
  let scanner: MarketScanner;

  beforeEach(() => {
    client = makeMockClient();
    scanner = new MarketScanner(client);
  });

  // ────────────────────────── Volume filters ──────────────────────────

  describe('volume filter — minVolume', () => {
    it('excludes markets below $1K minimum', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'low', volume: '999' }),
        makeMarket({ condition_id: 'ok', volume: '1000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000 });
      expect(result.activeMarkets).toBe(1);
    });

    it('includes market exactly at $1K boundary', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'boundary', volume: '1000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000 });
      expect(result.activeMarkets).toBe(1);
    });

    it('excludes market at $999.99 (just under boundary)', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'under', volume: '999.99' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000 });
      expect(result.activeMarkets).toBe(0);
    });
  });

  describe('volume filter — maxVolume', () => {
    it('excludes markets above $100K cap', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'high', volume: '100001' }),
        makeMarket({ condition_id: 'ok', volume: '50000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000, maxVolume: 100_000 });
      expect(result.activeMarkets).toBe(1);
    });

    it('includes market exactly at $100K boundary', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'boundary', volume: '100000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000, maxVolume: 100_000 });
      expect(result.activeMarkets).toBe(1);
    });

    it('excludes market at $100,000.01 (just over boundary)', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'over', volume: '100000.01' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000, maxVolume: 100_000 });
      expect(result.activeMarkets).toBe(0);
    });
  });

  describe('volume filter — combined min+max (long-tail band)', () => {
    it('only keeps markets in $1K–$100K band', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'too-low', volume: '500' }),
        makeMarket({ condition_id: 'sweet', volume: '25000' }),
        makeMarket({ condition_id: 'too-high', volume: '200000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000, maxVolume: 100_000 });
      expect(result.activeMarkets).toBe(1);
    });
  });

  // ────────────────────── Resolution window filters ──────────────────────

  describe('resolution window — minResolutionDays', () => {
    it('excludes markets resolving too soon (< 7 days)', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'soon', end_date_iso: daysFromNow(3) }),
        makeMarket({ condition_id: 'ok', end_date_iso: daysFromNow(10) }),
      ]);
      const result = await scanner.scan({ minVolume: 1, minResolutionDays: 7 });
      expect(result.activeMarkets).toBe(1);
    });

    it('includes market exactly at 7-day boundary', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'boundary', end_date_iso: daysFromNow(7) }),
      ]);
      const result = await scanner.scan({ minVolume: 1, minResolutionDays: 7 });
      expect(result.activeMarkets).toBe(1);
    });
  });

  describe('resolution window — maxResolutionDays', () => {
    it('excludes markets resolving too far out (> 30 days)', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'far', end_date_iso: daysFromNow(60) }),
        makeMarket({ condition_id: 'ok', end_date_iso: daysFromNow(20) }),
      ]);
      const result = await scanner.scan({ minVolume: 1, maxResolutionDays: 30 });
      expect(result.activeMarkets).toBe(1);
    });

    it('includes market exactly at 30-day boundary', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'boundary', end_date_iso: daysFromNow(30) }),
      ]);
      const result = await scanner.scan({ minVolume: 1, maxResolutionDays: 30 });
      expect(result.activeMarkets).toBe(1);
    });
  });

  describe('resolution window — combined 7–30 day sweet spot', () => {
    it('only keeps markets in the 7–30 day window', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'too-soon', end_date_iso: daysFromNow(2) }),
        makeMarket({ condition_id: 'sweet', end_date_iso: daysFromNow(15) }),
        makeMarket({ condition_id: 'too-far', end_date_iso: daysFromNow(60) }),
      ]);
      const result = await scanner.scan({
        minVolume: 1,
        minResolutionDays: 7,
        maxResolutionDays: 30,
      });
      expect(result.activeMarkets).toBe(1);
    });

    it('keeps markets with no end_date_iso (passes through)', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'no-date' }), // no end_date_iso field
      ]);
      const result = await scanner.scan({
        minVolume: 1,
        minResolutionDays: 7,
        maxResolutionDays: 30,
      });
      expect(result.activeMarkets).toBe(1);
    });
  });

  // ──────────────────── Price market exclusion ────────────────────

  describe('price market exclusion (excludePriceMarkets)', () => {
    const priceDescriptions = [
      'Will BTC close above $100,000 on Friday?',
      'Will ETH go below $3,500 by March?',
      'Will the price of AAPL exceed $200?',
      'Will SOL dip to $150 before April?',
      'Will TSLA finish above $250 this quarter?',
      'Will NVDA finish below $800 this month?',
      'Will DOGE close above $0.50?',
      'Will gold close below $2,000 per ounce?',
    ];

    for (const desc of priceDescriptions) {
      it(`excludes: "${desc}"`, async () => {
        stubFetchRawMarkets(scanner, [
          makeMarket({ condition_id: 'price-mkt', description: desc }),
        ]);
        const result = await scanner.scan({ minVolume: 1, excludePriceMarkets: true });
        expect(result.activeMarkets).toBe(0);
      });
    }

    const safeDescriptions = [
      'Will the US elect a new president?',
      'Will it rain in London tomorrow?',
      'Will SpaceX launch Starship by June?',
      'Will the Fed raise interest rates?',
      'Will Taylor Swift release a new album?',
    ];

    for (const desc of safeDescriptions) {
      it(`keeps: "${desc}"`, async () => {
        stubFetchRawMarkets(scanner, [
          makeMarket({ condition_id: 'safe-mkt', description: desc }),
        ]);
        const result = await scanner.scan({ minVolume: 1, excludePriceMarkets: true });
        expect(result.activeMarkets).toBe(1);
      });
    }

    it('does not exclude price markets when flag is false', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ description: 'Will BTC close above $100,000?' }),
      ]);
      const result = await scanner.scan({ minVolume: 1, excludePriceMarkets: false });
      expect(result.activeMarkets).toBe(1);
    });

    it('does not exclude price markets when flag is omitted', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ description: 'Will ETH go below $3,500?' }),
      ]);
      const result = await scanner.scan({ minVolume: 1 });
      expect(result.activeMarkets).toBe(1);
    });
  });

  // ──────────────────── Category exclusion ────────────────────

  describe('category exclusion (excludeCategories)', () => {
    it('excludes markets matching excluded categories', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'crypto', category: 'Cryptocurrency' }),
        makeMarket({ condition_id: 'politics', category: 'Politics' }),
      ]);
      const result = await scanner.scan({
        minVolume: 1,
        excludeCategories: ['Cryptocurrency'],
      });
      expect(result.activeMarkets).toBe(1);
    });

    it('is case-insensitive', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'crypto', category: 'cryptocurrency' }),
      ]);
      const result = await scanner.scan({
        minVolume: 1,
        excludeCategories: ['Cryptocurrency'],
      });
      expect(result.activeMarkets).toBe(0);
    });
  });

  // ──────────────────── Minimum outcomes ────────────────────

  describe('minimum outcomes (2 tokens required)', () => {
    it('analyzeMarket returns null for market with only Yes token', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({
          condition_id: 'one-token',
          tokens: [{ token_id: 'yes-1', outcome: 'Yes' }],
        }),
      ]);
      // Market passes filter but analyzeMarket returns null → no opportunity
      const result = await scanner.scan({ minVolume: 1 });
      expect(result.opportunities).toHaveLength(0);
    });

    it('analyzeMarket returns null for market with only No token', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({
          condition_id: 'one-token',
          tokens: [{ token_id: 'no-1', outcome: 'No' }],
        }),
      ]);
      const result = await scanner.scan({ minVolume: 1 });
      expect(result.opportunities).toHaveLength(0);
    });

    it('analyzes market with both Yes and No tokens', async () => {
      stubFetchRawMarkets(scanner, [makeMarket()]);
      const result = await scanner.scan({ minVolume: 1 });
      // With our mock prices (sum=1.10, delta=0.10 > 0.05) this is an opportunity
      expect(result.opportunities.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ──────────────────── Combined filter logic ────────────────────

  describe('combined DNA strategy filters', () => {
    const dnaOptions: ScanOptions = {
      minVolume: 1_000,
      maxVolume: 100_000,
      minResolutionDays: 7,
      maxResolutionDays: 30,
      excludePriceMarkets: true,
    };

    it('applies all filters together — only sweet-spot markets survive', async () => {
      stubFetchRawMarkets(scanner, [
        // Fails: volume too low
        makeMarket({ condition_id: 'low-vol', volume: '500', end_date_iso: daysFromNow(15) }),
        // Fails: volume too high
        makeMarket({ condition_id: 'high-vol', volume: '500000', end_date_iso: daysFromNow(15) }),
        // Fails: resolves too soon
        makeMarket({ condition_id: 'soon', volume: '5000', end_date_iso: daysFromNow(2) }),
        // Fails: resolves too far out
        makeMarket({ condition_id: 'far', volume: '5000', end_date_iso: daysFromNow(90) }),
        // Fails: price market
        makeMarket({
          condition_id: 'price',
          volume: '5000',
          end_date_iso: daysFromNow(15),
          description: 'Will BTC close above $100,000?',
        }),
        // Passes all filters
        makeMarket({
          condition_id: 'perfect',
          volume: '25000',
          end_date_iso: daysFromNow(15),
          description: 'Will SpaceX launch Starship by April?',
        }),
      ]);

      const result = await scanner.scan(dnaOptions);
      expect(result.activeMarkets).toBe(1);
      expect(result.totalMarkets).toBe(6);
    });

    it('reports correct totalMarkets vs activeMarkets counts', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'a', volume: '50000', end_date_iso: daysFromNow(15) }),
        makeMarket({ condition_id: 'b', volume: '200', end_date_iso: daysFromNow(15) }),
        makeMarket({ condition_id: 'c', active: false, volume: '50000', end_date_iso: daysFromNow(15) }),
      ]);
      const result = await scanner.scan(dnaOptions);
      expect(result.totalMarkets).toBe(3);
      // 'b' fails minVolume, 'c' fails active check → only 'a' survives
      expect(result.activeMarkets).toBe(1);
    });
  });

  // ──────────────────── Empty results handling ────────────────────

  describe('empty results handling', () => {
    it('returns empty opportunities when no markets exist', async () => {
      stubFetchRawMarkets(scanner, []);
      const result = await scanner.scan();
      expect(result.totalMarkets).toBe(0);
      expect(result.activeMarkets).toBe(0);
      expect(result.opportunities).toEqual([]);
    });

    it('returns empty opportunities when all markets filtered out by volume', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ volume: '100' }),
        makeMarket({ condition_id: 'c2', volume: '200' }),
      ]);
      const result = await scanner.scan({ minVolume: 1_000 });
      expect(result.activeMarkets).toBe(0);
      expect(result.opportunities).toEqual([]);
    });

    it('returns empty opportunities when all markets filtered out by resolution', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ volume: '5000', end_date_iso: daysFromNow(1) }),
      ]);
      const result = await scanner.scan({ minVolume: 1, minResolutionDays: 7 });
      expect(result.activeMarkets).toBe(0);
      expect(result.opportunities).toEqual([]);
    });

    it('returns empty opportunities when all markets are price markets', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ description: 'Will BTC close above $50,000?' }),
        makeMarket({ condition_id: 'c2', description: 'Will ETH dip to $2,000?' }),
      ]);
      const result = await scanner.scan({ minVolume: 1, excludePriceMarkets: true });
      expect(result.activeMarkets).toBe(0);
      expect(result.opportunities).toEqual([]);
    });

    it('scanOpportunities returns empty array when nothing passes', async () => {
      stubFetchRawMarkets(scanner, []);
      const opps = await scanner.scanOpportunities();
      expect(opps).toEqual([]);
    });

    it('getTopOpportunities returns empty array when nothing passes', async () => {
      stubFetchRawMarkets(scanner, []);
      const opps = await scanner.getTopOpportunities(5);
      expect(opps).toEqual([]);
    });
  });

  // ──────────────────── Inactive market handling ────────────────────

  describe('inactive market handling', () => {
    it('excludes inactive markets regardless of volume', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'inactive', active: false, volume: '50000' }),
        makeMarket({ condition_id: 'active', active: true, volume: '50000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1 });
      expect(result.activeMarkets).toBe(1);
    });
  });

  // ──────────────────── Limit option ────────────────────

  describe('limit option', () => {
    it('caps the number of markets analyzed', async () => {
      stubFetchRawMarkets(scanner, [
        makeMarket({ condition_id: 'a', volume: '5000' }),
        makeMarket({ condition_id: 'b', volume: '5000' }),
        makeMarket({ condition_id: 'c', volume: '5000' }),
      ]);
      const result = await scanner.scan({ minVolume: 1, limit: 2 });
      expect(result.activeMarkets).toBe(2);
    });
  });
});
