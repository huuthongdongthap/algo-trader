import { describe, it, expect } from 'vitest';
import {
  checkEarnedBadges,
  detectNewBadges,
  getAllBadges,
  findBadge,
  formatBadge,
  type UserStats,
} from '../../src/growth/badge-achievement-system.js';

const baseStats: UserStats = {
  tradeCount: 0,
  winCount: 0,
  totalPnl: 0,
  brierScore: null,
  referralCount: 0,
  daysActive: 0,
  capitalTier: 1,
  followers: 0,
};

describe('checkEarnedBadges', () => {
  it('should return no badges for zero stats', () => {
    expect(checkEarnedBadges(baseStats)).toHaveLength(0);
  });

  it('should award first-trade badge', () => {
    const badges = checkEarnedBadges({ ...baseStats, tradeCount: 1 });
    expect(badges.map(b => b.id)).toContain('first-trade');
  });

  it('should award cumulative trade badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, tradeCount: 150 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('first-trade');
    expect(ids).toContain('ten-trades');
    expect(ids).toContain('hundred-trades');
    expect(ids).not.toContain('thousand-trades');
  });

  it('should award profit badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, tradeCount: 1, totalPnl: 1500 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('hundred-usd-profit');
    expect(ids).toContain('thousand-usd-profit');
  });

  it('should award Brier score badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, brierScore: 0.08 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('brier-good');
    expect(ids).toContain('brier-excellent');
  });

  it('should not award Brier badges when score is null', () => {
    const badges = checkEarnedBadges({ ...baseStats, brierScore: null });
    const ids = badges.map(b => b.id);
    expect(ids).not.toContain('brier-good');
  });

  it('should award win rate badge only with min trades', () => {
    // 80% win rate but only 5 trades — not enough
    expect(checkEarnedBadges({ ...baseStats, tradeCount: 5, winCount: 4 }).map(b => b.id))
      .not.toContain('win-rate-70');

    // 75% win rate with 20 trades — qualifies
    expect(checkEarnedBadges({ ...baseStats, tradeCount: 20, winCount: 15 }).map(b => b.id))
      .toContain('win-rate-70');
  });

  it('should award referral badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, referralCount: 6 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('first-referral');
    expect(ids).toContain('five-referrals');
  });

  it('should award follower badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, followers: 12 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('first-follower');
    expect(ids).toContain('ten-followers');
  });

  it('should award capital tier badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, capitalTier: 3 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('tier-2');
    expect(ids).toContain('tier-3');
    expect(ids).not.toContain('tier-4');
  });

  it('should award days active badges', () => {
    const badges = checkEarnedBadges({ ...baseStats, daysActive: 95 });
    const ids = badges.map(b => b.id);
    expect(ids).toContain('thirty-days');
    expect(ids).toContain('ninety-days');
  });
});

describe('detectNewBadges', () => {
  it('should return only newly earned badges', () => {
    const previous = new Set(['first-trade', 'ten-trades']);
    const stats = { ...baseStats, tradeCount: 150, totalPnl: 200 };

    const newBadges = detectNewBadges(stats, previous);
    const ids = newBadges.map(b => b.id);
    expect(ids).toContain('hundred-trades');
    expect(ids).toContain('hundred-usd-profit');
    expect(ids).not.toContain('first-trade');
    expect(ids).not.toContain('ten-trades');
  });

  it('should return empty when no new badges', () => {
    const previous = new Set(['first-trade']);
    const stats = { ...baseStats, tradeCount: 1 };
    expect(detectNewBadges(stats, previous)).toHaveLength(0);
  });
});

describe('getAllBadges', () => {
  it('should return all 20 defined badges', () => {
    expect(getAllBadges().length).toBe(20);
  });
});

describe('findBadge', () => {
  it('should find badge by ID', () => {
    const badge = findBadge('first-trade');
    expect(badge.name).toBe('First Blood');
  });

  it('should throw for unknown badge', () => {
    expect(() => findBadge('nonexistent')).toThrow('Unknown badge');
  });
});

describe('formatBadge', () => {
  it('should format badge with emoji and tier', () => {
    const text = formatBadge(findBadge('brier-excellent'));
    expect(text).toContain('Oracle');
    expect(text).toContain('diamond');
  });
});
