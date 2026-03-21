// Copy engine: mirror leader trades to all active followers with proportional sizing
import type { TradeResult } from '../core/types.js';
import type { TradeRequest } from '../engine/trade-executor.js';
import type { FollowerManager } from './follower-manager.js';

/** Context describing a follower's current capital position */
export interface FollowerContext {
  followerId: string;
  /** Available capital in quote currency */
  availableCapital: number;
}

/** Result of a single copy-trade attempt */
export interface CopyTradeResult {
  followerId: string;
  originalTrade: TradeResult;
  /** Scaled TradeRequest ready for execution, or null if skipped */
  copiedTrade: TradeRequest | null;
  scaleFactor: number;
  /** Reason for skip, if copiedTrade is null */
  skipReason?: string;
}

/** Max allowed price drift between leader fill and copy execution (1%) */
const MAX_SLIPPAGE = 0.01;

/**
 * Processes leader trades and generates copy-trade requests for followers.
 * Does NOT execute trades directly — callers should pass copiedTrade to TradeExecutor.
 */
export class CopyEngine {
  constructor(private readonly followerManager: FollowerManager) {}

  /**
   * Called when a leader completes a trade.
   * Generates copy-trade requests for every active follower.
   *
   * @param leaderId - trader whose trade to replicate
   * @param leaderTrade - the completed TradeResult from the leader
   * @param leaderCapital - total capital the leader is trading with (quote currency)
   * @param followerContexts - map of followerId → FollowerContext
   * @param currentMarketPrice - latest market price for slippage guard (optional)
   */
  onLeaderTrade(
    leaderId: string,
    leaderTrade: TradeResult,
    leaderCapital: number,
    followerContexts: Map<string, FollowerContext>,
    currentMarketPrice?: number,
  ): CopyTradeResult[] {
    const followers = this.followerManager.getFollowers(leaderId);
    return followers.map((relation) => {
      const ctx = followerContexts.get(relation.followerId);
      if (!ctx) {
        return {
          followerId: relation.followerId,
          originalTrade: leaderTrade,
          copiedTrade: null,
          scaleFactor: 0,
          skipReason: 'follower context not found',
        };
      }
      return this.replicateTrade(ctx, leaderTrade, relation.allocation, leaderCapital, currentMarketPrice);
    });
  }

  /**
   * Scale a leader trade to follower's allocation.
   * Applies max-copy-size cap and slippage guard.
   *
   * @param followerCtx - follower capital info
   * @param leaderTrade - leader's completed trade
   * @param allocation - fraction of follower capital to use (0-1)
   * @param leaderCapital - leader's total capital for proportional sizing
   * @param currentMarketPrice - if provided, skip if drift > MAX_SLIPPAGE
   */
  replicateTrade(
    followerCtx: FollowerContext,
    leaderTrade: TradeResult,
    allocation: number,
    leaderCapital: number,
    currentMarketPrice?: number,
  ): CopyTradeResult {
    // Slippage guard: skip if market has moved too far from leader's fill
    if (currentMarketPrice !== undefined) {
      const fillPrice = parseFloat(leaderTrade.fillPrice);
      if (fillPrice > 0) {
        const drift = Math.abs(currentMarketPrice - fillPrice) / fillPrice;
        if (drift > MAX_SLIPPAGE) {
          return {
            followerId: followerCtx.followerId,
            originalTrade: leaderTrade,
            copiedTrade: null,
            scaleFactor: 0,
            skipReason: `slippage ${(drift * 100).toFixed(2)}% exceeds ${MAX_SLIPPAGE * 100}% limit`,
          };
        }
      }
    }

    // Proportional sizing: (followerCapital * allocation) / leaderCapital
    const followerCapital = followerCtx.availableCapital * allocation;
    const scaleFactor = leaderCapital > 0 ? followerCapital / leaderCapital : 0;
    const leaderFillSize = parseFloat(leaderTrade.fillSize);
    const rawCopySize = leaderFillSize * scaleFactor;

    if (rawCopySize <= 0) {
      return {
        followerId: followerCtx.followerId,
        originalTrade: leaderTrade,
        copiedTrade: null,
        scaleFactor,
        skipReason: 'computed copy size is zero',
      };
    }

    const copiedTrade: TradeRequest = {
      marketType: 'cex',          // default; caller can override before execution
      exchange: '',                // caller fills exchange details
      symbol: leaderTrade.marketId,
      side: leaderTrade.side,
      size: rawCopySize.toFixed(8),
      price: leaderTrade.fillPrice,
      strategy: leaderTrade.strategy,
    };

    return {
      followerId: followerCtx.followerId,
      originalTrade: leaderTrade,
      copiedTrade,
      scaleFactor,
    };
  }
}
