import { describe, it, expect } from 'vitest';
import { FollowerManager } from '../../src/copy-trading/follower-manager.js';
import { LeaderBoard } from '../../src/copy-trading/leader-board.js';

describe('FollowerManager', () => {
  it('should create follow relation', () => {
    const fm = new FollowerManager();
    const rel = fm.follow('follower-1', 'leader-1', 0.1);
    expect(rel.followerId).toBe('follower-1');
    expect(rel.leaderId).toBe('leader-1');
    expect(rel.allocation).toBe(0.1);
    expect(rel.active).toBe(true);
  });

  it('should throw when already following', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    expect(() => fm.follow('f1', 'l1', 0.2)).toThrow('already following');
  });

  it('should unfollow and allow re-follow', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    expect(fm.unfollow('f1', 'l1')).toBe(true);
    // Can re-follow after unfollowing
    const rel = fm.follow('f1', 'l1', 0.2);
    expect(rel.allocation).toBe(0.2);
  });

  it('should return false unfollowing nonexistent', () => {
    const fm = new FollowerManager();
    expect(fm.unfollow('f1', 'l1')).toBe(false);
  });

  it('should update allocation', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    fm.updateAllocation('f1', 'l1', 0.5);
    const rel = fm.getRelation('f1', 'l1');
    expect(rel!.allocation).toBe(0.5);
  });

  it('should throw on invalid allocation', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    expect(() => fm.updateAllocation('f1', 'l1', 0)).toThrow();
    expect(() => fm.updateAllocation('f1', 'l1', 1.5)).toThrow();
  });

  it('should get followers of a leader', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    fm.follow('f2', 'l1', 0.2);
    fm.follow('f3', 'l2', 0.3);
    const followers = fm.getFollowers('l1');
    expect(followers).toHaveLength(2);
  });

  it('should get following list for a follower', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    fm.follow('f1', 'l2', 0.2);
    const following = fm.getFollowing('f1');
    expect(following).toHaveLength(2);
  });

  it('should exclude inactive from getFollowers', () => {
    const fm = new FollowerManager();
    fm.follow('f1', 'l1', 0.1);
    fm.unfollow('f1', 'l1');
    expect(fm.getFollowers('l1')).toHaveLength(0);
  });

  it('should integrate with LeaderBoard for follower counts', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('l1', 'Leader One');
    const fm = new FollowerManager(lb);
    fm.follow('f1', 'l1', 0.1);
    expect(lb.getTraderProfile('l1')!.followers).toBe(1);
    fm.unfollow('f1', 'l1');
    expect(lb.getTraderProfile('l1')!.followers).toBe(0);
  });

  it('should use default maxCopySize', () => {
    const fm = new FollowerManager();
    const rel = fm.follow('f1', 'l1', 0.1);
    expect(rel.maxCopySize).toBe('1000');
  });
});
