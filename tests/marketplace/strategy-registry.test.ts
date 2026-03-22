import { describe, it, expect } from 'vitest';
import {
  validateListing,
  StrategyRegistry,
  type StrategyListing,
  type StrategyPerformanceStats,
} from '../../src/marketplace/strategy-registry.js';

function makeStats(overrides: Partial<StrategyPerformanceStats> = {}): StrategyPerformanceStats {
  return {
    annualizedReturn: 0.45,
    maxDrawdown: 0.15,
    winRate: 0.62,
    backtestTrades: 500,
    sharpeRatio: 1.8,
    ...overrides,
  };
}

function makeListing(overrides: Partial<StrategyListing> = {}): StrategyListing {
  return {
    id: 'strat-1',
    name: 'Alpha Bot',
    description: 'A high-frequency trading bot',
    author: 'dev@test.com',
    version: '1.0.0',
    category: 'arbitrage',
    performanceStats: makeStats(),
    priceUsdc: '29.99',
    downloads: 100,
    rating: 4.5,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('validateListing', () => {
  it('should validate a complete listing', () => {
    const result = validateListing(makeListing());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject missing required fields', () => {
    const result = validateListing({ name: 'Partial' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should reject invalid category', () => {
    const result = validateListing(makeListing({ category: 'invalid' as any }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid category'))).toBe(true);
  });

  it('should reject rating out of range', () => {
    const result = validateListing(makeListing({ rating: 6 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('rating'))).toBe(true);
  });

  it('should reject non-numeric priceUsdc', () => {
    const result = validateListing(makeListing({ priceUsdc: 'abc' }));
    expect(result.valid).toBe(false);
  });

  it('should reject winRate > 1', () => {
    const result = validateListing(makeListing({ performanceStats: makeStats({ winRate: 1.5 }) }));
    expect(result.valid).toBe(false);
  });

  it('should reject negative maxDrawdown', () => {
    const result = validateListing(makeListing({ performanceStats: makeStats({ maxDrawdown: -0.1 }) }));
    expect(result.valid).toBe(false);
  });
});

describe('StrategyRegistry', () => {
  it('should register and lookup listing', () => {
    const reg = new StrategyRegistry();
    const listing = makeListing();
    const result = reg.register(listing);
    expect(result.valid).toBe(true);
    expect(reg.lookup('strat-1')).toBeDefined();
    expect(reg.lookup('strat-1')!.name).toBe('Alpha Bot');
  });

  it('should reject invalid listing', () => {
    const reg = new StrategyRegistry();
    const result = reg.register(makeListing({ id: '' }));
    expect(result.valid).toBe(false);
    expect(reg.count()).toBe(0);
  });

  it('should search by category', () => {
    const reg = new StrategyRegistry();
    reg.register(makeListing({ id: '1', category: 'arbitrage' }));
    reg.register(makeListing({ id: '2', category: 'dca' }));
    const results = reg.search({ category: 'dca' });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('2');
  });

  it('should search by keyword', () => {
    const reg = new StrategyRegistry();
    reg.register(makeListing({ id: '1', name: 'Alpha Bot' }));
    reg.register(makeListing({ id: '2', name: 'Beta Scanner' }));
    const results = reg.search({ keyword: 'alpha' });
    expect(results).toHaveLength(1);
  });

  it('should search by keyword in description and author', () => {
    const reg = new StrategyRegistry();
    reg.register(makeListing({ id: '1', description: 'Uses machine learning', author: 'alice' }));
    expect(reg.search({ keyword: 'machine' })).toHaveLength(1);
    expect(reg.search({ keyword: 'alice' })).toHaveLength(1);
  });

  it('should remove listing', () => {
    const reg = new StrategyRegistry();
    reg.register(makeListing());
    expect(reg.remove('strat-1')).toBe(true);
    expect(reg.count()).toBe(0);
  });

  it('should return false removing nonexistent', () => {
    const reg = new StrategyRegistry();
    expect(reg.remove('nope')).toBe(false);
  });

  it('should return all listings with empty search', () => {
    const reg = new StrategyRegistry();
    reg.register(makeListing({ id: '1' }));
    reg.register(makeListing({ id: '2' }));
    expect(reg.search()).toHaveLength(2);
  });
});
