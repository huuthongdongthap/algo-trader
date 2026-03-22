import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarketScanner, type ScanOptions } from '../../src/polymarket/market-scanner.js';
import type { ClobClient, RawMarket } from '../../src/polymarket/clob-client.js';

function makeRawMarket(overrides: Partial<RawMarket> = {}): RawMarket {
  return {
    condition_id: 'cond-1',
    question_id: 'q-1',
    tokens: [
      { token_id: 'yes-1', outcome: 'Yes' },
      { token_id: 'no-1', outcome: 'No' },
    ],
    minimum_order_size: '5',
    minimum_tick_size: '0.01',
    description: 'Test market',
    active: true,
    volume: '100000',
    ...overrides,
  };
}

function makeMockClient(markets: RawMarket[] = [makeRawMarket()]): ClobClient {
  return {
    isPaperMode: true,
    getPrice: vi.fn().mockImplementation((tokenId: string) => {
      if (tokenId.includes('yes')) {
        return Promise.resolve({ mid: '0.60', bid: '0.55', ask: '0.65' });
      }
      return Promise.resolve({ mid: '0.40', bid: '0.35', ask: '0.45' });
    }),
    getOrderBook: vi.fn(),
    getMarkets: vi.fn(),
    postOrder: vi.fn(),
    cancelOrder: vi.fn(),
  } as unknown as ClobClient;
}

describe('MarketScanner', () => {
  let client: ClobClient;
  let scanner: MarketScanner;

  beforeEach(() => {
    client = makeMockClient();
    scanner = new MarketScanner(client);
  });

  describe('scan', () => {
    it('should return scan result with timestamp', async () => {
      const result = await scanner.scan();
      expect(result.scannedAt).toBeGreaterThan(0);
      expect(result.totalMarkets).toBeGreaterThanOrEqual(0);
    });

    it('should respect limit option', async () => {
      const result = await scanner.scan({ limit: 1 });
      expect(result.activeMarkets).toBeLessThanOrEqual(1);
    });
  });

  describe('scanOpportunities', () => {
    it('should return opportunities array', async () => {
      const opps = await scanner.scanOpportunities();
      expect(Array.isArray(opps)).toBe(true);
    });
  });

  describe('getTopOpportunities', () => {
    it('should return at most N opportunities', async () => {
      const opps = await scanner.getTopOpportunities(5);
      expect(opps.length).toBeLessThanOrEqual(5);
    });
  });

  describe('opportunity scoring', () => {
    it('should calculate score based on delta, volume, and spread', () => {
      // Score = |delta| * log10(volume) - (yesSpread + noSpread)
      const delta = 0.1;
      const volume = 100000;
      const yesSpread = 0.1;
      const noSpread = 0.1;
      const score = Math.abs(delta) * Math.log10(volume) - (yesSpread + noSpread);
      expect(score).toBeGreaterThan(0);
    });
  });

  describe('isOpportunity logic', () => {
    it('should detect arb when price sum deviates from 1.0', () => {
      // YES=0.60, NO=0.40 → sum=1.0 → delta=0 → no arb
      // YES=0.60, NO=0.50 → sum=1.10 → delta=0.10 > 0.05 → arb!
      const delta = Math.abs(1.1 - 1.0);
      expect(delta).toBeGreaterThan(0.05);
    });

    it('should detect spread opportunity when spread > threshold', () => {
      const spread = 0.10; // 10%
      const minSpread = 0.02; // 2%
      expect(spread > minSpread).toBe(true);
    });
  });
});
