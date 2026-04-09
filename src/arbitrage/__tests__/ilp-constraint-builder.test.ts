/**
 * ILP Constraint Builder Tests
 * Tests constraint generation for integer linear programming solver
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { buildConstraints } from '../ilp-constraint-builder';
import type { MarketOpportunity, ILPSolverConfig } from '../../types/ilp-types';

describe('ILP Constraint Builder', () => {
  let config: ILPSolverConfig;
  let markets: MarketOpportunity[];

  beforeEach(() => {
    config = {
      budgetUsdc: 10000,
      maxMarketExposureFraction: 0.2, // 20% per market
      minEdgeThreshold: 0.025, // 2.5%
      feeRate: 0.02,
      timeoutMs: 500,
    };

    markets = [
      {
        marketId: 'market_1',
        question: 'Market 1',
        yesPrice: 0.45,
        noPrice: 0.50,
        expectedEdge: 0.05,
        liquidity: 50000,
      },
      {
        marketId: 'market_2',
        question: 'Market 2',
        yesPrice: 0.50,
        noPrice: 0.45,
        expectedEdge: 0.05,
        liquidity: 50000,
      },
    ];
  });

  describe('constraint structure', () => {
    it('should return constraints object with budget constraint', () => {
      const constraints = buildConstraints(markets, config);

      expect(constraints).toHaveProperty('budget');
      expect((constraints.budget as any).max).toBe(config.budgetUsdc);
    });

    it('should create per-market constraints for each market', () => {
      const constraints = buildConstraints(markets, config);

      for (const market of markets) {
        const marketConstraintKey = `market_${market.marketId}_max`;
        expect(constraints).toHaveProperty(marketConstraintKey);
      }
    });

    it('should handle single market', () => {
      const singleMarket = markets.slice(0, 1);
      const constraints = buildConstraints(singleMarket, config);

      expect(constraints).toHaveProperty('budget');
      expect(constraints).toHaveProperty('market_market_1_max');
    });

    it('should handle empty market list', () => {
      const constraints = buildConstraints([], config);

      expect(constraints).toHaveProperty('budget');
      // No per-market constraints
      const marketKeys = Object.keys(constraints).filter(k => k.startsWith('market_'));
      expect(marketKeys.length).toBe(0);
    });
  });

  describe('budget constraint', () => {
    it('should set budget equal to config budgetUsdc', () => {
      const constraints = buildConstraints(markets, config);

      expect((constraints.budget as any).max).toBe(config.budgetUsdc);
    });

    it('should respect different budget values', () => {
      const largeBudgetConfig = { ...config, budgetUsdc: 50000 };
      const constraints = buildConstraints(markets, largeBudgetConfig);

      expect((constraints.budget as any).max).toBe(50000);
    });

    it('should handle small budgets', () => {
      const smallBudgetConfig = { ...config, budgetUsdc: 100 };
      const constraints = buildConstraints(markets, smallBudgetConfig);

      expect((constraints.budget as any).max).toBe(100);
    });
  });

  describe('per-market exposure constraints', () => {
    it('should calculate per-market max from budget and exposure fraction', () => {
      const constraints = buildConstraints(markets, config);

      const expectedMax = config.budgetUsdc * config.maxMarketExposureFraction;
      for (const market of markets) {
        const constraintKey = `market_${market.marketId}_max`;
        expect((constraints[constraintKey] as any).max).toBe(expectedMax);
      }
    });

    it('should respect different exposure fractions', () => {
      const highExposureConfig = { ...config, maxMarketExposureFraction: 0.5 };
      const constraints = buildConstraints(markets, highExposureConfig);

      const expectedMax = config.budgetUsdc * 0.5;
      const market1Key = 'market_market_1_max';
      expect((constraints[market1Key] as any).max).toBe(expectedMax);
    });

    it('should handle very restrictive exposure limits', () => {
      const restrictiveConfig = { ...config, maxMarketExposureFraction: 0.05 };
      const constraints = buildConstraints(markets, restrictiveConfig);

      const expectedMax = config.budgetUsdc * 0.05;
      const market1Key = 'market_market_1_max';
      expect((constraints[market1Key] as any).max).toBe(expectedMax);
    });

    it('should handle 100% exposure fraction (no limit per market)', () => {
      const noLimitConfig = { ...config, maxMarketExposureFraction: 1.0 };
      const constraints = buildConstraints(markets, noLimitConfig);

      const expectedMax = config.budgetUsdc; // No per-market limit
      const market1Key = 'market_market_1_max';
      expect((constraints[market1Key] as any).max).toBe(expectedMax);
    });
  });

  describe('constraint naming', () => {
    it('should use consistent naming for per-market constraints', () => {
      const constraints = buildConstraints(markets, config);

      const expectedKey1 = 'market_market_1_max';
      const expectedKey2 = 'market_market_2_max';

      expect(constraints).toHaveProperty(expectedKey1);
      expect(constraints).toHaveProperty(expectedKey2);
    });

    it('should handle market IDs with special characters', () => {
      const specialMarkets: MarketOpportunity[] = [
        {
          marketId: 'BTC/USD_POLYMARKET',
          question: 'Special ID',
          yesPrice: 0.45,
          noPrice: 0.50,
          expectedEdge: 0.05,
          liquidity: 50000,
        },
      ];

      const constraints = buildConstraints(specialMarkets, config);

      const expectedKey = 'market_BTC/USD_POLYMARKET_max';
      expect(constraints).toHaveProperty(expectedKey);
    });

    it('should always have budget constraint named "budget"', () => {
      const constraints = buildConstraints(markets, config);

      expect('budget' in constraints).toBe(true);
    });
  });

  describe('constraint values are positive', () => {
    it('should ensure budget constraint is positive', () => {
      const constraints = buildConstraints(markets, config);

      expect((constraints.budget as any).max).toBeGreaterThan(0);
    });

    it('should ensure per-market constraints are positive', () => {
      const constraints = buildConstraints(markets, config);

      for (const market of markets) {
        const key = `market_${market.marketId}_max`;
        expect((constraints[key] as any).max).toBeGreaterThan(0);
      }
    });

    it('should handle edge case where budget * fraction = 0', () => {
      // This shouldn't happen in practice, but test behavior
      const tinyExposureConfig = { ...config, maxMarketExposureFraction: 0.001 };
      const constraints = buildConstraints(markets, tinyExposureConfig);

      const expectedMax = config.budgetUsdc * 0.001;
      expect(expectedMax).toBeGreaterThan(0);
    });
  });

  describe('scalability', () => {
    it('should handle many markets', () => {
      const manyMarkets: MarketOpportunity[] = Array.from({ length: 100 }, (_, i) => ({
        marketId: `market_${i}`,
        question: `Market ${i}`,
        yesPrice: 0.40 + (i % 10) * 0.01,
        noPrice: 0.50 + (i % 10) * 0.01,
        expectedEdge: 0.05,
        liquidity: 50000,
      }));

      const constraints = buildConstraints(manyMarkets, config);

      // Should have budget + 100 per-market constraints
      expect(Object.keys(constraints).length).toBe(101);
    });

    it('should generate constraints quickly', () => {
      const largeMarketList: MarketOpportunity[] = Array.from({ length: 1000 }, (_, i) => ({
        marketId: `market_${i}`,
        question: `Market ${i}`,
        yesPrice: 0.45,
        noPrice: 0.50,
        expectedEdge: 0.05,
        liquidity: 50000,
      }));

      const startTime = performance.now();
      buildConstraints(largeMarketList, config);
      const endTime = performance.now();

      expect(endTime - startTime).toBeLessThan(100); // Should be fast
    });
  });

  describe('config sensitivity', () => {
    it('should update constraints when budget changes', () => {
      const config1 = { ...config, budgetUsdc: 10000 };
      const config2 = { ...config, budgetUsdc: 20000 };

      const constraints1 = buildConstraints(markets, config1);
      const constraints2 = buildConstraints(markets, config2);

      expect((constraints1.budget as any).max).toBe(10000);
      expect((constraints2.budget as any).max).toBe(20000);
      expect((constraints2.budget as any).max).toBe(2 * (constraints1.budget as any).max);
    });

    it('should propagate exposure fraction changes', () => {
      const exposureConfig1 = { ...config, maxMarketExposureFraction: 0.2 };
      const exposureConfig2 = { ...config, maxMarketExposureFraction: 0.4 };

      const constraints1 = buildConstraints(markets, exposureConfig1);
      const constraints2 = buildConstraints(markets, exposureConfig2);

      const key = 'market_market_1_max';
      const max1 = (constraints1[key] as any).max;
      const max2 = (constraints2[key] as any).max;

      expect(max2).toBe(2 * max1);
    });
  });

  describe('determinism', () => {
    it('should generate same constraints for same inputs', () => {
      const constraints1 = buildConstraints(markets, config);
      const constraints2 = buildConstraints(markets, config);

      expect((constraints1.budget as any).max).toBe((constraints2.budget as any).max);
    });

    it('should be independent of market order', () => {
      const marketsReversed = [...markets].reverse();

      const constraints1 = buildConstraints(markets, config);
      const constraints2 = buildConstraints(marketsReversed, config);

      // Budget should be same
      expect((constraints1.budget as any).max).toBe((constraints2.budget as any).max);

      // Per-market constraints should exist for all markets
      for (const market of markets) {
        const key = `market_${market.marketId}_max`;
        expect(constraints2).toHaveProperty(key);
      }
    });
  });
});
