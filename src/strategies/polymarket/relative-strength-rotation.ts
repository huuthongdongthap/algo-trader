/**
 * Relative Strength Rotation strategy for Polymarket binary markets.
 *
 * Ranks markets within the same event by their recent price momentum
 * (relative strength). Rotates capital toward the strongest-performing
 * markets and away from the weakest.
 *
 * Signal logic:
 *   1. Group markets by event (using gamma.getEvents)
 *   2. For each market, calculate momentum score = price change over lookback window
 *   3. Rank markets within each event by momentum score
 *   4. Buy the top-ranked market(s) in each event (relative strength leaders)
 *   5. Sell/avoid the bottom-ranked market(s) (relative weakness)
 *   6. Require minimum rank spread (difference between best and worst) to act
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface RelativeStrengthRotationConfig {
  /** Number of price snapshots for momentum calculation */
  lookbackWindow: number;
  /** Minimum difference between best and worst momentum to act */
  minRankSpread: number;
  /** Top N percent of markets considered leaders (0.25 = 25%) */
  topNPercent: number;
  /** Alpha for momentum EMA smoothing */
  momentumEmaAlpha: number;
  /** Minimum markets per event to rank */
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

export const DEFAULT_CONFIG: RelativeStrengthRotationConfig = {
  lookbackWindow: 15,
  minRankSpread: 0.03,
  topNPercent: 0.25,
  momentumEmaAlpha: 0.12,
  minMarketsPerEvent: 3,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 25 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'relative-strength-rotation' as StrategyName;

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
 * Calculate momentum as (last - first) / first.
 * Returns 0 if fewer than 2 prices or first price is 0.
 */
export function calcMomentum(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  if (first === 0) return 0;
  const last = prices[prices.length - 1];
  return (last - first) / first;
}

/**
 * Rank markets by momentum descending. Rank 1 = best (highest momentum).
 */
export function rankByMomentum(
  momentums: Map<string, number>,
): { marketId: string; momentum: number; rank: number }[] {
  const entries = Array.from(momentums.entries()).map(([marketId, momentum]) => ({
    marketId,
    momentum,
    rank: 0,
  }));
  entries.sort((a, b) => b.momentum - a.momentum);
  for (let i = 0; i < entries.length; i++) {
    entries[i].rank = i + 1;
  }
  return entries;
}

/**
 * Select market IDs in the top N percent of rankings.
 */
export function selectLeaders(
  ranked: { marketId: string; rank: number }[],
  topNPercent: number,
): string[] {
  if (ranked.length === 0) return [];
  const cutoff = Math.max(1, Math.ceil(ranked.length * topNPercent));
  return ranked.filter(r => r.rank <= cutoff).map(r => r.marketId);
}

/**
 * Calculate rank spread = max - min momentum. Returns 0 if empty.
 */
export function calcRankSpread(momentums: number[]): number {
  if (momentums.length === 0) return 0;
  let min = momentums[0];
  let max = momentums[0];
  for (let i = 1; i < momentums.length; i++) {
    if (momentums[i] < min) min = momentums[i];
    if (momentums[i] > max) max = momentums[i];
  }
  return max - min;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface RelativeStrengthRotationDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<RelativeStrengthRotationConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createRelativeStrengthRotationTick(
  deps: RelativeStrengthRotationDeps,
): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: RelativeStrengthRotationConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

    // Keep only lookbackWindow snapshots
    if (history.length > cfg.lookbackWindow) {
      history.splice(0, history.length - cfg.lookbackWindow);
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

  async function scanEntries(eventMarkets: Map<string, GammaMarket[]>): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const [, markets] of eventMarkets) {
      if (positions.length >= cfg.maxPositions) break;

      // Filter eligible markets
      const eligible: GammaMarket[] = [];
      for (const market of markets) {
        if (!market.yesTokenId || market.closed || market.resolved) continue;
        if ((market.volume ?? 0) < cfg.minVolume) continue;
        eligible.push(market);
      }

      if (eligible.length < cfg.minMarketsPerEvent) continue;

      // Fetch prices and record
      const momentums = new Map<string, number>();
      const marketsByToken = new Map<string, GammaMarket>();

      for (const market of eligible) {
        try {
          const book = await clob.getOrderBook(market.yesTokenId);
          const ba = bestBidAsk(book);
          if (ba.mid <= 0 || ba.mid >= 1) continue;

          recordPrice(market.yesTokenId, ba.mid);
          const prices = getPrices(market.yesTokenId);

          if (prices.length < 2) continue;

          const momentum = calcMomentum(prices);
          momentums.set(market.yesTokenId, momentum);
          marketsByToken.set(market.yesTokenId, market);
        } catch {
          continue;
        }
      }

      if (momentums.size < cfg.minMarketsPerEvent) continue;

      // Check rank spread
      const spread = calcRankSpread(Array.from(momentums.values()));
      if (spread < cfg.minRankSpread) continue;

      // Rank and select leaders
      const ranked = rankByMomentum(momentums);
      const leaders = selectLeaders(ranked, cfg.topNPercent);

      for (const tokenId of leaders) {
        if (positions.length >= cfg.maxPositions) break;
        if (hasPosition(tokenId)) continue;
        if (isOnCooldown(tokenId)) continue;

        const market = marketsByToken.get(tokenId);
        if (!market) continue;

        try {
          const book = await clob.getOrderBook(tokenId);
          const ba = bestBidAsk(book);
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
            momentum: momentums.get(tokenId)?.toFixed(4),
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

  return async function relativeStrengthRotationTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover events with markets
      const events = await gamma.getEvents(15);

      // 3. Group markets by event
      const eventMarkets = new Map<string, GammaMarket[]>();
      for (const event of events) {
        if (event.markets && event.markets.length > 0) {
          eventMarkets.set(event.id, event.markets);
        }
      }

      // 4. Scan for entries
      await scanEntries(eventMarkets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
        events: eventMarkets.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
