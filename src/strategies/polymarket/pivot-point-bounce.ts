/**
 * Pivot Point Bounce strategy for Polymarket binary markets.
 *
 * Calculates classic pivot points (support/resistance) from recent high/low/close
 * prices and trades bounces off these levels. When price approaches a pivot support
 * and shows a bounce, buy. When price approaches resistance and reverses, sell.
 *
 * Signal logic:
 *   1. Track rolling high, low, close for each market
 *   2. Calculate pivot = (high + low + close) / 3
 *   3. S1 = 2 * pivot - high, R1 = 2 * pivot - low
 *   4. When price bounces off S1 (price was near S1 and now moving up) → BUY YES
 *   5. When price reverses off R1 (price was near R1 and now moving down) → BUY NO
 *   6. "Near" = within proximity threshold
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface PivotPointBounceConfig {
  /** Window for high/low/close calculation */
  hlcWindow: number;
  /** How close price must be to a pivot level to count as "near" */
  proximityThreshold: number;
  /** Number of ticks of reversal required to confirm a bounce */
  bounceConfirmTicks: number;
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

export const DEFAULT_CONFIG: PivotPointBounceConfig = {
  hlcWindow: 20,
  proximityThreshold: 0.01,
  bounceConfirmTicks: 2,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'pivot-point-bounce' as StrategyName;

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
 * Calculate classic pivot points from high, low, close.
 * pivot = (high + low + close) / 3
 * S1 = 2 * pivot - high
 * R1 = 2 * pivot - low
 */
export function calcPivotPoints(
  high: number,
  low: number,
  close: number,
): { pivot: number; s1: number; r1: number } {
  const pivot = (high + low + close) / 3;
  const s1 = 2 * pivot - high;
  const r1 = 2 * pivot - low;
  return { pivot, s1, r1 };
}

/**
 * Check if a price is near a given level within a threshold.
 * |price - level| <= threshold
 */
export function isNearLevel(price: number, level: number, threshold: number): boolean {
  return Math.abs(price - level) <= threshold;
}

/**
 * Detect a bounce off a level by checking the last N ticks for directional reversal.
 * For direction 'up': prices should be moving upward (each tick >= previous).
 * For direction 'down': prices should be moving downward (each tick <= previous).
 * Requires at least confirmTicks prices in the tail to confirm.
 */
export function detectBounce(
  prices: number[],
  level: number,
  direction: 'up' | 'down',
  confirmTicks: number,
): boolean {
  if (prices.length < confirmTicks + 1) return false;

  // The price before the confirmation window should be near the level
  const pivotIndex = prices.length - confirmTicks - 1;
  const pivotPrice = prices[pivotIndex];
  // Use a generous threshold for level proximity (5% of level or 0.02, whichever is larger)
  const threshold = Math.max(Math.abs(level) * 0.05, 0.02);
  if (Math.abs(pivotPrice - level) > threshold) return false;

  // Check the confirmation ticks for consistent directional movement
  const tail = prices.slice(prices.length - confirmTicks);
  let prevPrice = prices[prices.length - confirmTicks - 1];

  for (const p of tail) {
    if (direction === 'up' && p < prevPrice) return false;
    if (direction === 'down' && p > prevPrice) return false;
    prevPrice = p;
  }

  // Ensure there's actual movement (not flat)
  const first = prices[prices.length - confirmTicks - 1];
  const last = prices[prices.length - 1];
  if (direction === 'up' && last <= first) return false;
  if (direction === 'down' && last >= first) return false;

  return true;
}

/**
 * Find high, low, close from an array of prices.
 * high = max, low = min, close = last element.
 */
export function findHLC(prices: number[]): { high: number; low: number; close: number } {
  if (prices.length === 0) return { high: 0, low: 0, close: 0 };

  let high = -Infinity;
  let low = Infinity;

  for (const p of prices) {
    if (p > high) high = p;
    if (p < low) low = p;
  }

  return { high, low, close: prices[prices.length - 1] };
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface PivotPointBounceDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<PivotPointBounceConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createPivotPointBounceTick(deps: PivotPointBounceDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: PivotPointBounceConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

    // Keep only hlcWindow + bounceConfirmTicks + 1 prices
    const maxLen = cfg.hlcWindow + cfg.bounceConfirmTicks + 1;
    if (history.length > maxLen) {
      history.splice(0, history.length - maxLen);
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

        // Record price
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need at least hlcWindow prices to calculate pivot points
        if (prices.length < cfg.hlcWindow) continue;

        // Calculate HLC from the window
        const windowPrices = prices.slice(prices.length - cfg.hlcWindow);
        const hlc = findHLC(windowPrices);

        // Calculate pivot points
        const { s1, r1 } = calcPivotPoints(hlc.high, hlc.low, hlc.close);

        // Check for bounce off S1 (support bounce → BUY YES)
        if (isNearLevel(ba.mid, s1, cfg.proximityThreshold) || detectBounce(prices, s1, 'up', cfg.bounceConfirmTicks)) {
          if (detectBounce(prices, s1, 'up', cfg.bounceConfirmTicks)) {
            const tokenId = market.yesTokenId;
            const entryPrice = ba.ask;
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
              side: 'yes',
              entryPrice,
              sizeUsdc: posSize,
              orderId: order.id,
              openedAt: Date.now(),
            });

            logger.info('Entry position', STRATEGY_NAME, {
              conditionId: market.conditionId,
              side: 'yes',
              entryPrice: entryPrice.toFixed(4),
              s1: s1.toFixed(4),
              r1: r1.toFixed(4),
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

            continue;
          }
        }

        // Check for reversal off R1 (resistance reversal → BUY NO)
        if (isNearLevel(ba.mid, r1, cfg.proximityThreshold) || detectBounce(prices, r1, 'down', cfg.bounceConfirmTicks)) {
          if (detectBounce(prices, r1, 'down', cfg.bounceConfirmTicks)) {
            const tokenId = market.noTokenId ?? market.yesTokenId;
            const entryPrice = 1 - ba.bid;
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
              side: 'no',
              entryPrice,
              sizeUsdc: posSize,
              orderId: order.id,
              openedAt: Date.now(),
            });

            logger.info('Entry position', STRATEGY_NAME, {
              conditionId: market.conditionId,
              side: 'no',
              entryPrice: entryPrice.toFixed(4),
              s1: s1.toFixed(4),
              r1: r1.toFixed(4),
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

            continue;
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

  return async function pivotPointBounceTick(): Promise<void> {
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
