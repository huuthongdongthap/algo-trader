/**
 * Regime-Adaptive Momentum strategy for Polymarket binary markets.
 *
 * The first strategy to leverage market regime detection. Adapts momentum
 * trading behavior based on the current market regime (trending, ranging,
 * volatile).
 *
 * Regime detection (ADX-inspired):
 *   trendStrength = |SMA_short - SMA_long| / ATR_long
 *   If trendStrength > 1.5 → trending
 *   If ATR_short / ATR_long > 2.0 → volatile
 *   Otherwise → ranging
 *
 * Entry signals per regime:
 *   Trending:  Momentum pullback entry (bottom 30% of range, above SMA_long)
 *   Ranging:   Mean reversion via OBI (order book imbalance)
 *   Volatile:  Strict pullback (trendStrength > 2.0, bottom 20%)
 *
 * Exit conditions:
 *   Take-profit / stop-loss (regime-dependent)
 *   Max hold time (8 min)
 *   Regime shift exit: if regime changes AND trend reverses against position
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface RegimeAdaptiveMomentumConfig {
  shortWindow: number;
  longWindow: number;
  trendThreshold: number;
  volatileAtrRatio: number;
  trendingPullbackPct: number;
  volatilePullbackPct: number;
  obiEntryThreshold: number;
  baseSizeUsdc: number;
  maxPositions: number;
  trendingTpPct: number;
  rangingTpPct: number;
  volatileTpPct: number;
  stopLossPct: number;
  maxHoldMs: number;
  cooldownMs: number;
  scanLimit: number;
}

const DEFAULT_CONFIG: RegimeAdaptiveMomentumConfig = {
  shortWindow: 10,
  longWindow: 30,
  trendThreshold: 1.5,
  volatileAtrRatio: 2.0,
  trendingPullbackPct: 0.30,
  volatilePullbackPct: 0.20,
  obiEntryThreshold: 2.0,
  baseSizeUsdc: 25,
  maxPositions: 3,
  trendingTpPct: 0.05,
  rangingTpPct: 0.03,
  volatileTpPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 8 * 60_000,
  cooldownMs: 120_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'regime-adaptive-momentum';

// ── Internal types ───────────────────────────────────────────────────────────

type Regime = 'trending' | 'ranging' | 'volatile';

interface PriceTick {
  price: number;
  timestamp: number;
}

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
  entryRegime: Regime;
  trendDir: 'up' | 'down';
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Simple moving average. Returns 0 for empty array. */
export function calcSMA(prices: number[]): number {
  if (prices.length === 0) return 0;
  return prices.reduce((s, p) => s + p, 0) / prices.length;
}

/**
 * Compute Average True Range: average |price[i] - price[i-1]| over the prices.
 * Returns 0 if fewer than 2 prices.
 */
function calcATR(prices: number[]): number {
  if (prices.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < prices.length; i++) {
    sum += Math.abs(prices[i] - prices[i - 1]);
  }
  return sum / (prices.length - 1);
}

/**
 * Detect market regime based on short and long price arrays.
 *   trendStrength = |SMA_short - SMA_long| / ATR_long
 *   If trendStrength > 1.5 → trending
 *   If ATR_short / ATR_long > 2.0 → volatile
 *   Otherwise → ranging
 */
export function detectRegime(
  shortPrices: number[],
  longPrices: number[],
  trendThreshold = 1.5,
  volatileAtrRatio = 2.0,
): Regime {
  if (shortPrices.length < 2 || longPrices.length < 2) return 'ranging';

  const smaShort = calcSMA(shortPrices);
  const smaLong = calcSMA(longPrices);
  const atrLong = calcATR(longPrices);
  const atrShort = calcATR(shortPrices);

  if (atrLong <= 0) return 'ranging';

  const trendStrength = Math.abs(smaShort - smaLong) / atrLong;
  if (trendStrength > trendThreshold) return 'trending';

  if (atrShort / atrLong > volatileAtrRatio) return 'volatile';

  return 'ranging';
}

/**
 * Pullback depth: where the current price sits within the recent range.
 * Returns 0 = at bottom, 1 = at top. Returns 0.5 if range is 0.
 */
export function calcPullbackDepth(prices: number[], current: number): number {
  if (prices.length === 0) return 0.5;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max === min) return 0.5;
  return (current - min) / (max - min);
}

/**
 * Order Book Imbalance: bid_volume / ask_volume.
 * Returns 1.0 if either side is empty.
 */
export function calcOBI(book: RawOrderBook): number {
  let bidVol = 0;
  let askVol = 0;
  for (const b of book.bids) bidVol += parseFloat(b.size);
  for (const a of book.asks) askVol += parseFloat(a.size);
  if (askVol <= 0 || bidVol <= 0) return 1.0;
  return bidVol / askVol;
}

/** Determine trend direction from short and long SMAs. */
export function calcTrendDirection(shortSMA: number, longSMA: number): 'up' | 'down' {
  return shortSMA >= longSMA ? 'up' : 'down';
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface RegimeAdaptiveMomentumDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<RegimeAdaptiveMomentumConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createRegimeAdaptiveMomentumTick(deps: RegimeAdaptiveMomentumDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: RegimeAdaptiveMomentumConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, PriceTick[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: Date.now() });
    const maxTicks = cfg.longWindow * 3;
    if (history.length > maxTicks) {
      history.splice(0, history.length - maxTicks);
    }
  }

  function getPrices(tokenId: string, count: number): number[] {
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

  function getTpPct(regime: Regime): number {
    if (regime === 'trending') return cfg.trendingTpPct;
    if (regime === 'volatile') return cfg.volatileTpPct;
    return cfg.rangingTpPct;
  }

  function getSizeMultiplier(regime: Regime): number {
    if (regime === 'trending') return 1.2;
    if (regime === 'volatile') return 0.5;
    return 0.9;
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

      const tpPct = getTpPct(pos.entryRegime);

      // Take profit / Stop loss
      if (pos.side === 'yes') {
        const gain = (currentPrice - pos.entryPrice) / pos.entryPrice;
        if (gain >= tpPct) {
          shouldExit = true;
          reason = `take-profit (${(gain * 100).toFixed(2)}%)`;
        } else if (-gain >= cfg.stopLossPct) {
          shouldExit = true;
          reason = `stop-loss (${(gain * 100).toFixed(2)}%)`;
        }
      } else {
        const gain = (pos.entryPrice - currentPrice) / pos.entryPrice;
        if (gain >= tpPct) {
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

      // Regime shift exit: if regime changed AND trend reversed against position
      if (!shouldExit) {
        const shortP = getPrices(pos.tokenId, cfg.shortWindow);
        const longP = getPrices(pos.tokenId, cfg.longWindow);
        if (shortP.length >= 2 && longP.length >= 2) {
          const currentRegime = detectRegime(shortP, longP, cfg.trendThreshold, cfg.volatileAtrRatio);
          const smaShort = calcSMA(shortP);
          const smaLong = calcSMA(longP);
          const currentDir = calcTrendDirection(smaShort, smaLong);

          if (currentRegime !== pos.entryRegime) {
            const againstPosition =
              (pos.side === 'yes' && currentDir === 'down') ||
              (pos.side === 'no' && currentDir === 'up');
            if (againstPosition) {
              shouldExit = true;
              reason = `regime shift (${pos.entryRegime} → ${currentRegime}) + trend reversal`;
            }
          }
        }
      }

      if (shouldExit) {
        try {
          const exitSide = pos.side === 'yes' ? 'sell' : 'buy';
          await orderManager.placeOrder({
            tokenId: pos.tokenId,
            side: exitSide,
            price: currentPrice.toFixed(4),
            size: String(Math.max(1, Math.round(pos.sizeUsdc / currentPrice))),
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

        const shortPrices = getPrices(market.yesTokenId, cfg.shortWindow);
        const longPrices = getPrices(market.yesTokenId, cfg.longWindow);

        if (shortPrices.length < cfg.shortWindow) continue;
        if (longPrices.length < cfg.longWindow) continue;

        const regime = detectRegime(shortPrices, longPrices, cfg.trendThreshold, cfg.volatileAtrRatio);
        const smaShort = calcSMA(shortPrices);
        const smaLong = calcSMA(longPrices);
        const trendDir = calcTrendDirection(smaShort, smaLong);
        const currentPrice = ba.mid;

        let side: 'yes' | 'no' | null = null;

        if (regime === 'trending') {
          // Momentum pullback: price in bottom 30% of recent short range but above SMA_long
          const depth = calcPullbackDepth(shortPrices, currentPrice);
          if (depth <= cfg.trendingPullbackPct && currentPrice > smaLong) {
            side = trendDir === 'up' ? 'yes' : 'no';
          }
        } else if (regime === 'ranging') {
          // Mean reversion via OBI
          const obi = calcOBI(book);
          if (obi > cfg.obiEntryThreshold) {
            side = 'yes';
          } else if (obi < 1 / cfg.obiEntryThreshold) {
            side = 'no';
          }
        } else if (regime === 'volatile') {
          // Strict pullback: need stronger trend + deeper pullback
          const atrLong = calcATR(longPrices);
          const trendStrength = atrLong > 0 ? Math.abs(smaShort - smaLong) / atrLong : 0;
          if (trendStrength > 2.0) {
            const depth = calcPullbackDepth(shortPrices, currentPrice);
            if (depth <= cfg.volatilePullbackPct && currentPrice > smaLong) {
              side = trendDir === 'up' ? 'yes' : 'no';
            }
          }
        }

        if (!side) continue;
        if (side === 'no' && !market.noTokenId) continue; // skip if no NO token

        const tokenId = side === 'yes'
          ? market.yesTokenId
          : market.noTokenId!;
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);
        const sizeMultiplier = getSizeMultiplier(regime);
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
          entryRegime: regime,
          trendDir,
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          regime,
          trendDir,
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

  return async function regimeAdaptiveMomentumTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

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
