import { describe, it, expect } from 'vitest';
import {
  calcTakerFee,
  calcMakerRebate,
  netCostTaker,
  netProfitMaker,
  classifyMarketCategory,
  FEE_SCHEDULES,
  type PolymarketCategory,
} from '../../src/polymarket/polymarket-fee-calculator.js';

describe('Polymarket Fee Calculator', () => {
  describe('calcTakerFee', () => {
    it('returns 0 for exempt categories', () => {
      expect(calcTakerFee('geopolitics', 0.50)).toBe(0);
      expect(calcTakerFee('geopolitics', 0.10)).toBe(0);
      expect(calcTakerFee('world_events', 0.90)).toBe(0);
    });

    it('returns minTakerFee at probability 0.50', () => {
      expect(calcTakerFee('crypto', 0.50)).toBeCloseTo(0.0035, 4);
      expect(calcTakerFee('politics', 0.50)).toBeCloseTo(0.0020, 4);
      expect(calcTakerFee('sports', 0.50)).toBeCloseTo(0.0015, 4);
    });

    it('returns maxTakerFee at probability 0.0 and 1.0', () => {
      expect(calcTakerFee('crypto', 0.0)).toBeCloseTo(0.018, 4);
      expect(calcTakerFee('crypto', 1.0)).toBeCloseTo(0.018, 4);
      expect(calcTakerFee('politics', 0.0)).toBeCloseTo(0.010, 4);
    });

    it('scales linearly between min and max', () => {
      // At 0.25 (distance 0.25 from center, ratio 0.5)
      const fee = calcTakerFee('crypto', 0.25);
      const expected = 0.0035 + (0.018 - 0.0035) * 0.5;
      expect(fee).toBeCloseTo(expected, 4);
    });

    it('crypto has highest peak fee at 1.80%', () => {
      expect(calcTakerFee('crypto', 0.0)).toBeCloseTo(0.018, 4);
    });

    it('sports has lower peak fee at 0.75%', () => {
      expect(calcTakerFee('sports', 0.0)).toBeCloseTo(0.0075, 4);
    });
  });

  describe('calcMakerRebate', () => {
    it('applies correct rebate percentage per category', () => {
      expect(calcMakerRebate('finance', 100)).toBe(50);   // 50% rebate
      expect(calcMakerRebate('politics', 100)).toBe(25);   // 25% rebate
      expect(calcMakerRebate('crypto', 100)).toBe(20);     // 20% rebate
    });

    it('returns 0 for exempt categories', () => {
      expect(calcMakerRebate('geopolitics', 100)).toBe(0);
    });
  });

  describe('netCostTaker', () => {
    it('adds fee to amount', () => {
      const cost = netCostTaker(1000, 'crypto', 0.50);
      expect(cost).toBeCloseTo(1000 * (1 + 0.0035), 2);
    });

    it('returns exact amount for exempt categories', () => {
      expect(netCostTaker(1000, 'geopolitics', 0.50)).toBe(1000);
    });
  });

  describe('netProfitMaker', () => {
    it('adds rebate from estimated taker volume at given probability', () => {
      // At p=0.5 (default), finance fee = minTakerFee = 0.002
      // rebate = 10000 * 0.002 * 0.50 (rebatePct) = 10
      const profit = netProfitMaker(100, 'finance', 10000);
      expect(profit).toBe(110);
    });

    it('uses maxTakerFee at extreme probability', () => {
      // At p=0.0, finance fee = maxTakerFee = 0.010
      // rebate = 10000 * 0.010 * 0.50 = 50
      const profit = netProfitMaker(100, 'finance', 10000, 0.0);
      expect(profit).toBe(150);
    });
  });

  describe('classifyMarketCategory', () => {
    it('detects crypto markets', () => {
      expect(classifyMarketCategory('Will Bitcoin reach $100k by June?')).toBe('crypto');
      expect(classifyMarketCategory('ETH price above $5000')).toBe('crypto');
    });

    it('detects politics markets', () => {
      expect(classifyMarketCategory('Will Trump win the 2026 election?')).toBe('politics');
    });

    it('detects sports markets', () => {
      expect(classifyMarketCategory('NBA Finals champion 2026')).toBe('sports');
    });

    it('detects geopolitics (exempt) markets', () => {
      expect(classifyMarketCategory('Ukraine ceasefire by July')).toBe('geopolitics');
    });

    it('defaults to politics for ambiguous markets', () => {
      expect(classifyMarketCategory('Something completely random')).toBe('politics');
    });

    it('detects finance markets', () => {
      expect(classifyMarketCategory('Fed interest rate cut in June')).toBe('finance');
    });
  });

  describe('FEE_SCHEDULES', () => {
    it('has all 10 categories', () => {
      const categories: PolymarketCategory[] = [
        'crypto', 'politics', 'finance', 'tech', 'culture',
        'sports', 'science', 'pop_culture', 'geopolitics', 'world_events',
      ];
      for (const cat of categories) {
        expect(FEE_SCHEDULES[cat]).toBeDefined();
      }
    });

    it('exempt categories have zero fees', () => {
      expect(FEE_SCHEDULES.geopolitics.exempt).toBe(true);
      expect(FEE_SCHEDULES.geopolitics.minTakerFee).toBe(0);
      expect(FEE_SCHEDULES.world_events.exempt).toBe(true);
    });
  });
});
