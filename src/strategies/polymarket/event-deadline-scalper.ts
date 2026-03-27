/**
 * Event Deadline Scalper strategy for Polymarket binary markets.
 *
 * Exploits the acceleration of price discovery as markets approach their
 * resolution deadline. As deadline nears, markets tend to move toward extreme
 * values (0 or 1) faster. This strategy detects when a market is approaching
 * deadline with price accelerating toward an extreme, and trades in that
 * direction.
 *
 * Signal logic:
 *   1. Track market end date/time from market metadata
 *   2. Calculate time-to-deadline ratio (0 = far, 1 = imminent)
 *   3. Calculate price momentum toward nearest extreme (0 or 1)
 *   4. Deadline urgency score = momentum * (1 + timeUrgency^2)
 *   5. When score > threshold → trade toward the extreme
 *   6. Price > 0.5 and accelerating → BUY YES, Price < 0.5 and accelerating → BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface EventDeadlineScalperConfig {
  /** Minimum urgency score to trigger entry */
  urgencyThreshold: number;
  /** Only trade when this fraction of time has elapsed (0.7 = 70%) */
  minTimeUrgency: number;
  /** Number of price snapshots for momentum calculation */
  momentumWindow: number;
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

export const DEFAULT_CONFIG: EventDeadlineScalperConfig = {
  urgencyThreshold: 0.05,
  minTimeUrgency: 0.7,
  momentumWindow: 10,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 10 * 60_000,
  maxPositions: 4,
  cooldownMs: 60_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'event-deadline-scalper' as StrategyName;

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
 * Calculate time urgency: how close we are to the deadline.
 * Returns (now - start) / (end - start), clamped to [0, 1].
 */
export function calcTimeUrgency(now: number, startTime: number, endTime: number): number {
  if (endTime <= startTime) return 1;
  const elapsed = now - startTime;
  const total = endTime - startTime;
  const ratio = elapsed / total;
  return Math.max(0, Math.min(1, ratio));
}

/**
 * Calculate momentum toward the nearest extreme (0 or 1).
 * Uses the price series to determine if price is accelerating toward 0 or 1.
 * Returns a non-negative value representing momentum magnitude toward the
 * nearest extreme.
 */
export function calcMomentumTowardExtreme(prices: number[]): number {
  if (prices.length < 2) return 0;

  const current = prices[prices.length - 1];
  const previous = prices[0];

  // Determine nearest extreme
  const nearestExtreme = current > 0.5 ? 1 : 0;

  // Momentum toward extreme: positive means moving toward it
  const direction = nearestExtreme === 1 ? 1 : -1;
  const momentum = (current - previous) * direction;

  return Math.max(0, momentum);
}

/**
 * Calculate urgency score = momentum * (1 + timeUrgency^2).
 * Higher score means stronger signal to trade.
 */
export function calcUrgencyScore(momentum: number, timeUrgency: number): number {
  return momentum * (1 + timeUrgency * timeUrgency);
}

/**
 * Determine trade direction based on current price.
 * Price > 0.5 → 'yes' (buy YES, betting on resolution to 1)
 * Price <= 0.5 → 'no' (buy NO, betting on resolution to 0)
 */
export function determineDirection(currentPrice: number): 'yes' | 'no' {
  return currentPrice > 0.5 ? 'yes' : 'no';
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface EventDeadlineScalperDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<EventDeadlineScalperConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createEventDeadlineScalperTick(deps: EventDeadlineScalperDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: EventDeadlineScalperConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

    // Keep only momentumWindow snapshots
    if (history.length > cfg.momentumWindow) {
      history.splice(0, history.length - cfg.momentumWindow);
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

    const now = Date.now();

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.yesTokenId)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId)) continue;

      // Check minimum volume
      if ((market.volume ?? 0) < cfg.minVolume) continue;

      // Need an end date for deadline calculation
      if (!market.endDate) continue;

      try {
        // Fetch orderbook for YES token
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        // Record price
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need at least 2 prices for momentum
        if (prices.length < 2) continue;

        // Calculate time urgency
        // Use a reasonable start time estimate: endDate minus some default duration
        const endTime = new Date(market.endDate).getTime();
        // Estimate start as endDate minus 30 days if no explicit start
        const startTime = endTime - 30 * 24 * 60 * 60 * 1000;
        const timeUrgency = calcTimeUrgency(now, startTime, endTime);

        // Must be past minTimeUrgency threshold
        if (timeUrgency < cfg.minTimeUrgency) continue;

        // Calculate momentum toward extreme
        const momentum = calcMomentumTowardExtreme(prices);
        if (momentum <= 0) continue;

        // Calculate urgency score
        const urgencyScore = calcUrgencyScore(momentum, timeUrgency);

        // Check threshold
        if (urgencyScore < cfg.urgencyThreshold) continue;

        // Determine direction
        const side = determineDirection(ba.mid);
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
          urgencyScore: urgencyScore.toFixed(4),
          momentum: momentum.toFixed(4),
          timeUrgency: timeUrgency.toFixed(4),
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

  return async function eventDeadlineScalperTick(): Promise<void> {
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
