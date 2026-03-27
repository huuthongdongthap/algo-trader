/**
 * Price Impact Estimator strategy for Polymarket binary markets.
 *
 * Estimates the price impact of hypothetical orders by analyzing orderbook depth.
 * When the estimated impact of a moderate-sized order is unusually low (deep
 * liquidity at current price), it signals a strong support/resistance level.
 * Trades in the direction of the deep side, expecting price to bounce off the
 * liquidity wall.
 *
 * Signal logic:
 *   1. For each market, simulate eating through N levels of the book on both sides
 *   2. Calculate price impact = (final fill price - current mid) / current mid
 *      for a hypothetical order
 *   3. When buy-side impact << sell-side impact → strong bid support → BUY YES
 *   4. When sell-side impact << buy-side impact → strong ask resistance → BUY NO
 *   5. Require asymmetry ratio > threshold to trade
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface PriceImpactEstimatorConfig {
  /** Simulated order size in shares */
  hypotheticalSize: number;
  /** Minimum ratio of impacts to trigger a signal */
  asymmetryThreshold: number;
  /** EMA alpha for tracking impact over time */
  impactEmaAlpha: number;
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

export const DEFAULT_CONFIG: PriceImpactEstimatorConfig = {
  hypotheticalSize: 500,
  asymmetryThreshold: 2.0,
  impactEmaAlpha: 0.1,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'price-impact-estimator' as StrategyName;

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
 * Walk through orderbook levels filling orderSize, return volume-weighted
 * average fill price. Return 0 if insufficient liquidity.
 */
export function simulatePriceImpact(
  levels: { price: string; size: string }[],
  orderSize: number,
): number {
  if (orderSize <= 0) return 0;
  if (levels.length === 0) return 0;

  let remaining = orderSize;
  let totalCost = 0;
  let totalFilled = 0;

  for (const level of levels) {
    const price = parseFloat(level.price);
    const size = parseFloat(level.size);
    if (size <= 0 || price <= 0) continue;

    const fillAmount = Math.min(remaining, size);
    totalCost += fillAmount * price;
    totalFilled += fillAmount;
    remaining -= fillAmount;

    if (remaining <= 0) break;
  }

  if (remaining > 0) return 0; // insufficient liquidity
  if (totalFilled === 0) return 0;

  return totalCost / totalFilled;
}

/**
 * Calculate impact asymmetry: |buyImpact - sellImpact| / mid.
 * Returns 0 if mid is 0.
 */
export function calcImpactAsymmetry(
  buyImpact: number,
  sellImpact: number,
  mid: number,
): number {
  if (mid === 0) return 0;
  return Math.abs(buyImpact - sellImpact) / mid;
}

/**
 * Determine which side to trade based on impact comparison.
 * buyImpact < sellImpact → 'yes' (strong bid support)
 * sellImpact < buyImpact → 'no' (strong ask resistance)
 * equal → null
 */
export function determineSide(
  buyImpact: number,
  sellImpact: number,
): 'yes' | 'no' | null {
  if (buyImpact < sellImpact) return 'yes';
  if (sellImpact < buyImpact) return 'no';
  return null;
}

/**
 * Update an exponential moving average with a simple alpha-based formula.
 * newEma = alpha * value + (1 - alpha) * prev
 * Returns value when there is no previous EMA (initial case).
 */
export function updateImpactEma(
  prev: number | null,
  value: number,
  alpha: number,
): number {
  if (prev === null) return value;
  if (alpha <= 0) return prev;
  if (alpha >= 1) return value;
  return alpha * value + (1 - alpha) * prev;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface PriceImpactEstimatorDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<PriceImpactEstimatorConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createPriceImpactEstimatorTick(deps: PriceImpactEstimatorDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: PriceImpactEstimatorConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const impactEmaState = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function updateImpactEmaState(tokenId: string, value: number): number {
    const prev = impactEmaState.get(tokenId) ?? null;
    const ema = updateImpactEma(prev, value, cfg.impactEmaAlpha);
    impactEmaState.set(tokenId, ema);
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

        // Simulate price impact on both sides
        const buyFillPrice = simulatePriceImpact(book.asks, cfg.hypotheticalSize);
        const sellFillPrice = simulatePriceImpact(book.bids, cfg.hypotheticalSize);

        // If either side has insufficient liquidity, skip
        if (buyFillPrice === 0 || sellFillPrice === 0) continue;

        // Calculate impacts relative to mid
        const buyImpact = Math.abs(buyFillPrice - ba.mid);
        const sellImpact = Math.abs(sellFillPrice - ba.mid);

        // Calculate asymmetry
        const asymmetry = calcImpactAsymmetry(buyImpact, sellImpact, ba.mid);

        // Update EMA for tracking
        updateImpactEmaState(market.yesTokenId, asymmetry);

        // Check threshold
        if (asymmetry < cfg.asymmetryThreshold) continue;

        // Determine side
        const side = determineSide(buyImpact, sellImpact);
        if (side === null) continue;

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
          buyImpact: buyImpact.toFixed(6),
          sellImpact: sellImpact.toFixed(6),
          asymmetry: asymmetry.toFixed(4),
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

  return async function priceImpactEstimatorTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: impactEmaState.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
