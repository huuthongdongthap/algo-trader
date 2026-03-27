/**
 * Stale Quote Sniper strategy for Polymarket binary markets.
 *
 * Detects stale/lagging quotes in thin markets by comparing a market's price
 * movement against related markets or its own recent velocity. When a market's
 * price hasn't moved while related signals have shifted, the resting orders
 * are stale and can be picked off.
 *
 * Signal logic:
 *   1. Track price velocity (rate of change) for each market
 *   2. Track aggregate velocity across all tracked markets
 *   3. When a market's velocity ≈ 0 while aggregate velocity is high → stale quote detected
 *   4. Calculate staleness score = aggregate velocity / (market velocity + epsilon)
 *   5. When staleness > threshold AND book has resting orders → snipe the stale quote
 *   6. BUY YES if aggregate drift is positive (market should be moving up)
 *   7. BUY NO if aggregate drift is negative (market should be moving down)
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface StaleQuoteSniperConfig {
  /** Number of price snapshots for velocity calculation */
  velocityWindow: number;
  /** Minimum staleness score to trigger a snipe */
  stalenessThreshold: number;
  /** Small constant to prevent division by zero */
  epsilon: number;
  /** Minimum aggregate velocity to consider */
  minAggVelocity: number;
  /** Minimum market volume (USDC) — lower volume = more stale quotes likely */
  minVolume: number;
  /** Take-profit as fraction (0.02 = 2%) */
  takeProfitPct: number;
  /** Stop-loss as fraction (0.015 = 1.5%) */
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

export const DEFAULT_CONFIG: StaleQuoteSniperConfig = {
  velocityWindow: 10,
  stalenessThreshold: 5.0,
  epsilon: 0.0001,
  minAggVelocity: 0.005,
  minVolume: 3000,
  takeProfitPct: 0.02,
  stopLossPct: 0.015,
  maxHoldMs: 10 * 60_000,
  maxPositions: 5,
  cooldownMs: 60_000,
  positionSize: '8',
};

const STRATEGY_NAME = 'stale-quote-sniper' as StrategyName;

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
 * Calculate price velocity from an array of price snapshots.
 * velocity = (last - first) / length. Returns 0 if fewer than 2 prices.
 */
export function calcVelocity(prices: number[]): number {
  if (prices.length < 2) return 0;
  return (prices[prices.length - 1] - prices[0]) / prices.length;
}

/**
 * Calculate aggregate velocity as the average of absolute velocities.
 * Returns 0 for empty array.
 */
export function calcAggregateVelocity(velocities: number[]): number {
  if (velocities.length === 0) return 0;
  let sum = 0;
  for (const v of velocities) sum += Math.abs(v);
  return sum / velocities.length;
}

/**
 * Calculate staleness score = aggVelocity / (|marketVelocity| + epsilon).
 * High score means the market is not moving while others are.
 */
export function calcStalenessScore(
  aggVelocity: number,
  marketVelocity: number,
  epsilon: number,
): number {
  return aggVelocity / (Math.abs(marketVelocity) + epsilon);
}

/**
 * Determine whether a quote is stale: staleness score exceeds threshold
 * AND aggregate velocity exceeds minimum.
 */
export function isStaleQuote(
  stalenessScore: number,
  aggVelocity: number,
  config: Pick<StaleQuoteSniperConfig, 'stalenessThreshold' | 'minAggVelocity'>,
): boolean {
  return stalenessScore > config.stalenessThreshold && aggVelocity > config.minAggVelocity;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface StaleQuoteSniperDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<StaleQuoteSniperConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createStaleQuoteSniperTick(deps: StaleQuoteSniperDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: StaleQuoteSniperConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

    // Keep only velocityWindow snapshots
    if (history.length > cfg.velocityWindow) {
      history.splice(0, history.length - cfg.velocityWindow);
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

    // First pass: collect prices and velocities for all markets
    const marketVelocities = new Map<string, number>();
    const marketMids = new Map<string, { mid: number; bid: number; ask: number }>();
    const validMarkets: GammaMarket[] = [];

    for (const market of markets) {
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if ((market.volume ?? 0) < cfg.minVolume) continue;

      try {
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        const velocity = calcVelocity(prices);
        marketVelocities.set(market.yesTokenId, velocity);
        marketMids.set(market.yesTokenId, ba);
        validMarkets.push(market);
      } catch (err) {
        logger.debug('Scan error', STRATEGY_NAME, {
          market: market.conditionId,
          err: String(err),
        });
      }
    }

    // Need at least 2 markets to compute aggregate velocity
    if (marketVelocities.size < 2) return;

    const allVelocities = Array.from(marketVelocities.values());
    const aggVelocity = calcAggregateVelocity(allVelocities);

    // Compute aggregate drift (signed average) to determine direction
    let driftSum = 0;
    for (const v of allVelocities) driftSum += v;
    const aggDrift = driftSum / allVelocities.length;

    // Second pass: look for stale quotes
    for (const market of validMarkets) {
      if (positions.length >= cfg.maxPositions) break;
      if (hasPosition(market.yesTokenId!)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId!)) continue;

      const marketVel = marketVelocities.get(market.yesTokenId!) ?? 0;
      const ba = marketMids.get(market.yesTokenId!)!;

      const stalenessScore = calcStalenessScore(aggVelocity, marketVel, cfg.epsilon);

      if (!isStaleQuote(stalenessScore, aggVelocity, cfg)) continue;

      // Determine direction based on aggregate drift
      const side: 'yes' | 'no' = aggDrift > 0 ? 'yes' : 'no';
      const tokenId = side === 'yes' ? market.yesTokenId! : (market.noTokenId ?? market.yesTokenId!);
      const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

      const posSize = parseFloat(cfg.positionSize);

      try {
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
          stalenessScore: stalenessScore.toFixed(2),
          aggVelocity: aggVelocity.toFixed(6),
          marketVelocity: marketVel.toFixed(6),
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
        logger.debug('Entry failed', STRATEGY_NAME, {
          market: market.conditionId,
          err: String(err),
        });
      }
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function staleQuoteSniperTick(): Promise<void> {
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
