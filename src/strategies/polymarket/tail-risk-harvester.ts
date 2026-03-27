/**
 * Tail Risk Harvester strategy for Polymarket binary markets.
 *
 * Harvests premium from extreme-probability markets (those near 0 or 1) where
 * tail risk is mispriced. When a market is priced very close to an extreme but
 * has historical mean-reversion tendencies, sells the extreme (buys the
 * opposite side) to collect the small premium. Think of it as selling
 * "insurance" on unlikely outcomes.
 *
 * Signal logic:
 *   1. Identify markets with extreme prices (< extremeLow or > extremeHigh)
 *   2. Check if the market has shown reversion from extremes before (historical reversion rate)
 *   3. Calculate expected value: premium collected * (1 - tail_probability)
 *   4. When EV > threshold → sell the extreme
 *   5. Price > extremeHigh (e.g., 0.95) → BUY NO (bet it won't resolve YES)
 *   6. Price < extremeLow (e.g., 0.05) → BUY YES (bet it won't resolve NO)
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface TailRiskHarvesterConfig {
  /** Price above this is considered extreme yes */
  extremeHigh: number;
  /** Price below this is considered extreme no */
  extremeLow: number;
  /** Minimum historical reversion rate to consider entry */
  minReversionRate: number;
  /** Number of snapshots to estimate reversion */
  reversionWindow: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (small — premium collection) */
  takeProfitPct: number;
  /** Stop-loss as fraction (wider — tail risk) */
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

export const DEFAULT_CONFIG: TailRiskHarvesterConfig = {
  extremeHigh: 0.92,
  extremeLow: 0.08,
  minReversionRate: 0.3,
  reversionWindow: 30,
  minVolume: 5000,
  takeProfitPct: 0.015,
  stopLossPct: 0.05,
  maxHoldMs: 30 * 60_000,
  maxPositions: 5,
  cooldownMs: 180_000,
  positionSize: '8',
};

const STRATEGY_NAME = 'tail-risk-harvester' as StrategyName;

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
 * Determine if a price is extreme.
 * Returns 'high' if price > extremeHigh, 'low' if price < extremeLow, null otherwise.
 */
export function isExtremePrice(
  price: number,
  extremeHigh: number,
  extremeLow: number,
): 'high' | 'low' | null {
  if (price > extremeHigh) return 'high';
  if (price < extremeLow) return 'low';
  return null;
}

/**
 * Calculate the fraction of times price reverted from an extreme zone.
 * A "reversion" is when price was extreme in one snapshot and not extreme in the next.
 * Returns 0 if there are fewer than 2 prices or no extreme observations.
 */
export function calcReversionRate(
  prices: number[],
  extremeHigh: number,
  extremeLow: number,
): number {
  if (prices.length < 2) return 0;

  let extremeCount = 0;
  let reversionCount = 0;

  for (let i = 0; i < prices.length - 1; i++) {
    const currentExtreme = isExtremePrice(prices[i], extremeHigh, extremeLow);
    if (currentExtreme !== null) {
      extremeCount++;
      const nextExtreme = isExtremePrice(prices[i + 1], extremeHigh, extremeLow);
      if (nextExtreme === null) {
        reversionCount++;
      }
    }
  }

  if (extremeCount === 0) return 0;
  return reversionCount / extremeCount;
}

/**
 * Calculate expected value: premium * reversionRate.
 */
export function calcExpectedValue(premium: number, reversionRate: number): number {
  return premium * reversionRate;
}

/**
 * Calculate premium from a price: min(price, 1 - price).
 * The closer to an extreme, the smaller the premium.
 */
export function calcPremium(price: number): number {
  return Math.min(price, 1 - price);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface TailRiskHarvesterDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<TailRiskHarvesterConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createTailRiskHarvesterTick(deps: TailRiskHarvesterDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: TailRiskHarvesterConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

    // Keep only reversionWindow snapshots
    if (history.length > cfg.reversionWindow) {
      history.splice(0, history.length - cfg.reversionWindow);
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

        // Check if price is extreme
        const extreme = isExtremePrice(ba.mid, cfg.extremeHigh, cfg.extremeLow);
        if (extreme === null) continue;

        // Need enough history to estimate reversion
        if (prices.length < 2) continue;

        // Calculate reversion rate from history
        const reversionRate = calcReversionRate(prices, cfg.extremeHigh, cfg.extremeLow);
        if (reversionRate < cfg.minReversionRate) continue;

        // Calculate premium and expected value
        const premium = calcPremium(ba.mid);
        const ev = calcExpectedValue(premium, reversionRate);
        if (ev <= 0) continue;

        // Determine signal:
        // Price > extremeHigh → BUY NO (bet it won't resolve YES)
        // Price < extremeLow → BUY YES (bet it won't resolve NO)
        const side: 'yes' | 'no' = extreme === 'low' ? 'yes' : 'no';
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
          extreme,
          premium: premium.toFixed(4),
          ev: ev.toFixed(4),
          reversionRate: reversionRate.toFixed(4),
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

  return async function tailRiskHarvesterTick(): Promise<void> {
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
