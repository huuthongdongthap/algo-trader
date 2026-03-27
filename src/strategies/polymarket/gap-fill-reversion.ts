/**
 * Gap Fill Reversion strategy for Polymarket binary markets.
 *
 * Detects price gaps (sudden jumps between consecutive price snapshots) and
 * trades the expectation that gaps tend to fill — price reverts back toward
 * the pre-gap level. Based on the statistical observation that most gaps in
 * prediction markets partially or fully fill.
 *
 * Signal logic:
 *   1. Track consecutive price snapshots
 *   2. Detect a gap when |price[t] - price[t-1]| > gapThreshold
 *   3. Record the gap: direction, size, pre-gap level
 *   4. When gap detected upward → BUY NO (expect fill back down)
 *   5. When gap detected downward → BUY YES (expect fill back up)
 *   6. Require gap size > minGapSize AND confirm gap persists for confirmTicks
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface GapFillReversionConfig {
  /** Minimum price change to qualify as a gap */
  gapThreshold: number;
  /** Ticks gap must persist before trading */
  confirmTicks: number;
  /** Gap older than this (ms) is stale, ignore */
  gapDecayMs: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (0.025 = 2.5%) */
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

export const DEFAULT_CONFIG: GapFillReversionConfig = {
  gapThreshold: 0.03,
  confirmTicks: 2,
  gapDecayMs: 300_000,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'gap-fill-reversion' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface GapRecord {
  direction: 'up' | 'down';
  size: number;
  preGapPrice: number;
  gapPrice: number;
  timestamp: number;
  confirmCount: number;
}

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
 * Detect whether the price change from prevPrice to currentPrice qualifies as a gap.
 */
export function detectGap(
  prevPrice: number,
  currentPrice: number,
  threshold: number,
): { isGap: boolean; direction: 'up' | 'down'; size: number } {
  const size = Math.abs(currentPrice - prevPrice);
  const direction: 'up' | 'down' = currentPrice > prevPrice ? 'up' : 'down';
  return { isGap: size > threshold, direction, size };
}

/**
 * Check whether a gap has been confirmed by the price staying on the gap side
 * for the required number of ticks.
 */
export function isGapConfirmed(
  gapDirection: 'up' | 'down',
  gapPrice: number,
  currentPrice: number,
  confirmCount: number,
  requiredConfirms: number,
): boolean {
  if (confirmCount < requiredConfirms) return false;
  // Price must still be on the gap side
  if (gapDirection === 'up') return currentPrice >= gapPrice;
  return currentPrice <= gapPrice;
}

/**
 * Check whether a gap has become stale (too old to trade).
 */
export function isGapStale(gapTimestamp: number, now: number, decayMs: number): boolean {
  return now - gapTimestamp > decayMs;
}

/**
 * Calculate the target price for a gap fill.
 * Target = preGapPrice + fillPct * (gapPrice - preGapPrice)
 * Default fillPct = 0.5 (half fill).
 */
export function calcFillTarget(
  preGapPrice: number,
  gapPrice: number,
  fillPct: number = 0.5,
): number {
  return preGapPrice + fillPct * (gapPrice - preGapPrice);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface GapFillReversionDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<GapFillReversionConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createGapFillReversionTick(deps: GapFillReversionDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: GapFillReversionConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const lastPrices = new Map<string, number>();
  const activeGaps = new Map<string, GapRecord>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

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

  async function scanEntries(markets: GammaMarket[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.yesTokenId)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId)) continue;

      // Check minimum volume
      if ((market.volume ?? 0) < cfg.minVolume) continue;

      try {
        // Fetch orderbook for YES token
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        const prevPrice = lastPrices.get(market.yesTokenId);
        lastPrices.set(market.yesTokenId, ba.mid);

        // Need a previous price to detect gaps
        if (prevPrice === undefined) continue;

        const now = Date.now();

        // Check for existing gap on this market
        const existingGap = activeGaps.get(market.yesTokenId);

        if (existingGap) {
          // Check if gap is stale
          if (isGapStale(existingGap.timestamp, now, cfg.gapDecayMs)) {
            activeGaps.delete(market.yesTokenId);
            continue;
          }

          // Increment confirm count if price is still on gap side
          if (existingGap.direction === 'up' && ba.mid >= existingGap.gapPrice) {
            existingGap.confirmCount++;
          } else if (existingGap.direction === 'down' && ba.mid <= existingGap.gapPrice) {
            existingGap.confirmCount++;
          } else {
            // Gap has been invalidated (price came back)
            activeGaps.delete(market.yesTokenId);
            continue;
          }

          // Check if confirmed
          if (!isGapConfirmed(existingGap.direction, existingGap.gapPrice, ba.mid, existingGap.confirmCount, cfg.confirmTicks)) {
            continue;
          }

          // Gap confirmed → trade the reversion
          // Up gap → BUY NO (expect fill down)
          // Down gap → BUY YES (expect fill up)
          const side: 'yes' | 'no' = existingGap.direction === 'down' ? 'yes' : 'no';
          const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
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
            gapDirection: existingGap.direction,
            gapSize: existingGap.size.toFixed(4),
            preGapPrice: existingGap.preGapPrice.toFixed(4),
            fillTarget: calcFillTarget(existingGap.preGapPrice, existingGap.gapPrice).toFixed(4),
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

          // Remove gap after trading
          activeGaps.delete(market.yesTokenId);
        } else {
          // No active gap — try to detect a new one
          const gap = detectGap(prevPrice, ba.mid, cfg.gapThreshold);
          if (gap.isGap) {
            activeGaps.set(market.yesTokenId, {
              direction: gap.direction,
              size: gap.size,
              preGapPrice: prevPrice,
              gapPrice: ba.mid,
              timestamp: now,
              confirmCount: 0,
            });
          }
        }
      } catch (err) {
        logger.debug('Scan error', STRATEGY_NAME, {
          market: market.conditionId,
          err: String(err),
        });
      }
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function gapFillReversionTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        activeGaps: activeGaps.size,
        trackedMarkets: lastPrices.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
