/**
 * Gamma Scalping strategy for Polymarket binary markets.
 *
 * Delta-neutral strategy that profits from price oscillations (gamma) in
 * binary markets. Holds both YES and NO positions and rebalances when delta
 * drifts too far, capturing the oscillation spread.
 *
 * In binary markets (price between 0 and 1), gamma is highest near 0.5
 * (maximum uncertainty). The strategy:
 *   1. Opens a balanced YES+NO position near the 50/50 price zone
 *   2. As price oscillates, one side gains more than the other loses (convexity)
 *   3. Rebalances delta when the position gets too directional
 *   4. Profits from the sum of rebalancing gains minus the initial spread cost
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface GammaScalpingConfig {
  /** Lower bound of the gamma zone (high gamma region) */
  gammaZoneLow: number;
  /** Upper bound of the gamma zone */
  gammaZoneHigh: number;
  /** Lower bound for exit (gamma too low) */
  exitZoneLow: number;
  /** Upper bound for exit (gamma too low) */
  exitZoneHigh: number;
  /** Max spread for entry */
  maxSpreadPct: number;
  /** Min realized vol to enter */
  minVol: number;
  /** Normalized delta threshold to trigger rebalance */
  rebalanceThreshold: number;
  /** Base position size in USDC (split across YES+NO) */
  baseSizeUsdc: number;
  /** Max concurrent gamma positions */
  maxPositions: number;
  /** Target P&L to take profit */
  targetPnlPct: number;
  /** Max loss before exit */
  maxLossPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Max rebalances before exit */
  maxRebalances: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
  /** Number of ticks for vol calculation */
  volWindow: number;
}

const DEFAULT_CONFIG: GammaScalpingConfig = {
  gammaZoneLow: 0.35,
  gammaZoneHigh: 0.65,
  exitZoneLow: 0.25,
  exitZoneHigh: 0.75,
  maxSpreadPct: 0.04,
  minVol: 0.01,
  rebalanceThreshold: 0.15,
  baseSizeUsdc: 30,
  maxPositions: 2,
  targetPnlPct: 0.02,
  maxLossPct: 0.03,
  maxHoldMs: 30 * 60_000,
  maxRebalances: 10,
  cooldownMs: 180_000,
  scanLimit: 10,
  volWindow: 20,
};

const STRATEGY_NAME: StrategyName = 'gamma-scalping';

// ── Internal types ───────────────────────────────────────────────────────────

interface PriceTick {
  price: number;
  timestamp: number;
}

interface GammaPosition {
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  yesQty: number;
  noQty: number;
  yesEntryPrice: number;
  noEntryPrice: number;
  yesOrderId: string;
  noOrderId: string;
  openedAt: number;
  rebalanceCount: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Check if mid price is within the gamma zone. */
export function isInGammaZone(mid: number, low: number, high: number): boolean {
  return mid >= low && mid <= high;
}

/** Compute normalized delta: (yesValue - noValue) / totalValue. */
export function calcNormalizedDelta(
  yesQty: number,
  yesPrice: number,
  noQty: number,
  noPrice: number,
): number {
  const yesValue = yesQty * yesPrice;
  const noValue = noQty * noPrice;
  const total = yesValue + noValue;
  if (total === 0) return 0;
  return (yesValue - noValue) / total;
}

/**
 * Calculate amounts to rebalance delta back to ~0.
 * Returns null if position is already balanced.
 */
export function calcRebalanceAmounts(
  yesQty: number,
  yesPrice: number,
  noQty: number,
  noPrice: number,
): { sellYes: number; buyNo: number } | { sellNo: number; buyYes: number } | null {
  const yesValue = yesQty * yesPrice;
  const noValue = noQty * noPrice;
  const diff = yesValue - noValue;

  if (Math.abs(diff) < 1e-9) return null;

  // Rebalance half the value difference
  const rebalanceValue = Math.abs(diff) / 2;

  if (diff > 0) {
    // YES heavier: sell some YES, buy more NO
    return {
      sellYes: yesPrice > 0 ? rebalanceValue / yesPrice : 0,
      buyNo: noPrice > 0 ? rebalanceValue / noPrice : 0,
    };
  } else {
    // NO heavier: sell some NO, buy more YES
    return {
      sellNo: noPrice > 0 ? rebalanceValue / noPrice : 0,
      buyYes: yesPrice > 0 ? rebalanceValue / yesPrice : 0,
    };
  }
}

/**
 * Calculate P&L of a gamma position.
 * P&L = (yesQty * (yesCurrent - yesEntry)) + (noQty * (noCurrent - noEntry))
 */
export function calcPositionPnl(
  yesQty: number,
  yesEntryPrice: number,
  yesCurrentPrice: number,
  noQty: number,
  noEntryPrice: number,
  noCurrentPrice: number,
): number {
  return (
    yesQty * (yesCurrentPrice - yesEntryPrice) +
    noQty * (noCurrentPrice - noEntryPrice)
  );
}

/** Check if mid price has exited the gamma zone (too far from 0.5). */
export function shouldExitGammaZone(mid: number, exitLow: number, exitHigh: number): boolean {
  return mid < exitLow || mid > exitHigh;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

/** Compute realized volatility (standard deviation of returns) from raw prices. */
function calcRealizedVol(prices: number[]): number {
  if (prices.length < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }

  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface GammaScalpingDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<GammaScalpingConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createGammaScalpingTick(deps: GammaScalpingDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: GammaScalpingConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, PriceTick[]>();
  const positions: GammaPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: Date.now() });
    const maxTicks = cfg.volWindow * 3;
    if (history.length > maxTicks) {
      history.splice(0, history.length - maxTicks);
    }
  }

  function getPrices(tokenId: string, count: number): number[] {
    const history = priceHistory.get(tokenId);
    if (!history) return [];
    return history.slice(-count).map(t => t.price);
  }

  function isOnCooldown(conditionId: string): boolean {
    const until = cooldowns.get(conditionId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(conditionId: string): boolean {
    return positions.some(p => p.conditionId === conditionId);
  }

  // ── Exit logic ─────────────────────────────────────────────────────────

  async function checkExits(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      let shouldExit = false;
      let reason = '';

      let yesCurrentPrice: number;
      let noCurrentPrice: number;

      try {
        const yesBook = await clob.getOrderBook(pos.yesTokenId);
        const yesBa = bestBidAsk(yesBook);
        yesCurrentPrice = yesBa.mid;
        noCurrentPrice = 1 - yesCurrentPrice;
        recordTick(pos.yesTokenId, yesCurrentPrice);
      } catch {
        continue;
      }

      const mid = yesCurrentPrice;

      // Calculate P&L
      const totalCost = pos.yesQty * pos.yesEntryPrice + pos.noQty * pos.noEntryPrice;
      const pnl = calcPositionPnl(
        pos.yesQty, pos.yesEntryPrice, yesCurrentPrice,
        pos.noQty, pos.noEntryPrice, noCurrentPrice,
      );
      const pnlPct = totalCost > 0 ? pnl / totalCost : 0;

      // Take profit
      if (pnlPct >= cfg.targetPnlPct) {
        shouldExit = true;
        reason = `target-pnl (${(pnlPct * 100).toFixed(2)}%)`;
      }

      // Stop loss
      if (!shouldExit && pnlPct <= -cfg.maxLossPct) {
        shouldExit = true;
        reason = `max-loss (${(pnlPct * 100).toFixed(2)}%)`;
      }

      // Gamma zone exit
      if (!shouldExit && shouldExitGammaZone(mid, cfg.exitZoneLow, cfg.exitZoneHigh)) {
        shouldExit = true;
        reason = `gamma-zone-exit (mid=${mid.toFixed(4)})`;
      }

      // Max rebalances
      if (!shouldExit && pos.rebalanceCount >= cfg.maxRebalances) {
        shouldExit = true;
        reason = `max-rebalances (${pos.rebalanceCount})`;
      }

      // Max hold time
      if (!shouldExit && now - pos.openedAt > cfg.maxHoldMs) {
        shouldExit = true;
        reason = 'max hold time';
      }

      // Rebalance if not exiting
      if (!shouldExit) {
        const normDelta = calcNormalizedDelta(
          pos.yesQty, yesCurrentPrice,
          pos.noQty, noCurrentPrice,
        );

        if (Math.abs(normDelta) > cfg.rebalanceThreshold) {
          const amounts = calcRebalanceAmounts(
            pos.yesQty, yesCurrentPrice,
            pos.noQty, noCurrentPrice,
          );

          if (amounts) {
            try {
              if ('sellYes' in amounts) {
                // YES heavy: sell YES, buy NO
                await orderManager.placeOrder({
                  tokenId: pos.yesTokenId,
                  side: 'sell',
                  price: yesCurrentPrice.toFixed(4),
                  size: String(Math.round(amounts.sellYes)),
                  orderType: 'IOC',
                });
                await orderManager.placeOrder({
                  tokenId: pos.noTokenId,
                  side: 'buy',
                  price: noCurrentPrice.toFixed(4),
                  size: String(Math.round(amounts.buyNo)),
                  orderType: 'IOC',
                });
                pos.yesQty -= amounts.sellYes;
                pos.noQty += amounts.buyNo;
              } else {
                // NO heavy: sell NO, buy YES
                await orderManager.placeOrder({
                  tokenId: pos.noTokenId,
                  side: 'sell',
                  price: noCurrentPrice.toFixed(4),
                  size: String(Math.round(amounts.sellNo)),
                  orderType: 'IOC',
                });
                await orderManager.placeOrder({
                  tokenId: pos.yesTokenId,
                  side: 'buy',
                  price: yesCurrentPrice.toFixed(4),
                  size: String(Math.round(amounts.buyYes)),
                  orderType: 'IOC',
                });
                pos.noQty -= amounts.sellNo;
                pos.yesQty += amounts.buyYes;
              }

              pos.rebalanceCount++;
              logger.info('Rebalanced', STRATEGY_NAME, {
                conditionId: pos.conditionId,
                rebalanceCount: pos.rebalanceCount,
                normDelta: normDelta.toFixed(4),
              });
            } catch (err) {
              logger.warn('Rebalance failed', STRATEGY_NAME, {
                conditionId: pos.conditionId,
                err: String(err),
              });
            }
          }
        }
        continue;
      }

      // Exit position
      try {
        // Sell YES tokens
        if (pos.yesQty > 0) {
          await orderManager.placeOrder({
            tokenId: pos.yesTokenId,
            side: 'sell',
            price: yesCurrentPrice.toFixed(4),
            size: String(Math.round(pos.yesQty)),
            orderType: 'IOC',
          });
        }
        // Sell NO tokens
        if (pos.noQty > 0) {
          await orderManager.placeOrder({
            tokenId: pos.noTokenId,
            side: 'sell',
            price: noCurrentPrice.toFixed(4),
            size: String(Math.round(pos.noQty)),
            orderType: 'IOC',
          });
        }

        logger.info('Exit position', STRATEGY_NAME, {
          conditionId: pos.conditionId,
          pnl: pnl.toFixed(4),
          pnlPct: (pnlPct * 100).toFixed(2),
          reason,
          rebalances: pos.rebalanceCount,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: pos.yesOrderId,
            marketId: pos.conditionId,
            side: 'sell',
            fillPrice: String(yesCurrentPrice),
            fillSize: String(pos.yesQty),
            fees: '0',
            timestamp: Date.now(),
            strategy: STRATEGY_NAME,
          },
        });

        cooldowns.set(pos.conditionId, now + cfg.cooldownMs);
        toRemove.push(i);
      } catch (err) {
        logger.warn('Exit failed', STRATEGY_NAME, {
          conditionId: pos.conditionId,
          err: String(err),
        });
      }
    }

    // Remove closed positions (reverse order)
    for (let i = toRemove.length - 1; i >= 0; i--) {
      positions.splice(toRemove[i], 1);
    }
  }

  // ── Entry logic ────────────────────────────────────────────────────────

  async function scanEntries(markets: GammaMarket[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || !market.noTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.conditionId)) continue;
      if (isOnCooldown(market.conditionId)) continue;

      try {
        const yesBook = await clob.getOrderBook(market.yesTokenId);
        const yesBa = bestBidAsk(yesBook);
        if (yesBa.mid <= 0 || yesBa.mid >= 1) continue;

        recordTick(market.yesTokenId, yesBa.mid);

        // Check gamma zone
        if (!isInGammaZone(yesBa.mid, cfg.gammaZoneLow, cfg.gammaZoneHigh)) continue;

        // Check spread
        const spread = yesBa.ask - yesBa.bid;
        if (spread > cfg.maxSpreadPct) continue;

        // Check volatility
        const prices = getPrices(market.yesTokenId, cfg.volWindow);
        if (prices.length < cfg.volWindow) continue;
        const vol = calcRealizedVol(prices);
        if (vol < cfg.minVol) continue;

        // Entry: buy equal USDC amounts of YES and NO
        const halfSize = cfg.baseSizeUsdc / 2;
        const yesPrice = yesBa.ask;
        const noPrice = 1 - yesBa.bid; // approximate NO price
        const yesQty = halfSize / yesPrice;
        const noQty = halfSize / noPrice;

        const yesOrder = await orderManager.placeOrder({
          tokenId: market.yesTokenId,
          side: 'buy',
          price: yesPrice.toFixed(4),
          size: String(Math.round(yesQty)),
          orderType: 'GTC',
        });

        const noOrder = await orderManager.placeOrder({
          tokenId: market.noTokenId,
          side: 'buy',
          price: noPrice.toFixed(4),
          size: String(Math.round(noQty)),
          orderType: 'GTC',
        });

        positions.push({
          conditionId: market.conditionId,
          yesTokenId: market.yesTokenId,
          noTokenId: market.noTokenId,
          yesQty,
          noQty,
          yesEntryPrice: yesPrice,
          noEntryPrice: noPrice,
          yesOrderId: yesOrder.id,
          noOrderId: noOrder.id,
          openedAt: Date.now(),
          rebalanceCount: 0,
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          yesMid: yesBa.mid.toFixed(4),
          yesPrice: yesPrice.toFixed(4),
          noPrice: noPrice.toFixed(4),
          vol: vol.toFixed(6),
          size: cfg.baseSizeUsdc,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: yesOrder.id,
            marketId: market.conditionId,
            side: 'buy',
            fillPrice: String(yesPrice),
            fillSize: String(halfSize),
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

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function gammaScalpingTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

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
