/**
 * Spread Mean Reversion strategy for Polymarket binary markets.
 *
 * Tracks the yes/no price spread within a single binary market. In a fair
 * binary market, yes + no should equal ~1.0. When the spread deviates
 * (yes + no != 1.0), it creates an arbitrage-like opportunity. Trades toward
 * restoring the spread to equilibrium.
 *
 * Signal logic:
 *   1. Calculate spread = yesPrice + noPrice (should be ~1.0)
 *   2. Track spread over time, calculate rolling mean and std
 *   3. When spread > 1.0 + threshold → overpriced → sell both (or buy cheapest)
 *   4. When spread < 1.0 - threshold → underpriced → buy both (or buy cheapest)
 *   5. The cheapest side offers the best risk/reward
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface SpreadMeanReversionConfig {
  /** Number of spread snapshots to retain for rolling statistics */
  spreadWindow: number;
  /** Minimum |deviation| from 1.0 to trigger a signal */
  spreadThreshold: number;
  /** Alpha for spread EMA (0 < alpha < 1) */
  spreadEmaAlpha: number;
  /** Minimum market volume (USDC) to consider */
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

export const DEFAULT_CONFIG: SpreadMeanReversionConfig = {
  spreadWindow: 20,
  spreadThreshold: 0.02,
  spreadEmaAlpha: 0.1,
  minVolume: 5000,
  takeProfitPct: 0.02,
  stopLossPct: 0.015,
  maxHoldMs: 10 * 60_000,
  maxPositions: 5,
  cooldownMs: 60_000,
  positionSize: '8',
};

const STRATEGY_NAME = 'spread-mean-reversion' as StrategyName;

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
 * Calculate spread = yesPrice + noPrice.
 * In a fair binary market this should be ~1.0.
 */
export function calcSpread(yesPrice: number, noPrice: number): number {
  return yesPrice + noPrice;
}

/**
 * Calculate spread deviation = spread - 1.0.
 * Positive means overpriced, negative means underpriced.
 */
export function calcSpreadDeviation(spread: number): number {
  return spread - 1.0;
}

/**
 * Update an exponential moving average with a simple alpha-based formula.
 * newEma = alpha * value + (1 - alpha) * prev
 * Returns value when there is no previous EMA (initial case).
 */
export function updateSpreadEma(prev: number | null, value: number, alpha: number): number {
  if (prev === null) return value;
  if (alpha <= 0) return prev;
  if (alpha >= 1) return value;
  return alpha * value + (1 - alpha) * prev;
}

/**
 * Determine which side is cheaper.
 * Returns 'yes' if yesPrice <= noPrice, otherwise 'no'.
 */
export function determineCheapSide(yesPrice: number, noPrice: number): 'yes' | 'no' {
  return yesPrice <= noPrice ? 'yes' : 'no';
}

/**
 * Check if the spread deviation exceeds the threshold.
 * Returns true when |deviation| > threshold.
 */
export function isSpreadSignal(deviation: number, threshold: number): boolean {
  return Math.abs(deviation) > threshold;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface SpreadMeanReversionDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<SpreadMeanReversionConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createSpreadMeanReversionTick(deps: SpreadMeanReversionDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: SpreadMeanReversionConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const spreadHistory = new Map<string, number[]>();
  const spreadEmaState = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordSpread(conditionId: string, spread: number): void {
    let history = spreadHistory.get(conditionId);
    if (!history) {
      history = [];
      spreadHistory.set(conditionId, history);
    }
    history.push(spread);

    // Keep only spreadWindow snapshots
    if (history.length > cfg.spreadWindow) {
      history.splice(0, history.length - cfg.spreadWindow);
    }
  }

  function getSpreadHistory(conditionId: string): number[] {
    return spreadHistory.get(conditionId) ?? [];
  }

  function updateSpreadEmaState(conditionId: string, spread: number): number {
    const prev = spreadEmaState.get(conditionId) ?? null;
    const ema = updateSpreadEma(prev, spread, cfg.spreadEmaAlpha);
    spreadEmaState.set(conditionId, ema);
    return ema;
  }

  function isOnCooldown(conditionId: string): boolean {
    const until = cooldowns.get(conditionId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(conditionId: string): boolean {
    return positions.some(p => p.conditionId === conditionId);
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

          cooldowns.set(pos.conditionId, now + cfg.cooldownMs);
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
      if (hasPosition(market.conditionId)) continue;
      if (isOnCooldown(market.conditionId)) continue;

      // Check minimum volume
      if ((market.volume ?? 0) < cfg.minVolume) continue;

      try {
        // Get yes price
        const yesBook = await clob.getOrderBook(market.yesTokenId);
        const yesBa = bestBidAsk(yesBook);
        if (yesBa.mid <= 0 || yesBa.mid >= 1) continue;

        // Get no price — derive from yes if no noTokenId
        let noMid: number;
        if (market.noTokenId) {
          const noBook = await clob.getOrderBook(market.noTokenId);
          const noBa = bestBidAsk(noBook);
          noMid = noBa.mid;
        } else {
          noMid = 1 - yesBa.mid;
        }
        if (noMid <= 0 || noMid >= 1) continue;

        // Calculate spread
        const spread = calcSpread(yesBa.mid, noMid);
        const deviation = calcSpreadDeviation(spread);

        // Record spread snapshot
        recordSpread(market.conditionId, spread);
        const history = getSpreadHistory(market.conditionId);

        // Need at least 2 snapshots for meaningful EMA
        if (history.length < 2) continue;

        // Update spread EMA
        const spreadEma = updateSpreadEmaState(market.conditionId, spread);

        // Check threshold
        if (!isSpreadSignal(deviation, cfg.spreadThreshold)) continue;

        // Require deviation to be widening: |current deviation| > |ema deviation|
        const emaDeviation = calcSpreadDeviation(spreadEma);
        if (Math.abs(deviation) <= Math.abs(emaDeviation)) continue;

        // Determine which side to buy (cheapest side)
        const side = determineCheapSide(yesBa.mid, noMid);
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? yesBa.ask : (1 - yesBa.bid);

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
          spread: spread.toFixed(4),
          deviation: deviation.toFixed(4),
          spreadEma: spreadEma.toFixed(4),
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

  return async function spreadMeanReversionTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: spreadHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
