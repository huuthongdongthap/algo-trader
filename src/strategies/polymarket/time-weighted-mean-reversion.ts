/**
 * Time-Weighted Mean Reversion strategy for Polymarket binary markets.
 *
 * Mean reversion strategy that weights signals by time-of-day patterns.
 * Markets tend to have different volatility and mean-reversion characteristics
 * at different times. This strategy adjusts its z-score threshold and position
 * sizing based on the current hour, being more aggressive during historically
 * high-reversion periods.
 *
 * Signal logic:
 *   1. Track price history and calculate rolling mean + std dev
 *   2. Calculate z-score = (price - mean) / std
 *   3. Determine time bucket (hour of day, 0-23)
 *   4. Apply time weight: multiply z-score threshold by time-weight for current hour
 *   5. When |z-score| > adjusted threshold -> trade toward mean
 *   6. BUY YES if price below mean (z < 0), BUY NO if price above mean (z > 0)
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// -- Config -------------------------------------------------------------------

export interface TimeWeightedMeanReversionConfig {
  /** Rolling window size for mean/std calculation */
  priceWindow: number;
  /** Base z-score threshold before time weighting */
  baseZThreshold: number;
  /** Per-hour multipliers (24 entries, index = hour 0-23) */
  timeWeights: number[];
  /** Minimum std dev to avoid noise trades */
  minStdDev: number;
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

export const DEFAULT_CONFIG: TimeWeightedMeanReversionConfig = {
  priceWindow: 25,
  baseZThreshold: 2.0,
  timeWeights: Array(24).fill(1.0),
  minStdDev: 0.005,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'time-weighted-mean-reversion' as StrategyName;

// -- Internal types -----------------------------------------------------------

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

// -- Pure helpers (exported for testing) --------------------------------------

/**
 * Calculate rolling mean of prices. Returns 0 if empty.
 */
export function calcRollingMean(prices: number[]): number {
  if (prices.length === 0) return 0;
  let sum = 0;
  for (const p of prices) sum += p;
  return sum / prices.length;
}

/**
 * Calculate population standard deviation of prices given a mean.
 * Returns 0 if empty.
 */
export function calcRollingStd(prices: number[], mean: number): number {
  if (prices.length === 0) return 0;
  let sumSq = 0;
  for (const p of prices) {
    const diff = p - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / prices.length);
}

/**
 * Calculate z-score = (price - mean) / std. Returns 0 if std is 0.
 */
export function calcZScore(price: number, mean: number, std: number): number {
  if (std === 0) return 0;
  return (price - mean) / std;
}

/**
 * Get time weight for a given hour. Returns weights[hour % 24], or 1.0 if out of range.
 */
export function getTimeWeight(hour: number, weights: number[]): number {
  const idx = ((hour % 24) + 24) % 24; // handle negatives
  if (idx < 0 || idx >= weights.length) return 1.0;
  return weights[idx];
}

/**
 * Check if signal is active: |zScore| > baseThreshold * timeWeight.
 */
export function isSignalActive(zScore: number, baseThreshold: number, timeWeight: number): boolean {
  return Math.abs(zScore) > baseThreshold * timeWeight;
}

// -- Helpers (private) --------------------------------------------------------

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// -- Dependencies -------------------------------------------------------------

export interface TimeWeightedMeanReversionDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<TimeWeightedMeanReversionConfig>;
  /** Injectable clock for testing (returns current hour 0-23) */
  getCurrentHour?: () => number;
}

// -- Tick factory -------------------------------------------------------------

export function createTimeWeightedMeanReversionTick(deps: TimeWeightedMeanReversionDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: TimeWeightedMeanReversionConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const getCurrentHour = deps.getCurrentHour ?? (() => new Date().getHours());

  // Per-market state
  const priceHistory = new Map<string, number[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // -- Helpers ----------------------------------------------------------------

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

  // -- Exit logic -------------------------------------------------------------

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

  // -- Entry logic ------------------------------------------------------------

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

        // Need at least 2 snapshots for meaningful stats
        if (prices.length < 2) continue;

        // Calculate rolling stats
        const mean = calcRollingMean(prices);
        const std = calcRollingStd(prices, mean);

        // Guard against low std (noise)
        if (std < cfg.minStdDev) continue;

        // Calculate z-score
        const zScore = calcZScore(ba.mid, mean, std);

        // Get time weight for current hour
        const hour = getCurrentHour();
        const timeWeight = getTimeWeight(hour, cfg.timeWeights);

        // Check if signal is active
        if (!isSignalActive(zScore, cfg.baseZThreshold, timeWeight)) continue;

        // Determine signal direction
        // z < 0 → price below mean → BUY YES (expect reversion up)
        // z > 0 → price above mean → BUY NO (expect reversion down)
        const side: 'yes' | 'no' = zScore < 0 ? 'yes' : 'no';
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
          mean: mean.toFixed(4),
          std: std.toFixed(4),
          zScore: zScore.toFixed(4),
          hour,
          timeWeight: timeWeight.toFixed(2),
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

  // -- Main tick --------------------------------------------------------------

  return async function timeWeightedMeanReversionTick(): Promise<void> {
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
