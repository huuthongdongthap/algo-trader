/**
 * Liquidity Migration strategy for Polymarket binary markets.
 *
 * Detects when liquidity is migrating from one side of the book to the other.
 * When market makers pull asks and add bids (or vice versa), it signals
 * directional conviction. Trades in the direction liquidity is migrating to.
 *
 * Signal logic:
 *   1. Track total bid depth and ask depth over time
 *   2. Calculate bid depth change rate and ask depth change rate
 *   3. Migration score = bidChangeRate - askChangeRate
 *   4. Positive migration (bids growing, asks shrinking) → BUY YES
 *   5. Negative migration (asks growing, bids shrinking) → BUY NO
 *   6. Require |migration score| > threshold
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface LiquidityMigrationConfig {
  /** Number of depth snapshots to retain */
  depthWindow: number;
  /** Minimum |migration score| to trigger a signal */
  migrationThreshold: number;
  /** Alpha for EMA smoothing of migration score */
  smoothingAlpha: number;
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

export const DEFAULT_CONFIG: LiquidityMigrationConfig = {
  depthWindow: 10,
  migrationThreshold: 0.15,
  smoothingAlpha: 0.12,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'liquidity-migration' as StrategyName;

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
 * Calculate depth change rate from a history of depth values.
 * Returns (last - first) / first. Returns 0 if fewer than 2 entries or first is 0.
 */
export function calcDepthChangeRate(depthHistory: number[]): number {
  if (depthHistory.length < 2) return 0;
  const first = depthHistory[0];
  if (first === 0) return 0;
  const last = depthHistory[depthHistory.length - 1];
  return (last - first) / first;
}

/**
 * Calculate migration score = bidChangeRate - askChangeRate.
 * Positive means bids growing relative to asks (bullish).
 * Negative means asks growing relative to bids (bearish).
 */
export function calcMigrationScore(bidChangeRate: number, askChangeRate: number): number {
  return bidChangeRate - askChangeRate;
}

/**
 * Smooth migration score using exponential moving average.
 * Returns current when there is no previous smoothed value (initial case).
 */
export function smoothMigration(prevSmoothed: number | null, current: number, alpha: number): number {
  if (prevSmoothed === null) return current;
  if (alpha <= 0) return prevSmoothed;
  if (alpha >= 1) return current;
  return alpha * current + (1 - alpha) * prevSmoothed;
}

/**
 * Check whether |score| exceeds threshold, indicating a migration signal.
 */
export function isMigrationSignal(score: number, threshold: number): boolean {
  return Math.abs(score) > threshold;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

/** Calculate total depth from one side of the book. */
function totalDepth(levels: { price: string; size: string }[]): number {
  let total = 0;
  for (const level of levels) {
    total += parseFloat(level.size);
  }
  return total;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface LiquidityMigrationDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<LiquidityMigrationConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createLiquidityMigrationTick(deps: LiquidityMigrationDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: LiquidityMigrationConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const bidDepthHistory = new Map<string, number[]>();
  const askDepthHistory = new Map<string, number[]>();
  const smoothedScores = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordDepth(tokenId: string, bidDepth: number, askDepth: number): void {
    let bidHistory = bidDepthHistory.get(tokenId);
    if (!bidHistory) {
      bidHistory = [];
      bidDepthHistory.set(tokenId, bidHistory);
    }
    bidHistory.push(bidDepth);
    if (bidHistory.length > cfg.depthWindow) {
      bidHistory.splice(0, bidHistory.length - cfg.depthWindow);
    }

    let askHistory = askDepthHistory.get(tokenId);
    if (!askHistory) {
      askHistory = [];
      askDepthHistory.set(tokenId, askHistory);
    }
    askHistory.push(askDepth);
    if (askHistory.length > cfg.depthWindow) {
      askHistory.splice(0, askHistory.length - cfg.depthWindow);
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

        // Calculate bid and ask depth
        const bidDepth = totalDepth(book.bids);
        const askDepth = totalDepth(book.asks);

        // Record depth snapshot
        recordDepth(market.yesTokenId, bidDepth, askDepth);

        const bidHistory = bidDepthHistory.get(market.yesTokenId) ?? [];
        const askHistory = askDepthHistory.get(market.yesTokenId) ?? [];

        // Need at least 2 snapshots for meaningful change rate
        if (bidHistory.length < 2) continue;

        // Calculate change rates
        const bidChangeRate = calcDepthChangeRate(bidHistory);
        const askChangeRate = calcDepthChangeRate(askHistory);

        // Calculate migration score
        const rawScore = calcMigrationScore(bidChangeRate, askChangeRate);

        // Smooth the score
        const prevSmoothed = smoothedScores.get(market.yesTokenId) ?? null;
        const smoothed = smoothMigration(prevSmoothed, rawScore, cfg.smoothingAlpha);
        smoothedScores.set(market.yesTokenId, smoothed);

        // Check signal
        if (!isMigrationSignal(smoothed, cfg.migrationThreshold)) continue;

        // Determine signal direction
        // Positive migration (bids growing, asks shrinking) → BUY YES
        // Negative migration (asks growing, bids shrinking) → BUY NO
        const side: 'yes' | 'no' = smoothed > 0 ? 'yes' : 'no';
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
          migrationScore: smoothed.toFixed(4),
          bidChangeRate: bidChangeRate.toFixed(4),
          askChangeRate: askChangeRate.toFixed(4),
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

  return async function liquidityMigrationTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: bidDepthHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
