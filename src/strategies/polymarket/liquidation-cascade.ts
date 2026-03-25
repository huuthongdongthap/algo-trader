/**
 * Liquidation Cascade Detector strategy for Polymarket binary markets.
 *
 * Detects cascading liquidation patterns where rapid price drops trigger
 * stop-losses, causing further drops. Trades the bounce after cascade
 * exhaustion.
 *
 * Signal logic:
 *   Track consecutive price drops across ticks.
 *   cascadeScore = count consecutive drops where each drop > minDropPct (0.5%)
 *   Cascade confirmed when cascadeScore >= minCascadeSteps (3) within cascadeWindowMs (30s)
 *
 *   Exhaustion: after cascade detected, wait for first price stabilization or uptick.
 *   exhaustionSignal = price stops dropping AND cascade magnitude > minCascadeMagnitude (3%)
 *
 *   Entry: contrarian bounce trade opposite to cascade direction.
 *   Exit: take-profit 2.5%, stop-loss 1.5%, max hold 5 min, cascade continuation 1%.
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface LiquidationCascadeConfig {
  /** Minimum drop per step as fraction (0.5%) */
  minDropPct: number;
  /** Minimum consecutive cascade steps */
  minCascadeSteps: number;
  /** Time window for cascade detection (ms) */
  cascadeWindowMs: number;
  /** Minimum total cascade magnitude as fraction (3%) */
  minCascadeMagnitude: number;
  /** Base trade size in USDC */
  baseSizeUsdc: number;
  /** Max size multiplier based on cascade magnitude */
  maxSizeMultiplier: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction */
  takeProfitPct: number;
  /** Stop-loss as fraction */
  stopLossPct: number;
  /** Cascade continuation exit threshold as fraction */
  continuationExitPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: LiquidationCascadeConfig = {
  minDropPct: 0.005,
  minCascadeSteps: 3,
  cascadeWindowMs: 30_000,
  minCascadeMagnitude: 0.03,
  baseSizeUsdc: 20,
  maxSizeMultiplier: 2.0,
  maxPositions: 2,
  takeProfitPct: 0.025,
  stopLossPct: 0.015,
  continuationExitPct: 0.01,
  maxHoldMs: 5 * 60_000,
  cooldownMs: 180_000,
  scanLimit: 20,
};

const STRATEGY_NAME: StrategyName = 'liquidation-cascade';

// ── Internal types ───────────────────────────────────────────────────────────

export interface CascadeResult {
  direction: 'down' | 'up';
  magnitude: number;
  steps: number;
  startPrice: number;
}

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
  cascadeDirection: 'down' | 'up';
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Detect a cascade pattern in price history.
 * Returns a CascadeResult if a cascade is found, or null.
 */
export function detectCascade(
  priceHistory: { price: number; timestamp: number }[],
  minDropPct: number,
  minSteps: number,
  windowMs: number,
): CascadeResult | null {
  if (priceHistory.length < 2) return null;

  const now = priceHistory[priceHistory.length - 1].timestamp;
  const windowStart = now - windowMs;

  // Filter to ticks within window
  const inWindow = priceHistory.filter(t => t.timestamp >= windowStart);
  if (inWindow.length < 2) return null;

  // Check for downward cascade (consecutive drops)
  let downSteps = 0;
  let downMagnitude = 0;
  let downStartPrice = 0;
  let currentDownStreak = 0;
  let currentDownMag = 0;
  let currentDownStart = 0;

  for (let i = 1; i < inWindow.length; i++) {
    const prev = inWindow[i - 1].price;
    const curr = inWindow[i].price;
    if (prev <= 0) continue;
    const dropPct = (prev - curr) / prev;

    if (dropPct >= minDropPct) {
      if (currentDownStreak === 0) {
        currentDownStart = prev;
      }
      currentDownStreak++;
      currentDownMag += dropPct;
    } else {
      if (currentDownStreak > downSteps) {
        downSteps = currentDownStreak;
        downMagnitude = currentDownMag;
        downStartPrice = currentDownStart;
      }
      currentDownStreak = 0;
      currentDownMag = 0;
      currentDownStart = 0;
    }
  }
  // Check trailing streak
  if (currentDownStreak > downSteps) {
    downSteps = currentDownStreak;
    downMagnitude = currentDownMag;
    downStartPrice = currentDownStart;
  }

  // Check for upward cascade (consecutive rises)
  let upSteps = 0;
  let upMagnitude = 0;
  let upStartPrice = 0;
  let currentUpStreak = 0;
  let currentUpMag = 0;
  let currentUpStart = 0;

  for (let i = 1; i < inWindow.length; i++) {
    const prev = inWindow[i - 1].price;
    const curr = inWindow[i].price;
    if (prev <= 0) continue;
    const risePct = (curr - prev) / prev;

    if (risePct >= minDropPct) {
      if (currentUpStreak === 0) {
        currentUpStart = prev;
      }
      currentUpStreak++;
      currentUpMag += risePct;
    } else {
      if (currentUpStreak > upSteps) {
        upSteps = currentUpStreak;
        upMagnitude = currentUpMag;
        upStartPrice = currentUpStart;
      }
      currentUpStreak = 0;
      currentUpMag = 0;
      currentUpStart = 0;
    }
  }
  if (currentUpStreak > upSteps) {
    upSteps = currentUpStreak;
    upMagnitude = currentUpMag;
    upStartPrice = currentUpStart;
  }

  // Return the strongest cascade that meets requirements
  if (downSteps >= minSteps && downSteps >= upSteps) {
    return { direction: 'down', magnitude: downMagnitude, steps: downSteps, startPrice: downStartPrice };
  }
  if (upSteps >= minSteps) {
    return { direction: 'up', magnitude: upMagnitude, steps: upSteps, startPrice: upStartPrice };
  }

  return null;
}

/**
 * Detect whether a cascade has exhausted (price stabilized or reversed).
 * Requires at least 2 prices. Returns true if the last price stopped moving
 * in the cascade direction.
 */
export function detectExhaustion(prices: number[], cascadeDirection: 'down' | 'up'): boolean {
  if (prices.length < 2) return false;

  const last = prices[prices.length - 1];
  const prev = prices[prices.length - 2];

  if (cascadeDirection === 'down') {
    // Exhausted if price stopped dropping (current >= previous)
    return last >= prev;
  } else {
    // Exhausted if price stopped rising (current <= previous)
    return last <= prev;
  }
}

/**
 * Calculate position size multiplier based on cascade magnitude.
 * Larger cascades get larger positions.
 */
export function calcCascadeSizeMultiplier(
  magnitude: number,
  minMagnitude: number,
  maxMultiplier: number,
): number {
  if (minMagnitude <= 0) return 1;
  const raw = magnitude / minMagnitude;
  return Math.min(Math.max(raw, 1), maxMultiplier);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface LiquidationCascadeDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<LiquidationCascadeConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createLiquidationCascadeTick(deps: LiquidationCascadeDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: LiquidationCascadeConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, { price: number; timestamp: number }[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();
  // Track detected cascades awaiting exhaustion
  const activeCascades = new Map<string, CascadeResult>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number, timestamp?: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: timestamp ?? Date.now() });
    // Keep a bounded history
    const maxTicks = 200;
    if (history.length > maxTicks) {
      history.splice(0, history.length - maxTicks);
    }
  }

  function getHistory(tokenId: string): { price: number; timestamp: number }[] {
    return priceHistory.get(tokenId) ?? [];
  }

  function getRecentPrices(tokenId: string, count: number): number[] {
    const history = priceHistory.get(tokenId);
    if (!history) return [];
    return history.slice(-count).map(t => t.price);
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(tokenId: string): boolean {
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

      let currentPrice: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        const ba = bestBidAsk(book);
        currentPrice = ba.mid;
        recordTick(pos.tokenId, currentPrice);
      } catch {
        continue;
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

      // Cascade continuation exit
      if (!shouldExit) {
        if (pos.side === 'yes') {
          // Bought yes expecting bounce up; if price continues dropping
          const drop = (pos.entryPrice - currentPrice) / pos.entryPrice;
          if (drop > cfg.continuationExitPct) {
            shouldExit = true;
            reason = `cascade continuation (${(drop * 100).toFixed(2)}% further drop)`;
          }
        } else {
          // Bought no expecting bounce down; if price continues rising
          const rise = (currentPrice - pos.entryPrice) / pos.entryPrice;
          if (rise > cfg.continuationExitPct) {
            shouldExit = true;
            reason = `cascade continuation (${(rise * 100).toFixed(2)}% further rise)`;
          }
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
            price: currentPrice.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / currentPrice)),
            orderType: 'IOC',
          });

          const pnl = pos.side === 'yes'
            ? (currentPrice - pos.entryPrice) * (pos.sizeUsdc / pos.entryPrice)
            : (pos.entryPrice - currentPrice) * (pos.sizeUsdc / pos.entryPrice);

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

  // ── Entry logic ────────────────────────────────────────────────────────

  async function scanEntries(markets: GammaMarket[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.yesTokenId)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId)) continue;

      try {
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        recordTick(market.yesTokenId, ba.mid);

        const history = getHistory(market.yesTokenId);
        if (history.length < cfg.minCascadeSteps + 2) continue;

        // Check for active cascade
        const existingCascade = activeCascades.get(market.yesTokenId);

        if (!existingCascade) {
          // Try to detect a new cascade
          const cascade = detectCascade(history, cfg.minDropPct, cfg.minCascadeSteps, cfg.cascadeWindowMs);
          if (cascade && cascade.magnitude >= cfg.minCascadeMagnitude) {
            activeCascades.set(market.yesTokenId, cascade);
            logger.debug('Cascade detected', STRATEGY_NAME, {
              conditionId: market.conditionId,
              direction: cascade.direction,
              magnitude: (cascade.magnitude * 100).toFixed(2) + '%',
              steps: cascade.steps,
            });
          }
          continue; // Wait for exhaustion on next tick
        }

        // We have an active cascade — check for exhaustion
        const recentPrices = getRecentPrices(market.yesTokenId, 3);
        if (recentPrices.length < 2) continue;

        const exhausted = detectExhaustion(recentPrices, existingCascade.direction);

        if (!exhausted) {
          // Update cascade if it grew
          const newCascade = detectCascade(history, cfg.minDropPct, cfg.minCascadeSteps, cfg.cascadeWindowMs);
          if (newCascade && newCascade.steps > existingCascade.steps) {
            activeCascades.set(market.yesTokenId, newCascade);
          }
          continue;
        }

        // Exhaustion confirmed — check spread tightening as volume proxy
        const spread = ba.ask - ba.bid;
        const avgSpread = 0.04; // typical spread baseline
        const volumeOk = spread < avgSpread; // tighter spread = more volume

        // Clear cascade state regardless
        activeCascades.delete(market.yesTokenId);

        if (!volumeOk) continue;

        // Entry: contrarian bounce trade
        const side: 'yes' | 'no' = existingCascade.direction === 'down' ? 'yes' : 'no';
        const tokenId = side === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

        const sizeMultiplier = calcCascadeSizeMultiplier(
          existingCascade.magnitude,
          cfg.minCascadeMagnitude,
          cfg.maxSizeMultiplier,
        );
        const posSize = cfg.baseSizeUsdc * sizeMultiplier;

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
          cascadeDirection: existingCascade.direction,
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          cascadeDirection: existingCascade.direction,
          cascadeMagnitude: (existingCascade.magnitude * 100).toFixed(2) + '%',
          cascadeSteps: existingCascade.steps,
          sizeMultiplier: sizeMultiplier.toFixed(2),
          size: posSize,
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

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function liquidationCascadeTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
        activeCascades: activeCascades.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
