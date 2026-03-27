/**
 * Momentum Cascade strategy for Polymarket binary markets.
 *
 * Detects cascading momentum across related markets within an event.
 * When one market in an event starts moving strongly, related markets
 * tend to follow with a lag. This strategy detects the "leader" market's
 * momentum and trades the "follower" markets before they catch up.
 *
 * Signal logic:
 *   1. Group markets by event (via gamma.getEvents)
 *   2. Track price momentum (EMA of returns) for each market
 *   3. Identify the "leader" — market with highest absolute momentum in the event
 *   4. Calculate cascade score for followers = leader momentum - follower momentum
 *   5. When cascade score > threshold AND follower hasn't moved yet → trade follower
 *   6. BUY YES if leader momentum is positive (followers should rise)
 *   7. BUY NO if leader momentum is negative (followers should fall)
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface MomentumCascadeConfig {
  /** Number of price snapshots for momentum calculation */
  momentumWindow: number;
  /** Alpha for momentum EMA */
  momentumEmaAlpha: number;
  /** Minimum cascade score to trigger entry */
  cascadeThreshold: number;
  /** Max follower movement to be considered "not yet moved" */
  followerLagMax: number;
  /** Minimum markets per event to consider */
  minMarketsPerEvent: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (0.03 = 3%) */
  takeProfitPct: number;
  /** Stop-loss as fraction (0.02 = 2%) */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Base trade size in USDC */
  positionSize: string;
}

export const DEFAULT_CONFIG: MomentumCascadeConfig = {
  momentumWindow: 12,
  momentumEmaAlpha: 0.15,
  cascadeThreshold: 0.03,
  followerLagMax: 0.01,
  minMarketsPerEvent: 2,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'momentum-cascade' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Calculate simple return from an array of prices.
 * return = (last - first) / first. Returns 0 if fewer than 2 prices or first is 0.
 */
export function calcReturn(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  if (first === 0) return 0;
  const last = prices[prices.length - 1];
  return (last - first) / first;
}

/**
 * Update an exponential moving average for momentum.
 * newEma = alpha * returnVal + (1 - alpha) * prevEma
 * Returns returnVal when there is no previous EMA (initial case).
 */
export function updateMomentumEma(prevEma: number | null, returnVal: number, alpha: number): number {
  if (prevEma === null) return returnVal;
  if (alpha <= 0) return prevEma;
  if (alpha >= 1) return returnVal;
  return alpha * returnVal + (1 - alpha) * prevEma;
}

/**
 * Find the leader market — the one with highest |momentum|.
 * Returns null if the map is empty.
 */
export function findLeader(momentums: Map<string, number>): { marketId: string; momentum: number } | null {
  let bestId: string | null = null;
  let bestAbs = -1;
  let bestMom = 0;

  for (const [id, mom] of momentums) {
    const abs = Math.abs(mom);
    if (abs > bestAbs) {
      bestId = id;
      bestAbs = abs;
      bestMom = mom;
    }
  }

  if (bestId === null) return null;
  return { marketId: bestId, momentum: bestMom };
}

/**
 * Calculate cascade score = leaderMomentum - followerMomentum.
 * Represents how much the follower lags behind the leader.
 */
export function calcCascadeScore(leaderMomentum: number, followerMomentum: number): number {
  return leaderMomentum - followerMomentum;
}

/**
 * Check if a follower is lagging (hasn't moved yet).
 * True when |followerMomentum| < lagMax.
 */
export function isFollowerLagging(followerMomentum: number, lagMax: number): boolean {
  return Math.abs(followerMomentum) < lagMax;
}

// ── Internal helper ──────────────────────────────────────────────────────────

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface MomentumCascadeDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<MomentumCascadeConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createMomentumCascadeTick(deps: MomentumCascadeDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: MomentumCascadeConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
  const momentumEmaState = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordPrice(tokenId: string, price: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push(price);

    // Keep only momentumWindow snapshots
    if (history.length > cfg.momentumWindow) {
      history.splice(0, history.length - cfg.momentumWindow);
    }
  }

  function getPrices(tokenId: string): number[] {
    return priceHistory.get(tokenId) ?? [];
  }

  function updateMomentumEmaState(tokenId: string, returnVal: number): number {
    const prev = momentumEmaState.get(tokenId) ?? null;
    const ema = updateMomentumEma(prev, returnVal, cfg.momentumEmaAlpha);
    momentumEmaState.set(tokenId, ema);
    return ema;
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(tokenId: string): boolean {
    return positions.some(p => p.tokenId === tokenId);
  }

  // ── Exit logic ───────────────────────────────────────────────────────────

  async function checkExits(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      let shouldExit = false;
      let reason = '';

      // Get current price
      let currentPrice: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        const ba = bestBidAsk(book);
        currentPrice = ba.mid;
      } catch {
        continue; // skip if can't fetch
      }

      // Take profit / Stop loss
      if (pos.side === 'yes') {
        const gain = (currentPrice - pos.entryPrice) / pos.entryPrice;
        if (gain >= cfg.takeProfitPct) {
          shouldExit = true;
          reason = `take-profit (${(gain * 100).toFixed(2)}%)`;
        } else if (-gain >= cfg.stopLossPct) {
          shouldExit = true;
          reason = `stop-loss (${(gain * 100).toFixed(2)}%)`;
        }
      } else {
        const gain = (pos.entryPrice - currentPrice) / pos.entryPrice;
        if (gain >= cfg.takeProfitPct) {
          shouldExit = true;
          reason = `take-profit (${(gain * 100).toFixed(2)}%)`;
        } else if (-gain >= cfg.stopLossPct) {
          shouldExit = true;
          reason = `stop-loss (${(gain * 100).toFixed(2)}%)`;
        }
      }

      // Max hold time
      if (!shouldExit && now - pos.openedAt > cfg.maxHoldMs) {
        shouldExit = true;
        reason = 'max hold time';
      }

      if (shouldExit) {
        try {
          const exitSide = pos.side === 'yes' ? 'sell' : 'buy';
          await orderManager.placeOrder({
            tokenId: pos.tokenId,
            side: exitSide,
            price: currentPrice!.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / currentPrice!)),
            orderType: 'IOC',
          });

          const pnl = pos.side === 'yes'
            ? (currentPrice! - pos.entryPrice) * (pos.sizeUsdc / pos.entryPrice)
            : (pos.entryPrice - currentPrice!) * (pos.sizeUsdc / pos.entryPrice);

          logger.info('Exit position', STRATEGY_NAME, {
            conditionId: pos.conditionId,
            side: pos.side,
            pnl: pnl.toFixed(4),
            reason,
          });

          eventBus.emit('trade.executed', {
            trade: {
              orderId: pos.orderId,
              marketId: pos.conditionId,
              side: exitSide,
              fillPrice: String(currentPrice),
              fillSize: String(pos.sizeUsdc),
              fees: '0',
              timestamp: Date.now(),
              strategy: STRATEGY_NAME,
            },
          });

          cooldowns.set(pos.tokenId, now + cfg.cooldownMs);
          toRemove.push(i);
        } catch (err) {
          logger.warn('Exit failed', STRATEGY_NAME, { tokenId: pos.tokenId, err: String(err) });
        }
      }
    }

    // Remove closed positions (reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      positions.splice(toRemove[i], 1);
    }
  }

  // ── Entry logic ──────────────────────────────────────────────────────────

  async function scanEntries(events: { id: string; markets: GammaMarket[] }[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const event of events) {
      if (positions.length >= cfg.maxPositions) break;

      // Filter valid markets in this event
      const validMarkets = event.markets.filter(m =>
        m.yesTokenId && !m.closed && !m.resolved && (m.volume ?? 0) >= cfg.minVolume,
      );

      if (validMarkets.length < cfg.minMarketsPerEvent) continue;

      // Build momentum map for this event
      const momentums = new Map<string, number>();

      for (const market of validMarkets) {
        try {
          const book = await clob.getOrderBook(market.yesTokenId);
          const ba = bestBidAsk(book);
          if (ba.mid <= 0 || ba.mid >= 1) continue;

          recordPrice(market.yesTokenId, ba.mid);
          const prices = getPrices(market.yesTokenId);

          if (prices.length < 2) continue;

          const ret = calcReturn(prices);
          const mom = updateMomentumEmaState(market.yesTokenId, ret);
          momentums.set(market.conditionId, mom);
        } catch (err) {
          logger.debug('Price fetch error', STRATEGY_NAME, {
            market: market.conditionId,
            err: String(err),
          });
        }
      }

      // Need at least 2 markets with momentum data
      if (momentums.size < cfg.minMarketsPerEvent) continue;

      // Find leader
      const leader = findLeader(momentums);
      if (!leader) continue;

      // Scan followers
      for (const market of validMarkets) {
        if (positions.length >= cfg.maxPositions) break;
        if (market.conditionId === leader.marketId) continue;
        if (hasPosition(market.yesTokenId)) continue;
        if (market.noTokenId && hasPosition(market.noTokenId)) continue;
        if (isOnCooldown(market.yesTokenId)) continue;

        const followerMom = momentums.get(market.conditionId);
        if (followerMom === undefined) continue;

        // Check if follower is lagging
        if (!isFollowerLagging(followerMom, cfg.followerLagMax)) continue;

        // Calculate cascade score
        const cascadeScore = calcCascadeScore(leader.momentum, followerMom);
        if (Math.abs(cascadeScore) < cfg.cascadeThreshold) continue;

        // Determine signal direction
        // Positive leader momentum → followers should rise → BUY YES
        // Negative leader momentum → followers should fall → BUY NO
        const side: 'yes' | 'no' = leader.momentum > 0 ? 'yes' : 'no';
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);

        try {
          const book = await clob.getOrderBook(tokenId);
          const ba = bestBidAsk(book);
          const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

          const posSize = parseFloat(cfg.positionSize);

          const order = await orderManager.placeOrder({
            tokenId,
            side: 'buy',
            price: entryPrice.toFixed(4),
            size: String(Math.round(posSize / entryPrice)),
            orderType: 'GTC',
          });

          positions.push({
            tokenId,
            conditionId: market.conditionId,
            side,
            entryPrice,
            sizeUsdc: posSize,
            orderId: order.id,
            openedAt: Date.now(),
          });

          logger.info('Entry position', STRATEGY_NAME, {
            conditionId: market.conditionId,
            side,
            entryPrice: entryPrice.toFixed(4),
            leaderMarket: leader.marketId,
            leaderMomentum: leader.momentum.toFixed(4),
            cascadeScore: cascadeScore.toFixed(4),
            size: posSize.toFixed(2),
          });

          eventBus.emit('trade.executed', {
            trade: {
              orderId: order.id,
              marketId: market.conditionId,
              side: 'buy',
              fillPrice: String(entryPrice),
              fillSize: String(posSize),
              fees: '0',
              timestamp: Date.now(),
              strategy: STRATEGY_NAME,
            },
          });
        } catch (err) {
          logger.debug('Entry error', STRATEGY_NAME, {
            market: market.conditionId,
            err: String(err),
          });
        }
      }
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function momentumCascadeTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover events with their markets
      const events = await gamma.getEvents(15);

      // 3. Scan for entries
      await scanEntries(events);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
