import { describe, it, expect } from 'vitest';
import {
  calculateFeeAwareSpread,
  calculateBreakeven,
  isArbProfitable,
  calculateOptimalSize,
} from '../../src/trading-room/fee-aware-spread.js';

describe('calculateFeeAwareSpread', () => {
  it('should calculate positive spread', () => {
    const r = calculateFeeAwareSpread(100, 105, 0.001, 0.001, 10);
    expect(r.grossSpread).toBe(5);
    expect(r.buyFees).toBeCloseTo(1); // 100 * 0.001 * 10
    expect(r.sellFees).toBeCloseTo(1.05); // 105 * 0.001 * 10
    expect(r.netSpread).toBeCloseTo(47.95); // 5*10 - 1 - 1.05
    expect(r.profitable).toBe(true);
  });

  it('should detect unprofitable spread', () => {
    const r = calculateFeeAwareSpread(100, 100.01, 0.01, 0.01, 1);
    expect(r.profitable).toBe(false);
  });

  it('should handle zero fees', () => {
    const r = calculateFeeAwareSpread(100, 110, 0, 0, 1);
    expect(r.netSpread).toBe(10);
    expect(r.buyFees).toBe(0);
    expect(r.sellFees).toBe(0);
    expect(r.profitable).toBe(true);
  });

  it('should default size to 1', () => {
    const r = calculateFeeAwareSpread(100, 110, 0, 0);
    expect(r.netSpread).toBe(10);
  });

  it('should handle negative spread', () => {
    const r = calculateFeeAwareSpread(110, 100, 0, 0, 1);
    expect(r.grossSpread).toBe(-10);
    expect(r.profitable).toBe(false);
  });
});

describe('calculateBreakeven', () => {
  it('should compute breakeven spread', () => {
    const be = calculateBreakeven(100, 0.001, 0.001);
    expect(be).toBeCloseTo(0.2); // 100 * (0.001 + 0.001)
  });

  it('should return 0 for zero fees', () => {
    expect(calculateBreakeven(50000, 0, 0)).toBe(0);
  });

  it('should scale with price', () => {
    const be1 = calculateBreakeven(100, 0.001, 0.001);
    const be2 = calculateBreakeven(1000, 0.001, 0.001);
    expect(be2).toBe(be1 * 10);
  });
});

describe('isArbProfitable', () => {
  it('should return true when profit exceeds costs', () => {
    expect(isArbProfitable(10, 2, 1, 5)).toBe(true); // 10*5 > 2+1
  });

  it('should return false when costs exceed profit', () => {
    expect(isArbProfitable(0.01, 5, 10, 1)).toBe(false); // 0.01*1 < 5+10
  });

  it('should return false at exact breakeven', () => {
    expect(isArbProfitable(1, 5, 5, 10)).toBe(false); // 1*10 = 10, costs = 10
  });
});

describe('calculateOptimalSize', () => {
  it('should return positive size for profitable spread', () => {
    const size = calculateOptimalSize(5, 100, 0.001, 0.001, 10000);
    expect(size).toBeGreaterThan(0);
  });

  it('should return 0 for unprofitable spread', () => {
    const size = calculateOptimalSize(0.01, 100, 0.1, 0.1, 10000);
    expect(size).toBe(0);
  });

  it('should return 0 for zero buy price', () => {
    expect(calculateOptimalSize(5, 0, 0.001, 0.001, 10000)).toBe(0);
  });

  it('should respect capital constraint', () => {
    const size = calculateOptimalSize(50, 100, 0, 0, 500);
    expect(size).toBeLessThanOrEqual(5); // max 500/100 = 5 units
  });
});
