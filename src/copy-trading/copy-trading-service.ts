// Copy trading service: wires EventBus → CopyEngine → LeaderBoard
// Listens for 'trade.executed' events from leaders and replicates to followers
import type { EventBus } from '../events/event-bus.js';
import type { TradeResult } from '../core/types.js';
import { CopyEngine, type FollowerContext } from './copy-engine.js';
import { LeaderBoard } from './leader-board.js';
import { FollowerManager } from './follower-manager.js';
import { CopyTradeFeeCollector } from './copy-trade-fee-collector.js';

/** Provide capital context for followers at copy time */
export type FollowerCapitalResolver = (followerId: string) => number | undefined;

/** Callback invoked for each generated copy-trade request (caller executes it) */
export type CopyTradeDispatcher = (params: {
  followerId: string;
  leaderId: string;
  trade: import('./copy-engine.js').CopyTradeResult;
}) => void;

/**
 * CopyTradingService ties together:
 *  - LeaderBoard  (tracks + ranks trader performance)
 *  - FollowerManager (follow/unfollow relationships)
 *  - CopyEngine   (scales leader trade to each follower)
 *  - EventBus     (receives 'trade.executed', emits 'copy.trade.replicated')
 *
 * Usage:
 *   const svc = new CopyTradingService(eventBus, { resolveCapital, onCopyTrade });
 *   svc.registerLeader(userId, displayName);
 *   svc.followerManager.follow(followerId, leaderId, 0.1);
 */
export class CopyTradingService {
  readonly leaderBoard: LeaderBoard;
  readonly followerManager: FollowerManager;
  readonly copyEngine: CopyEngine;
  readonly feeCollector: CopyTradeFeeCollector;

  private readonly resolveCapital: FollowerCapitalResolver;
  private readonly dispatch: CopyTradeDispatcher | undefined;

  constructor(
    private readonly eventBus: EventBus,
    opts: {
      /** Called to get a follower's available capital; return undefined to skip */
      resolveCapital: FollowerCapitalResolver;
      /** Called for each scaled copy-trade; execute the trade in your handler */
      onCopyTrade?: CopyTradeDispatcher;
    },
  ) {
    this.leaderBoard = new LeaderBoard();
    this.followerManager = new FollowerManager(this.leaderBoard);
    this.copyEngine = new CopyEngine(this.followerManager);
    this.feeCollector = new CopyTradeFeeCollector();
    this.resolveCapital = opts.resolveCapital;
    this.dispatch = opts.onCopyTrade;

    this._bindEvents();
  }

  /**
   * Register a trader as a copy-trading leader.
   * Must be called before that user's trades can be replicated.
   */
  registerLeader(userId: string, displayName: string): void {
    this.leaderBoard.registerTrader(userId, displayName);
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _bindEvents(): void {
    // Receive every executed trade from the platform
    this.eventBus.on('trade.executed', ({ trade }) => {
      this._onTradeExecuted(trade);
    });
  }

  /**
   * Called when any trade completes.
   * If the trader is a registered leader, update their stats and replicate
   * the trade to all active followers.
   */
  private _onTradeExecuted(trade: TradeResult): void {
    const leaderId = trade.strategy; // strategy field carries userId in copy context
    const profile = this.leaderBoard.getTraderProfile(leaderId);

    // Only process trades from registered leaders
    if (!profile) return;

    // Compute trade return from fill (simplified: use pnl field if present)
    const tradeReturn = this._computeReturn(trade);
    this.leaderBoard.updateStats(leaderId, trade, tradeReturn);

    // Build follower capital contexts
    const followers = this.followerManager.getFollowers(leaderId);
    if (followers.length === 0) return;

    const leaderCapital = this._estimateLeaderCapital(trade);
    const followerContexts = new Map<string, FollowerContext>();

    for (const rel of followers) {
      const capital = this.resolveCapital(rel.followerId);
      if (capital !== undefined) {
        followerContexts.set(rel.followerId, {
          followerId: rel.followerId,
          availableCapital: capital,
        });
      }
    }

    // Generate copy-trade requests
    const results = this.copyEngine.onLeaderTrade(
      leaderId,
      trade,
      leaderCapital,
      followerContexts,
    );

    // Dispatch actionable copy trades
    for (const result of results) {
      if (!result.copiedTrade) continue;

      this.eventBus.emit('copy.trade.replicated', {
        leaderId,
        followerId: result.followerId,
        originalTradeId: trade.orderId,
        scaleFactor: result.scaleFactor,
      });

      this.dispatch?.({
        followerId: result.followerId,
        leaderId,
        trade: result,
      });

      // Collect performance fees on profitable copy trades
      const grossProfit = this._computeCopyProfit(result);
      if (grossProfit > 0) {
        const feeRecord = this.feeCollector.collectFee(
          `copy-${trade.orderId}-${result.followerId}`,
          result.followerId,
          leaderId,
          grossProfit,
        );
        if (feeRecord) {
          this.eventBus.emit('copy.trade.fee.collected', {
            leaderId,
            followerId: result.followerId,
            fee: feeRecord.totalFee,
            leaderPayout: feeRecord.leaderPayout,
          });
        }
      }
    }
  }

  /**
   * Estimate trade return from pnl field.
   * Falls back to 0 if not available — caller should inject real pnl.
   */
  private _computeReturn(trade: TradeResult): number {
    if ('pnl' in trade && typeof (trade as Record<string, unknown>)['pnl'] === 'string') {
      const pnl = parseFloat((trade as Record<string, unknown>)['pnl'] as string);
      const cost = parseFloat(trade.fillPrice) * parseFloat(trade.fillSize);
      return cost > 0 ? pnl / cost : 0;
    }
    return 0;
  }

  /** Estimate leader's total capital from fill size × fill price as a fallback */
  private _estimateLeaderCapital(trade: TradeResult): number {
    return parseFloat(trade.fillPrice) * parseFloat(trade.fillSize);
  }

  /** Compute gross profit for a copy trade result (simplified: use pnl if available) */
  private _computeCopyProfit(result: import('./copy-engine.js').CopyTradeResult): number {
    const trade = result.originalTrade;
    if ('pnl' in trade && typeof (trade as Record<string, unknown>)['pnl'] === 'string') {
      const pnl = parseFloat((trade as Record<string, unknown>)['pnl'] as string);
      return pnl * result.scaleFactor;
    }
    return 0;
  }
}
