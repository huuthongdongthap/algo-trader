import { describe, it, expect, beforeEach } from 'vitest';
import { LeaderBoard } from '../../src/copy-trading/leader-board.js';
import { FollowerManager } from '../../src/copy-trading/follower-manager.js';
import type { TradeResult } from '../../src/core/types.js';

const makeTrade = (overrides?: Partial<TradeResult>): TradeResult => ({
  orderId: 'o-1',
  marketId: 'BTC-USD',
  side: 'buy',
  fillPrice: '50000',
  fillSize: '0.1',
  fees: '0.5',
  timestamp: Date.now(),
  strategy: 'grid-trading',
  ...overrides,
});

describe('Copy Trading — LeaderBoard', () => {
  let lb: LeaderBoard;

  beforeEach(() => {
    lb = new LeaderBoard();
  });

  it('should register a trader and retrieve profile', () => {
    lb.registerTrader('u1', 'Alice');
    const profile = lb.getTraderProfile('u1');
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Alice');
    expect(profile!.tradeCount).toBe(0);
    expect(profile!.score).toBeGreaterThanOrEqual(0);
  });

  it('should return null for unknown trader', () => {
    expect(lb.getTraderProfile('nonexistent')).toBeNull();
  });

  it('should be idempotent on registerTrader', () => {
    lb.registerTrader('u1', 'Alice');
    lb.registerTrader('u1', 'Bob'); // should NOT overwrite
    expect(lb.getTraderProfile('u1')!.displayName).toBe('Alice');
  });

  it('should update stats after trades', () => {
    lb.registerTrader('u1', 'Alice');
    lb.updateStats('u1', makeTrade(), 0.05);
    lb.updateStats('u1', makeTrade(), -0.02);

    const profile = lb.getTraderProfile('u1')!;
    expect(profile.tradeCount).toBe(2);
    expect(profile.winRate).toBe(0.5); // 1 win / 2 trades
    expect(profile.totalReturn).toBeGreaterThan(0); // net positive
  });

  it('should track max drawdown', () => {
    lb.registerTrader('u1', 'Alice');
    lb.updateStats('u1', makeTrade(), 0.10); // +10%
    lb.updateStats('u1', makeTrade(), -0.08); // drawdown
    const profile = lb.getTraderProfile('u1')!;
    expect(profile.maxDrawdown).toBeGreaterThan(0);
  });

  it('should return top traders sorted by score', () => {
    lb.registerTrader('u1', 'Alice');
    lb.registerTrader('u2', 'Bob');
    lb.updateStats('u1', makeTrade(), 0.20); // high return
    lb.updateStats('u2', makeTrade(), 0.01); // low return

    const top = lb.getTopTraders(10);
    expect(top.length).toBe(2);
    expect(top[0]!.userId).toBe('u1'); // Alice should rank higher
    expect(top[0]!.score).toBeGreaterThan(top[1]!.score);
  });

  it('should limit top traders result', () => {
    lb.registerTrader('u1', 'A');
    lb.registerTrader('u2', 'B');
    lb.registerTrader('u3', 'C');
    const top = lb.getTopTraders(2);
    expect(top.length).toBe(2);
  });

  it('should increment and decrement followers', () => {
    lb.registerTrader('u1', 'Alice');
    lb.incrementFollowers('u1');
    lb.incrementFollowers('u1');
    expect(lb.getTraderProfile('u1')!.followers).toBe(2);
    lb.decrementFollowers('u1');
    expect(lb.getTraderProfile('u1')!.followers).toBe(1);
  });

  it('should not decrement below zero', () => {
    lb.registerTrader('u1', 'Alice');
    lb.decrementFollowers('u1');
    expect(lb.getTraderProfile('u1')!.followers).toBe(0);
  });
});

describe('Copy Trading — FollowerManager', () => {
  let lb: LeaderBoard;
  let fm: FollowerManager;

  beforeEach(() => {
    lb = new LeaderBoard();
    lb.registerTrader('leader1', 'Leader One');
    fm = new FollowerManager(lb);
  });

  it('should follow a leader', () => {
    const rel = fm.follow('follower1', 'leader1', 0.2, '500');
    expect(rel.active).toBe(true);
    expect(rel.allocation).toBe(0.2);
    expect(rel.maxCopySize).toBe('500');
    expect(lb.getTraderProfile('leader1')!.followers).toBe(1);
  });

  it('should throw when already following', () => {
    fm.follow('f1', 'leader1', 0.1);
    expect(() => fm.follow('f1', 'leader1', 0.1)).toThrow('already following');
  });

  it('should allow re-follow after unfollow', () => {
    fm.follow('f1', 'leader1', 0.1);
    fm.unfollow('f1', 'leader1');
    const rel = fm.follow('f1', 'leader1', 0.3);
    expect(rel.active).toBe(true);
    expect(rel.allocation).toBe(0.3);
  });

  it('should unfollow and decrement followers', () => {
    fm.follow('f1', 'leader1', 0.1);
    const ok = fm.unfollow('f1', 'leader1');
    expect(ok).toBe(true);
    expect(lb.getTraderProfile('leader1')!.followers).toBe(0);
  });

  it('should return false for unfollow non-existent relation', () => {
    expect(fm.unfollow('f1', 'leader1')).toBe(false);
  });

  it('should get following list', () => {
    lb.registerTrader('leader2', 'Leader Two');
    fm.follow('f1', 'leader1', 0.1);
    fm.follow('f1', 'leader2', 0.2);
    const following = fm.getFollowing('f1');
    expect(following.length).toBe(2);
  });

  it('should get followers of a leader', () => {
    fm.follow('f1', 'leader1', 0.1);
    fm.follow('f2', 'leader1', 0.2);
    const followers = fm.getFollowers('leader1');
    expect(followers.length).toBe(2);
  });

  it('should update allocation', () => {
    fm.follow('f1', 'leader1', 0.1);
    fm.updateAllocation('f1', 'leader1', 0.5);
    expect(fm.getRelation('f1', 'leader1')!.allocation).toBe(0.5);
  });

  it('should throw on invalid allocation update', () => {
    fm.follow('f1', 'leader1', 0.1);
    expect(() => fm.updateAllocation('f1', 'leader1', 0)).toThrow();
    expect(() => fm.updateAllocation('f1', 'leader1', 1.5)).toThrow();
  });

  it('should throw on updating non-existent relation', () => {
    expect(() => fm.updateAllocation('f1', 'leader1', 0.5)).toThrow('No active follow relation');
  });

  it('should not include inactive relations in getFollowing/getFollowers', () => {
    fm.follow('f1', 'leader1', 0.1);
    fm.unfollow('f1', 'leader1');
    expect(fm.getFollowing('f1').length).toBe(0);
    expect(fm.getFollowers('leader1').length).toBe(0);
  });
});
