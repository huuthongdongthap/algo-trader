/**
 * Price Acceleration strategy for Polymarket binary markets.
 *
 * Measures the second derivative of price (acceleration) to detect when
 * momentum is building or fading. Positive acceleration means price is
 * moving faster → momentum building. Negative acceleration means price
 * is slowing → momentum fading. Trades acceleration signals.
 *
 * Signal logic:
 *   1. Calculate first derivative (velocity) from price series
 *   2. Calculate second derivative (acceleration) from velocity series
 *   3. When acceleration > threshold and velocity > 0 → momentum building upward → BUY YES
 *   4. When acceleration > threshold and velocity < 0 → momentum building downward → BUY NO
 *   5. Require minimum |velocity| to filter noise
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface PriceAccelerationConfig {
  /** Number of price points to compute velocity over */
  velocityWindow: number;
  /** Number of velocity points to compute acceleration over */
  accelerationWindow: number;
  /** Minimum acceleration magnitude to trigger a signal */
  accelerationThreshold: number;
  /** Minimum |velocity| to filter noise */
  minVelocity: number;
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

export const DEFAULT_CONFIG: PriceAccelerationConfig = {
  velocityWindow: 5,
  accelerationWindow: 3,
  accelerationThreshold: 0.001,
  minVelocity: 0.003,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 12 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'price-acceleration' as StrategyName;

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
 * Calculate velocity (first derivative) as the average change over a window.
 * velocity = (prices[last] - prices[last - window]) / window
 * Returns 0 if not enough data points.
 */
export function calcVelocity(prices: number[], window: number): number {
  if (prices.length < window + 1 || window <= 0) return 0;
  const end = prices[prices.length - 1];
  const start = prices[prices.length - 1 - window];
  return (end - start) / window;
}

/**
 * Calculate acceleration (second derivative) from velocity series.
 * acceleration = (last - first) / length
 * Returns 0 if fewer than 2 velocities.
 */
export function calcAcceleration(velocities: number[]): number {
  if (velocities.length < 2) return 0;
  return (velocities[velocities.length - 1] - velocities[0]) / velocities.length;
}

/**
 * Check whether acceleration and velocity meet signal thresholds.
 */
export function isAccelerationSignal(
  accel: number,
  velocity: number,
  config: Pick<PriceAccelerationConfig, 'accelerationThreshold' | 'minVelocity'>,
): boolean {
  return Math.abs(accel) > config.accelerationThreshold && Math.abs(velocity) > config.minVelocity;
}

/**
 * Determine trade direction from velocity sign.
 * Positive velocity → 'yes' (upward momentum).
 * Negative velocity → 'no' (downward momentum).
 * Zero velocity → null.
 */
export function determineDirection(velocity: number): 'yes' | 'no' | null {
  if (velocity > 0) return 'yes';
  if (velocity < 0) return 'no';
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface PriceAccelerationDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<PriceAccelerationConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createPriceAccelerationTick(deps: PriceAccelerationDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: PriceAccelerationConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
  const velocityHistory = new Map<string, number[]>();
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

    // Keep only enough history for velocity + acceleration computation
    const maxLen = cfg.velocityWindow + cfg.accelerationWindow + 5;
    if (history.length > maxLen) {
      history.splice(0, history.length - maxLen);
    }
  }

  function recordVelocity(tokenId: string, velocity: number): void {
    let history = velocityHistory.get(tokenId);
    if (!history) {
      history = [];
      velocityHistory.set(tokenId, history);
    }
    history.push(velocity);

    // Keep only enough for acceleration computation
    const maxLen = cfg.accelerationWindow + 5;
    if (history.length > maxLen) {
      history.splice(0, history.length - maxLen);
    }
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
        const prices = priceHistory.get(market.yesTokenId) ?? [];

        // Calculate velocity
        const velocity = calcVelocity(prices, cfg.velocityWindow);

        // Record velocity
        recordVelocity(market.yesTokenId, velocity);
        const velocities = velocityHistory.get(market.yesTokenId) ?? [];

        // Calculate acceleration
        const accel = calcAcceleration(velocities);

        // Check signal
        if (!isAccelerationSignal(accel, velocity, cfg)) continue;

        // Determine direction
        const direction = determineDirection(velocity);
        if (!direction) continue;

        const side = direction;
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
          velocity: velocity.toFixed(6),
          acceleration: accel.toFixed(6),
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

  return async function priceAccelerationTick(): Promise<void> {
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
