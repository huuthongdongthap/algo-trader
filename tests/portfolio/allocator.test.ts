import { describe, it, expect } from 'vitest';
import { calculateAllocations } from '../../src/portfolio/allocator.js';
import type { StrategyConfig } from '../../src/core/types.js';

function makeConfig(name: string, enabled = true, cap = '1000'): StrategyConfig {
  return { name, enabled, capitalAllocation: cap, params: {} };
}

describe('calculateAllocations', () => {
  it('should return empty map for no strategies', () => {
    const result = calculateAllocations(10_000, [], 'equal');
    expect(result.size).toBe(0);
  });

  it('should return empty map for zero capital', () => {
    const result = calculateAllocations(0, [makeConfig('a')], 'equal');
    expect(result.size).toBe(0);
  });

  it('should skip disabled strategies', () => {
    const configs = [makeConfig('a', true), makeConfig('b', false)];
    const result = calculateAllocations(10_000, configs, 'equal');
    expect(result.size).toBe(1);
    expect(result.has('a')).toBe(true);
    expect(result.has('b')).toBe(false);
  });

  describe('equal mode', () => {
    it('should split capital equally', () => {
      const configs = [makeConfig('a'), makeConfig('b'), makeConfig('c')];
      const result = calculateAllocations(9000, configs, 'equal');
      expect(result.get('a')).toBeCloseTo(3000, 2);
      expect(result.get('b')).toBeCloseTo(3000, 2);
      expect(result.get('c')).toBeCloseTo(3000, 2);
    });

    it('should respect min/max constraints', () => {
      const configs = [makeConfig('a'), makeConfig('b')];
      const result = calculateAllocations(10_000, configs, 'equal', undefined, {
        maxPerStrategy: 4000,
      });
      expect(result.get('a')).toBeLessThanOrEqual(4000);
    });
  });

  describe('fixed mode', () => {
    it('should use capitalAllocation from config', () => {
      const configs = [makeConfig('a', true, '3000'), makeConfig('b', true, '2000')];
      const result = calculateAllocations(10_000, configs, 'fixed');
      expect(result.get('a')).toBe(3000);
      expect(result.get('b')).toBe(2000);
    });

    it('should not exceed total capital', () => {
      const configs = [makeConfig('a', true, '6000'), makeConfig('b', true, '6000')];
      const result = calculateAllocations(10_000, configs, 'fixed');
      let total = 0;
      for (const v of result.values()) total += v;
      expect(total).toBeLessThanOrEqual(10_000 + 0.01);
    });
  });

  describe('kelly mode', () => {
    it('should fallback to equal when no stats provided', () => {
      const configs = [makeConfig('a'), makeConfig('b')];
      const result = calculateAllocations(10_000, configs, 'kelly');
      // No stats → equal split
      expect(result.get('a')).toBeCloseTo(5000, 2);
    });

    it('should allocate based on Kelly fraction when stats provided', () => {
      const configs = [makeConfig('a'), makeConfig('b')];
      const stats = [
        { name: 'a', winRate: 0.6, avgWin: 2, avgLoss: 1 },
        { name: 'b', winRate: 0.5, avgWin: 1, avgLoss: 1 },
      ];
      const result = calculateAllocations(10_000, configs, 'kelly', stats);
      // Strategy 'a' has better stats, should get more capital
      expect(result.get('a')!).toBeGreaterThan(result.get('b')!);
    });
  });
});
