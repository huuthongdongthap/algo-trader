/**
 * Order Arrival Rate strategy for Polymarket binary markets.
 *
 * Monitors the rate of orderbook changes (new levels appearing/disappearing)
 * as a proxy for order arrival rate. Sudden spikes in arrival rate signal
 * incoming directional pressure. Trades in the direction indicated by the
 * asymmetry of new orders (more bids arriving = bullish).
 *
 * Signal logic:
 *   1. Track orderbook snapshots over time
 *   2. Count new bid levels and new ask levels between snapshots
 *   3. Calculate arrival rate asymmetry = (newBids - newAsks) / (newBids + newAsks)
 *   4. When |asymmetry| > threshold AND total arrival rate > minRate → trade
 *   5. Positive asymmetry → BUY YES, negative → BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface OrderArrivalRateConfig {
  /** Minimum |asymmetry| to trigger a signal */
  asymmetryThreshold: number;
  /** Minimum new levels per snapshot to consider signal valid */
  minArrivalRate: number;
  /** Number of snapshots to retain per market */
  snapshotWindow: number;
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

export const DEFAULT_CONFIG: OrderArrivalRateConfig = {
  asymmetryThreshold: 0.3,
  minArrivalRate: 3,
  snapshotWindow: 10,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 12 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'order-arrival-rate' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

interface OrderBookSnapshot {
  bidLevels: string[];
  askLevels: string[];
  timestamp: number;
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
 * Count prices in current that are not in prev.
 * Represents newly appeared levels.
 */
export function countNewLevels(prevLevels: string[], currentLevels: string[]): number {
  const prevSet = new Set(prevLevels);
  let count = 0;
  for (const level of currentLevels) {
    if (!prevSet.has(level)) count++;
  }
  return count;
}

/**
 * Calculate arrival rate asymmetry = (bids - asks) / (bids + asks).
 * Returns 0 if both are 0.
 */
export function calcArrivalAsymmetry(newBids: number, newAsks: number): number {
  const total = newBids + newAsks;
  if (total === 0) return 0;
  return (newBids - newAsks) / total;
}

/**
 * Determine whether the signal is active based on asymmetry and total new levels.
 */
export function isSignalActive(
  asymmetry: number,
  totalNew: number,
  config: Pick<OrderArrivalRateConfig, 'asymmetryThreshold' | 'minArrivalRate'>,
): boolean {
  return Math.abs(asymmetry) > config.asymmetryThreshold && totalNew > config.minArrivalRate;
}

/**
 * Extract price strings from orderbook levels.
 */
export function extractPriceLevels(levels: { price: string; size: string }[]): string[] {
  return levels.map(l => l.price);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface OrderArrivalRateDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<OrderArrivalRateConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createOrderArrivalRateTick(deps: OrderArrivalRateDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: OrderArrivalRateConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const snapshots = new Map<string, OrderBookSnapshot[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordSnapshot(tokenId: string, bidLevels: string[], askLevels: string[]): void {
    let history = snapshots.get(tokenId);
    if (!history) {
      history = [];
      snapshots.set(tokenId, history);
    }
    history.push({ bidLevels, askLevels, timestamp: Date.now() });

    // Keep only snapshotWindow snapshots
    if (history.length > cfg.snapshotWindow) {
      history.splice(0, history.length - cfg.snapshotWindow);
    }
  }

  function getSnapshots(tokenId: string): OrderBookSnapshot[] {
    return snapshots.get(tokenId) ?? [];
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

        // Extract current price levels
        const currentBidLevels = extractPriceLevels(book.bids);
        const currentAskLevels = extractPriceLevels(book.asks);

        // Get previous snapshots
        const history = getSnapshots(market.yesTokenId);

        // Record current snapshot
        recordSnapshot(market.yesTokenId, currentBidLevels, currentAskLevels);

        // Need at least 1 previous snapshot to compare
        if (history.length < 1) continue;

        const prevSnapshot = history[history.length - 1];

        // Count new levels
        const newBids = countNewLevels(prevSnapshot.bidLevels, currentBidLevels);
        const newAsks = countNewLevels(prevSnapshot.askLevels, currentAskLevels);
        const totalNew = newBids + newAsks;

        // Calculate asymmetry
        const asymmetry = calcArrivalAsymmetry(newBids, newAsks);

        // Check signal
        if (!isSignalActive(asymmetry, totalNew, cfg)) continue;

        // Determine signal direction
        // Positive asymmetry (more new bids) → BUY YES
        // Negative asymmetry (more new asks) → BUY NO
        const side: 'yes' | 'no' = asymmetry > 0 ? 'yes' : 'no';
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
          asymmetry: asymmetry.toFixed(4),
          totalNew,
          newBids,
          newAsks,
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
        logger.debug('Scan error', STRATEGY_NAME, {
          market: market.conditionId,
          err: String(err),
        });
      }
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function orderArrivalRateTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: snapshots.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
