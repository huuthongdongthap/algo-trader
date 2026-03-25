/**
 * TWAP Accumulator strategy for Polymarket binary markets.
 *
 * Instead of entering one large position, this strategy splits orders across
 * multiple ticks to minimize market impact. It builds large positions in
 * prediction markets by executing equal-sized slices at regular intervals.
 *
 * Signal:
 *   1. Filter trending markets by price range (accumulateLow–accumulateHigh)
 *   2. Split targetSizeUsdc into numSlices equal orders
 *   3. Execute one slice per tick, spaced by sliceIntervalMs
 *   4. Track accumulation state per market (slicesExecuted, totalFilled, avgEntryPrice)
 *   5. Stop when: all slices filled, price exits range, or maxAccumulationMs elapsed
 *   6. After accumulation, manage position with TP/SL/maxHold
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface TwapAccumulatorConfig {
  /** Lower bound of accumulation price range */
  accumulateLow: number;
  /** Upper bound of accumulation price range */
  accumulateHigh: number;
  /** Number of slices to split the order into */
  numSlices: number;
  /** Interval between slices in ms */
  sliceIntervalMs: number;
  /** Maximum time to accumulate before giving up (ms) */
  maxAccumulationMs: number;
  /** Total target position size in USDC */
  targetSizeUsdc: string;
  /** Take profit percentage */
  takeProfitPct: number;
  /** Stop loss percentage */
  stopLossPct: number;
  /** Maximum hold time in ms */
  maxHoldMs: number;
  /** Maximum concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Minimum 24h volume to consider a market */
  minVolume: number;
}

export const DEFAULT_CONFIG: TwapAccumulatorConfig = {
  accumulateLow: 0.20,
  accumulateHigh: 0.45,
  numSlices: 5,
  sliceIntervalMs: 30_000,
  maxAccumulationMs: 300_000,
  targetSizeUsdc: '50',
  takeProfitPct: 0.06,
  stopLossPct: 0.04,
  maxHoldMs: 60 * 60_000,
  maxPositions: 3,
  cooldownMs: 300_000,
  minVolume: 5000,
};

const STRATEGY_NAME: StrategyName = 'twap-accumulator' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

interface AccumulationState {
  conditionId: string;
  tokenId: string;
  slicesExecuted: number;
  totalFilled: number;
  totalCost: number;
  avgEntryPrice: number;
  startedAt: number;
  lastSliceAt: number;
}

interface TwapPosition {
  conditionId: string;
  tokenId: string;
  qty: number;
  entryPrice: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Check if a price is within the accumulation target range. */
export function isInAccumulationRange(
  price: number,
  low: number,
  high: number,
): boolean {
  return price >= low && price <= high;
}

/** Calculate the size of each slice in USDC. */
export function calcSliceSize(targetSizeUsdc: number, numSlices: number): number {
  if (numSlices <= 0) return 0;
  return targetSizeUsdc / numSlices;
}

/**
 * Determine whether accumulation should stop.
 * Returns a reason string if it should stop, or null if accumulation should continue.
 */
export function shouldStopAccumulating(
  state: {
    slicesExecuted: number;
    startedAt: number;
    lastSliceAt: number;
  },
  currentPrice: number,
  config: {
    numSlices: number;
    maxAccumulationMs: number;
    accumulateLow: number;
    accumulateHigh: number;
    sliceIntervalMs: number;
  },
  now: number = Date.now(),
): string | null {
  // All slices filled
  if (state.slicesExecuted >= config.numSlices) {
    return 'all-slices-filled';
  }
  // Price exited target range
  if (!isInAccumulationRange(currentPrice, config.accumulateLow, config.accumulateHigh)) {
    return 'price-out-of-range';
  }
  // Max accumulation time elapsed
  if (now - state.startedAt >= config.maxAccumulationMs) {
    return 'max-time-elapsed';
  }
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface TwapAccumulatorDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<TwapAccumulatorConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createTwapAccumulatorTick(deps: TwapAccumulatorDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: TwapAccumulatorConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const accumulating = new Map<string, AccumulationState>();
  const positions: TwapPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function isOnCooldown(conditionId: string): boolean {
    const until = cooldowns.get(conditionId) ?? 0;
    return Date.now() < until;
  }

  function hasPositionOrAccumulating(conditionId: string): boolean {
    return (
      positions.some(p => p.conditionId === conditionId) ||
      accumulating.has(conditionId)
    );
  }

  // ── Accumulation logic ────────────────────────────────────────────────

  async function processAccumulations(): Promise<void> {
    const now = Date.now();
    const toFinalize: string[] = [];

    for (const [conditionId, state] of accumulating) {
      let currentPrice: number;

      try {
        const book = await clob.getOrderBook(state.tokenId);
        const ba = bestBidAsk(book);
        currentPrice = ba.mid;
      } catch {
        continue;
      }

      // Check if we should stop
      const stopReason = shouldStopAccumulating(state, currentPrice, cfg, now);
      if (stopReason) {
        logger.info('Accumulation stopped', STRATEGY_NAME, {
          conditionId,
          reason: stopReason,
          slicesExecuted: state.slicesExecuted,
          totalFilled: state.totalFilled.toFixed(4),
          avgEntryPrice: state.avgEntryPrice.toFixed(4),
        });

        // If we accumulated anything, promote to a managed position
        if (state.totalFilled > 0) {
          positions.push({
            conditionId: state.conditionId,
            tokenId: state.tokenId,
            qty: state.totalFilled,
            entryPrice: state.avgEntryPrice,
            orderId: `twap-${conditionId}`,
            openedAt: now,
          });
        }

        toFinalize.push(conditionId);
        continue;
      }

      // Check if enough time has passed since last slice
      if (now - state.lastSliceAt < cfg.sliceIntervalMs) continue;

      // Execute one slice
      const sliceUsdc = calcSliceSize(parseFloat(cfg.targetSizeUsdc), cfg.numSlices);
      const sliceQty = sliceUsdc / currentPrice;

      try {
        const order = await orderManager.placeOrder({
          tokenId: state.tokenId,
          side: 'buy',
          price: currentPrice.toFixed(4),
          size: String(Math.round(sliceQty)),
          orderType: 'GTC',
        });

        state.slicesExecuted += 1;
        state.totalFilled += sliceQty;
        state.totalCost += sliceUsdc;
        state.avgEntryPrice = state.totalCost / state.totalFilled;
        state.lastSliceAt = now;

        logger.info('Slice executed', STRATEGY_NAME, {
          conditionId,
          slice: `${state.slicesExecuted}/${cfg.numSlices}`,
          sliceQty: sliceQty.toFixed(4),
          price: currentPrice.toFixed(4),
          avgEntry: state.avgEntryPrice.toFixed(4),
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: order.id,
            marketId: conditionId,
            side: 'buy',
            fillPrice: String(currentPrice),
            fillSize: String(sliceUsdc),
            fees: '0',
            timestamp: now,
            strategy: STRATEGY_NAME,
          },
        });
      } catch (err) {
        logger.warn('Slice failed', STRATEGY_NAME, {
          conditionId,
          err: String(err),
        });
      }
    }

    for (const id of toFinalize) {
      accumulating.delete(id);
    }
  }

  // ── Exit logic ─────────────────────────────────────────────────────────

  async function checkExits(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      let shouldExit = false;
      let reason = '';

      let currentPrice: number;

      try {
        const book = await clob.getOrderBook(pos.tokenId);
        const ba = bestBidAsk(book);
        currentPrice = ba.mid;
      } catch {
        continue;
      }

      // Calculate P&L
      const costBasis = pos.qty * pos.entryPrice;
      const currentValue = pos.qty * currentPrice;
      const pnl = currentValue - costBasis;
      const pnlPct = costBasis > 0 ? pnl / costBasis : 0;

      // Take profit
      if (pnlPct >= cfg.takeProfitPct) {
        shouldExit = true;
        reason = `take-profit (${(pnlPct * 100).toFixed(2)}%)`;
      }

      // Stop loss
      if (!shouldExit && pnlPct <= -cfg.stopLossPct) {
        shouldExit = true;
        reason = `stop-loss (${(pnlPct * 100).toFixed(2)}%)`;
      }

      // Max hold time
      if (!shouldExit && now - pos.openedAt > cfg.maxHoldMs) {
        shouldExit = true;
        reason = 'max hold time';
      }

      if (!shouldExit) continue;

      // Exit position
      try {
        await orderManager.placeOrder({
          tokenId: pos.tokenId,
          side: 'sell',
          price: currentPrice.toFixed(4),
          size: String(Math.round(pos.qty)),
          orderType: 'IOC',
        });

        logger.info('Exit position', STRATEGY_NAME, {
          conditionId: pos.conditionId,
          pnl: pnl.toFixed(4),
          pnlPct: (pnlPct * 100).toFixed(2),
          reason,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: pos.orderId,
            marketId: pos.conditionId,
            side: 'sell',
            fillPrice: String(currentPrice),
            fillSize: String(pos.qty),
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
    const totalActive = positions.length + accumulating.size;
    if (totalActive >= cfg.maxPositions) return;

    for (const market of markets) {
      const totalNow = positions.length + accumulating.size;
      if (totalNow >= cfg.maxPositions) break;
      if (!market.yesTokenId || !market.noTokenId || market.closed || market.resolved) continue;
      if (hasPositionOrAccumulating(market.conditionId)) continue;
      if (isOnCooldown(market.conditionId)) continue;

      // Check volume
      if ((market.volume24h ?? 0) < cfg.minVolume) continue;

      try {
        const yesBook = await clob.getOrderBook(market.yesTokenId);
        const yesBa = bestBidAsk(yesBook);
        if (yesBa.mid <= 0 || yesBa.mid >= 1) continue;

        // Check if price is in accumulation range
        if (!isInAccumulationRange(yesBa.mid, cfg.accumulateLow, cfg.accumulateHigh)) continue;

        // Start accumulation — use YES token since we're buying low-priced outcomes
        const now = Date.now();
        accumulating.set(market.conditionId, {
          conditionId: market.conditionId,
          tokenId: market.yesTokenId,
          slicesExecuted: 0,
          totalFilled: 0,
          totalCost: 0,
          avgEntryPrice: 0,
          startedAt: now,
          lastSliceAt: 0, // Will execute first slice immediately
        });

        logger.info('Accumulation started', STRATEGY_NAME, {
          conditionId: market.conditionId,
          price: yesBa.mid.toFixed(4),
          targetSize: cfg.targetSizeUsdc,
          numSlices: cfg.numSlices,
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

  return async function twapAccumulatorTick(): Promise<void> {
    try {
      await checkExits();

      await processAccumulations();

      const markets = await gamma.getTrending(20);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        accumulating: accumulating.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
