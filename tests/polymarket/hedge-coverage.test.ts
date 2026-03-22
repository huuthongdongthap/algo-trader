import { describe, it, expect } from 'vitest';
import {
  calculateCoverageMetrics,
  classifyTier,
  getTierDescription,
  buildPortfolio,
  filterByTier,
  filterByCoverage,
  sortPortfolios,
  type MarketPrices,
  type HedgePortfolio,
} from '../../src/polymarket/hedge-coverage.js';

function makeMarket(overrides: Partial<MarketPrices> = {}): MarketPrices {
  return { id: 'm-1', question: 'Test?', slug: 'test', yesPrice: 0.8, noPrice: 0.2, ...overrides };
}

describe('calculateCoverageMetrics', () => {
  it('should calculate coverage from PolyClaw formula', () => {
    // Example from PolyClaw docs: target=0.80, cover_prob=0.98, cost=0.95
    const m = calculateCoverageMetrics(0.80, 0.98, 0.95);
    expect(m.coverage).toBeCloseTo(0.996, 3);
    expect(m.expectedProfit).toBeCloseTo(0.046, 3);
  });

  it('should calculate loss probability', () => {
    const m = calculateCoverageMetrics(0.80, 0.98, 0.95);
    // loss = (1-0.80) * (1-0.98) = 0.20 * 0.02 = 0.004
    expect(m.lossProbability).toBeCloseTo(0.004, 3);
  });

  it('should handle perfect coverage (prob=1)', () => {
    const m = calculateCoverageMetrics(0.5, 1.0, 0.9);
    expect(m.coverage).toBe(1.0);
    expect(m.lossProbability).toBe(0);
  });

  it('should handle zero cover probability', () => {
    const m = calculateCoverageMetrics(0.7, 0.0, 0.7);
    expect(m.coverage).toBe(0.7);
    expect(m.lossProbability).toBeCloseTo(0.3, 4);
  });

  it('should return negative profit when cost > coverage', () => {
    const m = calculateCoverageMetrics(0.5, 0.5, 1.2);
    expect(m.expectedProfit).toBeLessThan(0);
  });
});

describe('classifyTier', () => {
  it('should classify >=95% as TIER 1 HIGH', () => {
    expect(classifyTier(0.96)).toEqual([1, 'HIGH']);
    expect(classifyTier(0.95)).toEqual([1, 'HIGH']);
  });

  it('should classify 90-95% as TIER 2 GOOD', () => {
    expect(classifyTier(0.92)).toEqual([2, 'GOOD']);
  });

  it('should classify 85-90% as TIER 3 MODERATE', () => {
    expect(classifyTier(0.87)).toEqual([3, 'MODERATE']);
  });

  it('should classify <85% as TIER 4 LOW', () => {
    expect(classifyTier(0.50)).toEqual([4, 'LOW']);
  });

  it('should handle edge case at 0', () => {
    expect(classifyTier(0)[0]).toBe(4);
  });
});

describe('getTierDescription', () => {
  it('should return correct descriptions', () => {
    expect(getTierDescription(1)).toBe('near-arbitrage');
    expect(getTierDescription(2)).toBe('strong hedge');
    expect(getTierDescription(3)).toBe('decent hedge');
    expect(getTierDescription(4)).toBe('speculative');
  });

  it('should fallback for unknown tier', () => {
    expect(getTierDescription(99)).toBe('speculative');
  });
});

describe('buildPortfolio', () => {
  it('should build valid portfolio', () => {
    const target = makeMarket({ yesPrice: 0.8, noPrice: 0.2 });
    const cover = makeMarket({ id: 'm-2', yesPrice: 0.15, noPrice: 0.85 });
    const p = buildPortfolio(target, cover, 'YES', 'YES', 0.98, 'test relation');
    expect(p).not.toBeNull();
    expect(p!.targetPrice).toBe(0.8);
    expect(p!.coverPrice).toBe(0.15);
    expect(p!.totalCost).toBeCloseTo(0.95, 4);
    expect(p!.tier).toBe(1); // HIGH coverage
  });

  it('should return null for cost > 2.0', () => {
    const target = makeMarket({ yesPrice: 1.5 });
    const cover = makeMarket({ yesPrice: 0.6 });
    expect(buildPortfolio(target, cover, 'YES', 'YES', 0.98, '')).toBeNull();
  });

  it('should return null for cost <= 0', () => {
    const target = makeMarket({ yesPrice: 0 });
    const cover = makeMarket({ yesPrice: 0 });
    expect(buildPortfolio(target, cover, 'YES', 'YES', 0.98, '')).toBeNull();
  });

  it('should return null for low coverage', () => {
    const target = makeMarket({ yesPrice: 0.3 });
    const cover = makeMarket({ yesPrice: 0.3 });
    // coverage = 0.3 + 0.7*0.1 = 0.37 < 0.85
    expect(buildPortfolio(target, cover, 'YES', 'YES', 0.1, '')).toBeNull();
  });

  it('should use NO price when position is NO', () => {
    const target = makeMarket({ yesPrice: 0.8, noPrice: 0.2 });
    const cover = makeMarket({ yesPrice: 0.15, noPrice: 0.85 });
    const p = buildPortfolio(target, cover, 'NO', 'NO', 0.98, 'test');
    expect(p).not.toBeNull();
    expect(p!.targetPrice).toBe(0.2);
    expect(p!.coverPrice).toBe(0.85);
  });

  it('should calculate profit percentage', () => {
    const target = makeMarket({ yesPrice: 0.8 });
    const cover = makeMarket({ id: 'c', yesPrice: 0.15 });
    const p = buildPortfolio(target, cover, 'YES', 'YES', 0.98, 'r');
    expect(p!.profitPct).toBeCloseTo(5.26, 1); // (1-0.95)/0.95*100
  });
});

describe('filterByTier', () => {
  it('should filter portfolios by max tier', () => {
    const portfolios = [
      { tier: 1 }, { tier: 2 }, { tier: 3 }, { tier: 4 },
    ] as HedgePortfolio[];
    expect(filterByTier(portfolios, 2).length).toBe(2);
    expect(filterByTier(portfolios, 1).length).toBe(1);
  });
});

describe('filterByCoverage', () => {
  it('should filter by minimum coverage', () => {
    const portfolios = [
      { coverage: 0.96 }, { coverage: 0.90 }, { coverage: 0.80 },
    ] as HedgePortfolio[];
    expect(filterByCoverage(portfolios, 0.90).length).toBe(2);
  });
});

describe('sortPortfolios', () => {
  it('should sort by tier asc then coverage desc', () => {
    const portfolios = [
      { tier: 2, coverage: 0.92 },
      { tier: 1, coverage: 0.96 },
      { tier: 1, coverage: 0.99 },
      { tier: 3, coverage: 0.87 },
    ] as HedgePortfolio[];
    const sorted = sortPortfolios(portfolios);
    expect(sorted[0].coverage).toBe(0.99);
    expect(sorted[1].coverage).toBe(0.96);
    expect(sorted[2].tier).toBe(2);
  });

  it('should not mutate original array', () => {
    const original = [{ tier: 2, coverage: 0.9 }, { tier: 1, coverage: 0.95 }] as HedgePortfolio[];
    const sorted = sortPortfolios(original);
    expect(original[0].tier).toBe(2); // unchanged
    expect(sorted[0].tier).toBe(1);
  });
});
