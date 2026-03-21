// Follower manager: handle follow/unfollow relationships between traders
import type { LeaderBoard } from './leader-board.js';

export interface FollowRelation {
  followerId: string;
  leaderId: string;
  /** Fraction of follower's capital to allocate (0.10 = 10%) */
  allocation: number;
  /** Max single copy trade size in quote currency (decimal string) */
  maxCopySize: string;
  createdAt: number;
  active: boolean;
}

/**
 * Manages follow relationships in-memory.
 * Key format: `${followerId}:${leaderId}`
 */
export class FollowerManager {
  private relations = new Map<string, FollowRelation>();

  constructor(private readonly leaderBoard?: LeaderBoard) {}

  private key(followerId: string, leaderId: string): string {
    return `${followerId}:${leaderId}`;
  }

  /**
   * Start copying a leader.
   * Overwrites existing inactive relation; throws if already actively following.
   */
  follow(
    followerId: string,
    leaderId: string,
    allocation: number,
    maxCopySize = '1000',
  ): FollowRelation {
    const k = this.key(followerId, leaderId);
    const existing = this.relations.get(k);
    if (existing?.active) {
      throw new Error(`${followerId} is already following ${leaderId}`);
    }

    const relation: FollowRelation = {
      followerId,
      leaderId,
      allocation,
      maxCopySize,
      createdAt: Date.now(),
      active: true,
    };
    this.relations.set(k, relation);
    this.leaderBoard?.incrementFollowers(leaderId);
    return relation;
  }

  /** Stop copying a leader. Returns false if relation not found or already inactive. */
  unfollow(followerId: string, leaderId: string): boolean {
    const k = this.key(followerId, leaderId);
    const relation = this.relations.get(k);
    if (!relation || !relation.active) return false;

    relation.active = false;
    this.leaderBoard?.decrementFollowers(leaderId);
    return true;
  }

  /** Update allocation percentage for an active follow relation. */
  updateAllocation(followerId: string, leaderId: string, newAllocation: number): void {
    const k = this.key(followerId, leaderId);
    const relation = this.relations.get(k);
    if (!relation || !relation.active) {
      throw new Error(`No active follow relation: ${followerId} → ${leaderId}`);
    }
    if (newAllocation <= 0 || newAllocation > 1) {
      throw new Error('Allocation must be between 0 (exclusive) and 1 (inclusive)');
    }
    relation.allocation = newAllocation;
  }

  /** Return all active followers of a given leader. */
  getFollowers(leaderId: string): FollowRelation[] {
    return Array.from(this.relations.values()).filter(
      (r) => r.leaderId === leaderId && r.active,
    );
  }

  /** Return all leaders that a follower is actively copying. */
  getFollowing(followerId: string): FollowRelation[] {
    return Array.from(this.relations.values()).filter(
      (r) => r.followerId === followerId && r.active,
    );
  }

  /** Get a specific relation (active or inactive), or null if not found. */
  getRelation(followerId: string, leaderId: string): FollowRelation | null {
    return this.relations.get(this.key(followerId, leaderId)) ?? null;
  }
}
