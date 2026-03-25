/**
 * Momentum Exhaustion strategy for Polymarket binary markets.
 *
 * Detects when a strong price trend is losing steam and trades the reversal
 * when momentum shows signs of exhaustion (diminishing returns + volume
 * divergence).
 *
 * Signal logic:
 *   Track price returns (tick-to-tick changes) per market.
 *   Calculate momentum strength = sum of last N returns (signed).
 *   Calculate momentum acceleration = difference between recent momentum
 *     and prior momentum.
 *   Exhaustion signal: strong momentum (|momentum| > momentumThreshold)
 *     BUT acceleration is opposite sign (momentum slowing).
 *   Volume divergence confirmation: price making new highs/lows but
 *     volume declining.
 *   Track volume history and compare recent avg vs earlier avg.
 *
 *   Entry: momentum exhaustion + volume divergence → fade the trend.
 *   Direction: exhausted uptrend → BUY NO, exhausted downtrend → BUY YES.
 *
 * Exit conditions:
 *   - Take-profit: price moved takeProfitPct in our favour
 *   - Stop-loss:   price moved stopLossPct against us
 *   - Max hold:    position older than maxHoldMs
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface MomentumExhaustionConfig {
  /** Number of returns to sum for momentum calculation */
  momentumWindow: number;
  /** Window for measuring recent vs prior momentum (acceleration) */
  accelerationWindow: number;
  /** Minimum |momentum| to consider a trend strong */
  momentumThreshold: number;
  /** Ratio threshold: recent volume / earlier volume must be below this */
  volumeDeclineRatio: number;
  /** Max price history entries to keep per market */
  priceHistoryLen: number;
  /** Take-profit as fraction of entry price */
  takeProfitPct: number;
  /** Stop-loss as fraction of entry price */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Trade size in USDC */
  positionSize: string;
}

export const DEFAULT_CONFIG: MomentumExhaustionConfig = {
  momentumWindow: 15,
  accelerationWindow: 5,
  momentumThreshold: 0.06,
  volumeDeclineRatio: 0.7,
  priceHistoryLen: 50,
  takeProfitPct: 0.04,
  stopLossPct: 0.025,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME: StrategyName = 'momentum-exhaustion' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface PriceTick {
  price: number;
  timestamp: number;
  volume: number;
}

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
 * Compute tick-to-tick returns from price ticks.
 * Returns an array of length (ticks.length - 1).
 */
export function tickReturns(ticks: PriceTick[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < ticks.length; i++) {
    const prev = ticks[i - 1].price;
    if (prev === 0) {
      returns.push(0);
    } else {
      returns.push((ticks[i].price - prev) / prev);
    }
  }
  return returns;
}

/**
 * Calculate signed momentum = sum of the last `window` returns.
 * Returns 0 if insufficient data.
 */
export function calcMomentum(returns: number[], window: number): number {
  if (returns.length === 0 || window <= 0) return 0;
  const n = Math.min(window, returns.length);
  let sum = 0;
  for (let i = returns.length - n; i < returns.length; i++) {
    sum += returns[i];
  }
  return sum;
}

/**
 * Calculate momentum acceleration = recent momentum - prior momentum.
 * Splits the last (momentumWindow) returns into two halves around
 * accelerationWindow: recent = last accelerationWindow returns,
 * prior = the accelerationWindow returns before that.
 * Returns 0 if insufficient data.
 */
export function calcAcceleration(
  returns: number[],
  momentumWindow: number,
  accelerationWindow: number,
): number {
  const needed = accelerationWindow * 2;
  if (returns.length < needed || accelerationWindow <= 0) return 0;

  let recent = 0;
  let prior = 0;
  const end = returns.length;
  for (let i = end - accelerationWindow; i < end; i++) {
    recent += returns[i];
  }
  for (let i = end - 2 * accelerationWindow; i < end - accelerationWindow; i++) {
    prior += returns[i];
  }
  return recent - prior;
}

/**
 * Determine whether momentum is exhausted:
 * - Momentum is strong (|momentum| > threshold)
 * - Acceleration has the opposite sign (momentum is slowing)
 */
export function isExhausted(
  momentum: number,
  acceleration: number,
  threshold: number,
): boolean {
  if (Math.abs(momentum) <= threshold) return false;
  if (acceleration === 0) return false;
  // Opposite sign means momentum is decelerating
  return (momentum > 0 && acceleration < 0) || (momentum < 0 && acceleration > 0);
}

/**
 * Check for volume divergence: price making new extremes but volume declining.
 * Compares the average volume of the recent half of ticks to the earlier half.
 * Returns true if recentAvgVol / earlierAvgVol < volumeDeclineRatio AND
 * price is at new high (for uptrend) or new low (for downtrend).
 */
export function hasVolumeDivergence(
  ticks: PriceTick[],
  volumeDeclineRatio: number,
  trendDirection: 'up' | 'down',
): boolean {
  if (ticks.length < 4) return false;

  const half = Math.floor(ticks.length / 2);
  const earlier = ticks.slice(0, half);
  const recent = ticks.slice(half);

  // Average volumes
  let earlierVolSum = 0;
  for (const t of earlier) earlierVolSum += t.volume;
  const earlierAvg = earlierVolSum / earlier.length;

  let recentVolSum = 0;
  for (const t of recent) recentVolSum += t.volume;
  const recentAvg = recentVolSum / recent.length;

  if (earlierAvg === 0) return false;
  const ratio = recentAvg / earlierAvg;
  if (ratio >= volumeDeclineRatio) return false;

  // Check price extreme
  const lastPrice = ticks[ticks.length - 1].price;
  if (trendDirection === 'up') {
    // Price should be near/at the highest in the window
    const maxEarlier = Math.max(...earlier.map(t => t.price));
    return lastPrice >= maxEarlier;
  } else {
    // Price should be near/at the lowest in the window
    const minEarlier = Math.min(...earlier.map(t => t.price));
    return lastPrice <= minEarlier;
  }
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Extract mid price from raw order book. */
function bestMid(book: RawOrderBook): number {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return (bid + ask) / 2;
}

/** Extract best ask from raw order book. */
function bestAsk(book: RawOrderBook): number {
  return book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
}

/** Estimate tick volume from order book depth. */
function estimateVolume(book: RawOrderBook): number {
  let vol = 0;
  for (const b of book.bids) vol += parseFloat(b.size);
  for (const a of book.asks) vol += parseFloat(a.size);
  return vol;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface MomentumExhaustionDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<MomentumExhaustionConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createMomentumExhaustionTick(deps: MomentumExhaustionDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: MomentumExhaustionConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Internal state
  const priceHistory = new Map<string, PriceTick[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number, volume: number): void {
    let arr = priceHistory.get(tokenId);
    if (!arr) {
      arr = [];
      priceHistory.set(tokenId, arr);
    }
    arr.push({ price, timestamp: Date.now(), volume });
    if (arr.length > cfg.priceHistoryLen) {
      arr.splice(0, arr.length - cfg.priceHistoryLen);
    }
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPositionFor(tokenId: string): boolean {
    return positions.some(p => p.tokenId === tokenId);
  }

  // ── Exit logic ─────────────────────────────────────────────────────────

  async function checkExits(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      let shouldExit = false;
      let reason = '';

      let currentMid: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        currentMid = bestMid(book);
        const vol = estimateVolume(book);
        recordTick(pos.tokenId, currentMid, vol);
      } catch {
        continue;
      }

      // Compute current PnL relative to entry
      const priceDelta = pos.side === 'yes'
        ? currentMid - pos.entryPrice
        : pos.entryPrice - currentMid;
      const pnlPct = priceDelta / pos.entryPrice;

      // Take-profit
      if (pnlPct >= cfg.takeProfitPct) {
        shouldExit = true;
        reason = `take-profit (pnl=${(pnlPct * 100).toFixed(2)}%)`;
      }

      // Stop-loss
      if (!shouldExit && pnlPct <= -cfg.stopLossPct) {
        shouldExit = true;
        reason = `stop-loss (pnl=${(pnlPct * 100).toFixed(2)}%)`;
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
            price: currentMid.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / currentMid)),
            orderType: 'IOC',
          });

          const totalPnl = priceDelta * (pos.sizeUsdc / pos.entryPrice);

          logger.info('Exit position', STRATEGY_NAME, {
            tokenId: pos.tokenId,
            pnl: totalPnl.toFixed(4),
            reason,
          });

          eventBus.emit('trade.executed', {
            trade: {
              orderId: pos.orderId,
              marketId: pos.tokenId,
              side: 'sell',
              fillPrice: String(currentMid),
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

    for (let i = toRemove.length - 1; i >= 0; i--) {
      positions.splice(toRemove[i], 1);
    }
  }

  // ── Entry logic ────────────────────────────────────────────────────────

  async function scanEntries(): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    const markets = await gamma.getTrending(10);

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;

      if (!market.yesTokenId || market.closed || market.resolved || !market.active) continue;

      const yesTokenId = market.yesTokenId;
      if (hasPositionFor(yesTokenId)) continue;
      if (market.noTokenId && hasPositionFor(market.noTokenId)) continue;
      if (isOnCooldown(yesTokenId)) continue;
      if (market.noTokenId && isOnCooldown(market.noTokenId)) continue;

      // Fetch order book
      let mid: number;
      let volume: number;
      try {
        const book = await clob.getOrderBook(yesTokenId);
        mid = bestMid(book);
        volume = estimateVolume(book);
        if (mid <= 0 || mid >= 1) continue;
        recordTick(yesTokenId, mid, volume);
      } catch {
        continue;
      }

      // Get price history
      const ticks = priceHistory.get(yesTokenId);
      if (!ticks || ticks.length < cfg.momentumWindow) continue;

      // Calculate returns and momentum
      const returns = tickReturns(ticks);
      const momentum = calcMomentum(returns, cfg.momentumWindow);
      const acceleration = calcAcceleration(returns, cfg.momentumWindow, cfg.accelerationWindow);

      // Check exhaustion
      if (!isExhausted(momentum, acceleration, cfg.momentumThreshold)) continue;

      // Determine trend direction for volume divergence check
      const trendDirection: 'up' | 'down' = momentum > 0 ? 'up' : 'down';

      // Check volume divergence
      if (!hasVolumeDivergence(ticks, cfg.volumeDeclineRatio, trendDirection)) continue;

      // Direction: exhausted uptrend → BUY NO, exhausted downtrend → BUY YES
      const side: 'yes' | 'no' = momentum > 0 ? 'no' : 'yes';
      const entryTokenId = side === 'yes' ? yesTokenId : (market.noTokenId ?? yesTokenId);

      let entryPrice: number;
      try {
        const book = await clob.getOrderBook(entryTokenId);
        entryPrice = bestAsk(book);
      } catch {
        continue;
      }

      const posSize = kellySizer
        ? kellySizer.getSize(STRATEGY_NAME).size
        : parseFloat(cfg.positionSize);

      try {
        const order = await orderManager.placeOrder({
          tokenId: entryTokenId,
          side: 'buy',
          price: entryPrice.toFixed(4),
          size: String(Math.round(posSize / entryPrice)),
          orderType: 'GTC',
        });

        positions.push({
          tokenId: entryTokenId,
          conditionId: market.conditionId,
          side,
          entryPrice,
          sizeUsdc: posSize,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry momentum-exhaustion', STRATEGY_NAME, {
          tokenId: entryTokenId,
          side,
          entryPrice: entryPrice.toFixed(4),
          momentum: momentum.toFixed(4),
          acceleration: acceleration.toFixed(4),
          trendDirection,
          size: posSize,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: order.id,
            marketId: entryTokenId,
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
          tokenId: entryTokenId,
          err: String(err),
        });
      }
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function momentumExhaustionTick(): Promise<void> {
    try {
      await checkExits();
      await scanEntries();

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
