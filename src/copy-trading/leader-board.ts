// Leaderboard: rank traders by composite performance score
import type { TradeResult } from '../core/types.js';

export interface LeaderProfile {
  userId: string;
  displayName: string;
  /** Total return as decimal (0.15 = 15%) */
  totalReturn: number;
  /** Win rate as decimal (0.60 = 60%) */
  winRate: number;
  tradeCount: number;
  /** Max drawdown as decimal (0.20 = 20%) */
  maxDrawdown: number;
  followers: number;
  /** Composite score: 0.4*winRate + 0.3*returnPct + 0.2*(1-drawdown) + 0.1*log(tradeCount) */
  score: number;
}

/** Mutable internal stats tracked per trader */
interface TraderStats {
  userId: string;
  displayName: string;
  wins: number;
  trades: number;
  totalReturn: number;
  peakReturn: number;
  maxDrawdown: number;
  followers: number;
}

function computeScore(stats: TraderStats): number {
  const winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
  const returnPct = stats.totalReturn;
  const drawdown = stats.maxDrawdown;
  const tradeCountLog = stats.trades > 0 ? Math.log(stats.trades) : 0;
  return (
    0.4 * winRate +
    0.3 * returnPct +
    0.2 * (1 - drawdown) +
    0.1 * tradeCountLog
  );
}

function statsToProfile(stats: TraderStats): LeaderProfile {
  const winRate = stats.trades > 0 ? stats.wins / stats.trades : 0;
  return {
    userId: stats.userId,
    displayName: stats.displayName,
    totalReturn: stats.totalReturn,
    winRate,
    tradeCount: stats.trades,
    maxDrawdown: stats.maxDrawdown,
    followers: stats.followers,
    score: computeScore(stats),
  };
}

/**
 * Tracks per-trader performance and returns ranked leaderboard.
 * Thread-safe for single-process use (in-memory map).
 */
export class LeaderBoard {
  private traders = new Map<string, TraderStats>();

  /** Register a new trader (idempotent — no-op if already exists) */
  registerTrader(userId: string, displayName: string): void {
    if (this.traders.has(userId)) return;
    this.traders.set(userId, {
      userId,
      displayName,
      wins: 0,
      trades: 0,
      totalReturn: 0,
      peakReturn: 0,
      maxDrawdown: 0,
      followers: 0,
    });
  }

  /**
   * Update trader stats after each closed trade.
   * @param tradeReturn decimal return for this trade (0.05 = +5%, -0.03 = -3%)
   */
  updateStats(userId: string, _tradeResult: TradeResult, tradeReturn: number): void {
    const stats = this.traders.get(userId);
    if (!stats) return;

    stats.trades += 1;
    if (tradeReturn > 0) stats.wins += 1;

    // Cumulative return via compounding
    stats.totalReturn = (1 + stats.totalReturn) * (1 + tradeReturn) - 1;

    // Track peak for drawdown calculation
    if (stats.totalReturn > stats.peakReturn) {
      stats.peakReturn = stats.totalReturn;
    }
    const drawdown =
      stats.peakReturn > 0
        ? (stats.peakReturn - stats.totalReturn) / (1 + stats.peakReturn)
        : 0;
    if (drawdown > stats.maxDrawdown) {
      stats.maxDrawdown = drawdown;
    }
  }

  /** Increment follower count when someone follows this leader */
  incrementFollowers(userId: string): void {
    const stats = this.traders.get(userId);
    if (stats) stats.followers += 1;
  }

  /** Decrement follower count when someone unfollows */
  decrementFollowers(userId: string): void {
    const stats = this.traders.get(userId);
    if (stats && stats.followers > 0) stats.followers -= 1;
  }

  /** Return top N traders sorted by composite score descending */
  getTopTraders(limit: number): LeaderProfile[] {
    return Array.from(this.traders.values())
      .map(statsToProfile)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Get a single trader's profile; returns null if not found */
  getTraderProfile(userId: string): LeaderProfile | null {
    const stats = this.traders.get(userId);
    return stats ? statsToProfile(stats) : null;
  }
}
