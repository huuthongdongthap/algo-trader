import { describe, it, expect } from 'vitest';
import {
  getCurrentTier,
  canProgressToNextTier,
  getProgressReport,
  TIERS,
  type DailyRecord,
} from '../../src/core/capital-tiers.js';

function makeDays(count: number, profitable: number): DailyRecord[] {
  const records: DailyRecord[] = [];
  for (let i = 0; i < count; i++) {
    const isProfitable = i < profitable;
    records.push({
      date: `2026-01-${String(i + 1).padStart(2, '0')}`,
      pnl: isProfitable ? 10 + Math.random() * 20 : -(5 + Math.random() * 10),
    });
  }
  return records;
}

describe('getCurrentTier', () => {
  it('returns tier 1 for capital < $200', () => {
    expect(getCurrentTier(100).level).toBe(1);
  });

  it('returns tier 1 for exactly $200', () => {
    expect(getCurrentTier(200).level).toBe(1);
  });

  it('returns tier 2 for $500', () => {
    expect(getCurrentTier(500).level).toBe(2);
  });

  it('returns tier 3 for $1000', () => {
    expect(getCurrentTier(1000).level).toBe(3);
  });

  it('returns tier 4 for $5000+', () => {
    expect(getCurrentTier(5000).level).toBe(4);
    expect(getCurrentTier(10000).level).toBe(4);
  });
});

describe('canProgressToNextTier', () => {
  it('returns false when at max tier', () => {
    expect(canProgressToNextTier(TIERS[3], makeDays(20, 15))).toBe(false);
  });

  it('returns false when not enough days', () => {
    expect(canProgressToNextTier(TIERS[0], makeDays(10, 10))).toBe(false);
  });

  it('returns false when not enough profitable days', () => {
    expect(canProgressToNextTier(TIERS[0], makeDays(14, 5))).toBe(false);
  });

  it('returns false when total P&L is negative', () => {
    // 14 days, 10 profitable but losses outweigh gains
    const records = [
      ...Array(10).fill(null).map((_, i) => ({ date: `2026-01-${i + 1}`, pnl: 1 })),
      ...Array(4).fill(null).map((_, i) => ({ date: `2026-01-${i + 11}`, pnl: -100 })),
    ];
    expect(canProgressToNextTier(TIERS[0], records)).toBe(false);
  });

  it('returns true when all criteria met', () => {
    expect(canProgressToNextTier(TIERS[0], makeDays(14, 12))).toBe(true);
  });
});

describe('getProgressReport', () => {
  it('returns correct report structure', () => {
    const report = getProgressReport(200, makeDays(14, 12));
    expect(report.tier.level).toBe(1);
    expect(report.daysCompleted).toBe(14);
    expect(report.profitableDays).toBe(12);
    expect(report.totalPnl).toBeGreaterThan(0);
    expect(report.canProgress).toBe(true);
    expect(report.nextTier?.level).toBe(2);
  });

  it('nextTier is null at max tier', () => {
    const report = getProgressReport(5000, makeDays(14, 12));
    expect(report.nextTier).toBeNull();
    expect(report.canProgress).toBe(false);
  });

  it('canProgress false when days insufficient', () => {
    const report = getProgressReport(200, makeDays(5, 5));
    expect(report.canProgress).toBe(false);
  });
});
