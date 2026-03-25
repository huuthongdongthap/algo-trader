/**
 * Expiry Theta Decay strategy for Polymarket binary markets.
 *
 * As prediction markets approach their resolution date, prices converge toward
 * 0 or 1. Markets trading between 0.30–0.70 experience "theta decay" — the
 * uncertainty premium erodes over time. This strategy sells overpriced
 * uncertainty by:
 *   - Buying YES when price > 0.55 and time decay favors convergence to 1
 *   - Buying NO  when price < 0.45 and time decay favors convergence to 0
 *
 * Signal:
 *   theta = priceDistance_from_edge / sqrt(daysToExpiry)
 *   Higher theta → more decay opportunity.  Entry when theta accelerates
 *   and the market is within the target expiry window.
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface ExpiryThetaDecayConfig {
  /** Minimum theta value to consider entry */
  thetaThreshold: number;
  /** Maximum days to expiry to consider a market */
  maxDaysToExpiry: number;
  /** Minimum days to expiry — avoid resolution-day chaos */
  minDaysToExpiry: number;
  /** Lower bound of dead zone — too uncertain to trade */
  deadZoneLow: number;
  /** Upper bound of dead zone */
  deadZoneHigh: number;
  /** Number of theta readings to keep per token */
  thetaHistoryLen: number;
  /** Minimum 24h volume to consider a market */
  minVolume: number;
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
  /** Base position size (USDC string) */
  positionSize: string;
  /** Maximum position scale multiplier based on theta magnitude */
  maxPositionScale: number;
}

export const DEFAULT_CONFIG: ExpiryThetaDecayConfig = {
  thetaThreshold: 0.08,
  maxDaysToExpiry: 14,
  minDaysToExpiry: 1,
  deadZoneLow: 0.45,
  deadZoneHigh: 0.55,
  thetaHistoryLen: 30,
  minVolume: 5000,
  takeProfitPct: 0.05,
  stopLossPct: 0.03,
  maxHoldMs: 60 * 60_000,
  maxPositions: 5,
  cooldownMs: 300_000,
  positionSize: '12',
  maxPositionScale: 2.0,
};

const STRATEGY_NAME: StrategyName = 'expiry-theta-decay';

// ── Internal types ───────────────────────────────────────────────────────────

interface ThetaTick {
  theta: number;
  timestamp: number;
}

interface ThetaPosition {
  conditionId: string;
  tokenId: string;
  side: 'yes' | 'no';
  qty: number;
  entryPrice: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Calculate days remaining until market end date. */
export function calcDaysToExpiry(endDate: string, now: number = Date.now()): number {
  const end = new Date(endDate).getTime();
  if (isNaN(end)) return Infinity;
  return (end - now) / 86_400_000;
}

/**
 * Calculate theta: how much decay opportunity exists.
 * theta = priceDistance_from_edge / sqrt(daysToExpiry)
 *
 * For price > 0.5, distance_from_edge = price (distance from 0 → 1 resolution).
 * For price < 0.5, distance_from_edge = 1 - price (distance from 1 → 0 resolution).
 */
export function calcTheta(price: number, daysToExpiry: number): number {
  if (daysToExpiry <= 0) return Infinity;
  const distanceFromEdge = price > 0.5 ? price : 1 - price;
  return distanceFromEdge / Math.sqrt(daysToExpiry);
}

/** Check if price is in the dead zone (too uncertain to trade). */
export function isInDeadZone(price: number, low: number, high: number): boolean {
  return price >= low && price <= high;
}

/**
 * Determine trade direction.
 * Returns 'yes' if price > deadZoneHigh (betting on resolve to 1),
 * 'no' if price < deadZoneLow (betting on resolve to 0),
 * null if in dead zone.
 */
export function getDirection(
  price: number,
  deadZoneLow: number,
  deadZoneHigh: number,
): 'yes' | 'no' | null {
  if (price > deadZoneHigh) return 'yes';
  if (price < deadZoneLow) return 'no';
  return null;
}

/**
 * Detect theta acceleration: is theta increasing over recent history?
 * Returns true if the latest theta is higher than the average of the
 * earlier readings (simple acceleration check).
 */
export function isThetaAccelerating(history: ThetaTick[]): boolean {
  if (history.length < 3) return false;
  const recent = history[history.length - 1].theta;
  // Average of all but the last reading
  const earlier = history.slice(0, -1);
  const avg = earlier.reduce((s, t) => s + t.theta, 0) / earlier.length;
  return recent > avg;
}

/**
 * Scale position size based on theta magnitude.
 * Higher theta → larger size, capped at maxScale * base.
 */
export function scalePositionSize(
  baseSize: number,
  theta: number,
  thetaThreshold: number,
  maxScale: number,
): number {
  if (theta <= thetaThreshold) return baseSize;
  const scale = Math.min(theta / thetaThreshold, maxScale);
  return baseSize * scale;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface ExpiryThetaDecayDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<ExpiryThetaDecayConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createExpiryThetaDecayTick(deps: ExpiryThetaDecayDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: ExpiryThetaDecayConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const thetaHistory = new Map<string, ThetaTick[]>();
  const positions: ThetaPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTheta(tokenId: string, theta: number): void {
    let history = thetaHistory.get(tokenId);
    if (!history) {
      history = [];
      thetaHistory.set(tokenId, history);
    }
    history.push({ theta, timestamp: Date.now() });
    if (history.length > cfg.thetaHistoryLen) {
      history.splice(0, history.length - cfg.thetaHistoryLen);
    }
  }

  function getHistory(tokenId: string): ThetaTick[] {
    return thetaHistory.get(tokenId) ?? [];
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
          side: pos.side,
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
    if (positions.length >= cfg.maxPositions) return;

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || !market.noTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.conditionId)) continue;
      if (isOnCooldown(market.conditionId)) continue;

      // Check volume
      if ((market.volume24h ?? 0) < cfg.minVolume) continue;

      // Check days to expiry
      const daysToExpiry = calcDaysToExpiry(market.endDate);
      if (daysToExpiry > cfg.maxDaysToExpiry || daysToExpiry < cfg.minDaysToExpiry) continue;

      try {
        const yesBook = await clob.getOrderBook(market.yesTokenId);
        const yesBa = bestBidAsk(yesBook);
        if (yesBa.mid <= 0 || yesBa.mid >= 1) continue;

        // Dead zone check
        if (isInDeadZone(yesBa.mid, cfg.deadZoneLow, cfg.deadZoneHigh)) continue;

        // Compute and record theta
        const theta = calcTheta(yesBa.mid, daysToExpiry);
        recordTheta(market.yesTokenId, theta);

        // Check theta threshold
        if (theta < cfg.thetaThreshold) continue;

        // Check theta acceleration
        const history = getHistory(market.yesTokenId);
        if (!isThetaAccelerating(history)) continue;

        // Determine direction
        const direction = getDirection(yesBa.mid, cfg.deadZoneLow, cfg.deadZoneHigh);
        if (!direction) continue;

        // Scale position size
        const baseSize = parseFloat(cfg.positionSize);
        const scaledSize = scalePositionSize(baseSize, theta, cfg.thetaThreshold, cfg.maxPositionScale);

        const tokenId = direction === 'yes' ? market.yesTokenId : market.noTokenId;
        const price = direction === 'yes' ? yesBa.ask : 1 - yesBa.bid;
        const qty = scaledSize / price;

        const order = await orderManager.placeOrder({
          tokenId,
          side: 'buy',
          price: price.toFixed(4),
          size: String(Math.round(qty)),
          orderType: 'GTC',
        });

        positions.push({
          conditionId: market.conditionId,
          tokenId,
          side: direction,
          qty,
          entryPrice: price,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          direction,
          theta: theta.toFixed(6),
          daysToExpiry: daysToExpiry.toFixed(2),
          price: price.toFixed(4),
          scaledSize: scaledSize.toFixed(2),
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: order.id,
            marketId: market.conditionId,
            side: 'buy',
            fillPrice: String(price),
            fillSize: String(scaledSize),
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

  return async function expiryThetaDecayTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(20);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: thetaHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
