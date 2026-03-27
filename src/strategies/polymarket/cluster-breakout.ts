/**
 * Cluster Breakout strategy for Polymarket binary markets.
 *
 * Identifies price clusters (consolidation zones) where price has been ranging,
 * then trades the breakout when price escapes the cluster. Uses a simple
 * density-based approach: divide recent price range into bins, find the densest
 * cluster, and trade when price moves beyond the cluster boundaries.
 *
 * Signal logic:
 *   1. Collect recent prices into a rolling window
 *   2. Divide the range into bins and count prices per bin
 *   3. Find the "cluster" — the densest contiguous set of bins (most prices)
 *   4. Cluster boundaries: low edge of first dense bin, high edge of last dense bin
 *   5. When price breaks above cluster high → BUY YES (bullish breakout)
 *   6. When price breaks below cluster low → BUY NO (bearish breakout)
 *   7. Require cluster to contain > minClusterPct of all prices
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface ClusterBreakoutConfig {
  /** Number of bins to divide the price range into */
  numBins: number;
  /** Cluster must contain > this fraction of all prices */
  minClusterPct: number;
  /** Number of price snapshots to retain */
  priceWindow: number;
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

export const DEFAULT_CONFIG: ClusterBreakoutConfig = {
  numBins: 15,
  minClusterPct: 0.5,
  priceWindow: 25,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'cluster-breakout' as StrategyName;

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
 * Divide price range into bins and count prices per bin.
 * Returns counts array, the low edge of the first bin, and the bin width.
 * If all prices are identical, returns a single bin with all counts.
 */
export function buildPriceBins(
  prices: number[],
  numBins: number,
): { counts: number[]; binLow: number; binWidth: number } {
  if (prices.length === 0) {
    return { counts: new Array(numBins).fill(0), binLow: 0, binWidth: 0 };
  }

  let min = prices[0];
  let max = prices[0];
  for (const p of prices) {
    if (p < min) min = p;
    if (p > max) max = p;
  }

  // Handle case where all prices are identical
  if (max === min) {
    const counts = new Array(numBins).fill(0);
    counts[0] = prices.length;
    return { counts, binLow: min, binWidth: 0 };
  }

  const range = max - min;
  // Add small epsilon so the max price falls into the last bin, not out of range
  const binWidth = range / numBins;
  const counts = new Array(numBins).fill(0);

  for (const p of prices) {
    let idx = Math.floor((p - min) / binWidth);
    // Clamp to last bin for max value
    if (idx >= numBins) idx = numBins - 1;
    counts[idx]++;
  }

  return { counts, binLow: min, binWidth };
}

/**
 * Find the contiguous run of bins with the highest total count.
 * Tries all possible contiguous windows of varying sizes, picks the one
 * with the most total prices.
 */
export function findDensestCluster(
  counts: number[],
): { startBin: number; endBin: number; totalCount: number } {
  if (counts.length === 0) {
    return { startBin: 0, endBin: 0, totalCount: 0 };
  }

  let bestStart = 0;
  let bestEnd = 0;
  let bestTotal = counts[0];

  for (let start = 0; start < counts.length; start++) {
    let total = 0;
    for (let end = start; end < counts.length; end++) {
      total += counts[end];
      if (total > bestTotal) {
        bestTotal = total;
        bestStart = start;
        bestEnd = end;
      }
    }
  }

  return { startBin: bestStart, endBin: bestEnd, totalCount: bestTotal };
}

/**
 * Calculate the low and high price boundaries of the cluster.
 * low = binLow + startBin * binWidth
 * high = binLow + (endBin + 1) * binWidth
 */
export function calcClusterBounds(
  startBin: number,
  endBin: number,
  binLow: number,
  binWidth: number,
): { low: number; high: number } {
  const low = binLow + startBin * binWidth;
  const high = binLow + (endBin + 1) * binWidth;
  return { low, high };
}

/**
 * Detect whether the current price has broken out of the cluster.
 * Returns 'bullish' if price > high, 'bearish' if price < low, null otherwise.
 */
export function detectClusterBreakout(
  price: number,
  low: number,
  high: number,
): 'bullish' | 'bearish' | null {
  if (price > high) return 'bullish';
  if (price < low) return 'bearish';
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface ClusterBreakoutDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<ClusterBreakoutConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createClusterBreakoutTick(deps: ClusterBreakoutDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: ClusterBreakoutConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
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

    // Keep only priceWindow snapshots
    if (history.length > cfg.priceWindow) {
      history.splice(0, history.length - cfg.priceWindow);
    }
  }

  function getPrices(tokenId: string): number[] {
    return priceHistory.get(tokenId) ?? [];
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

        // Record price snapshot
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need enough history
        if (prices.length < cfg.numBins) continue;

        // Build bins and find cluster
        const { counts, binLow, binWidth } = buildPriceBins(prices, cfg.numBins);

        // If all prices identical (binWidth=0), skip — no breakout possible
        if (binWidth === 0) continue;

        const { startBin, endBin, totalCount } = findDensestCluster(counts);

        // Require cluster to contain > minClusterPct of all prices
        if (totalCount / prices.length <= cfg.minClusterPct) continue;

        const { low, high } = calcClusterBounds(startBin, endBin, binLow, binWidth);

        // Detect breakout
        const breakout = detectClusterBreakout(ba.mid, low, high);
        if (breakout === null) continue;

        // Determine signal
        // bullish breakout → BUY YES
        // bearish breakout → BUY NO
        const side: 'yes' | 'no' = breakout === 'bullish' ? 'yes' : 'no';
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
          clusterLow: low.toFixed(4),
          clusterHigh: high.toFixed(4),
          breakout,
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

  return async function clusterBreakoutTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
