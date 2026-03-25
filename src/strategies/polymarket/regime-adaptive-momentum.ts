/**
 * Regime-Adaptive Momentum strategy for Polymarket binary markets.
 *
 * Integrates the MarketRegimeDetector (ADX + ATR) with multi-timeframe
 * momentum and pullback detection to adapt entry/exit logic per regime:
 *
 *   trending-up:   buy YES on pullback (RSI dip in uptrend)
 *   trending-down:  buy NO on pullback (RSI spike in downtrend)
 *   ranging:        fall back to OBI + z-score mean reversion
 *   volatile:       reduced size, only high-confidence pullbacks
 *   unknown:        skip (insufficient data)
 *
 * Multi-timeframe confluence:
 *   m5  = 5-tick momentum   (short-term)
 *   m15 = 15-tick momentum  (medium-term)
 *   m30 = 30-tick momentum  (longer-term bias)
 *   RSI(7) on last 14 ticks for pullback detection
 */
import type { ClobClient, RawOrderBook, OrderBookLevel } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { MarketRegimeDetector, type MarketRegime } from '../../trading-room/market-regime-detector.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface RegimeAdaptiveConfig {
  /** Min price ticks needed before regime detection (ADX needs 29+) */
  minPriceTicks: number;
  /** RSI period for pullback detection */
  rsiPeriod: number;
  /** RSI oversold threshold (pullback in uptrend) */
  rsiOversold: number;
  /** RSI overbought threshold (pullback in downtrend) */
  rsiOverbought: number;
  /** Min 15-tick momentum magnitude for trend confirmation */
  minTrendMomentum: number;
  /** OBI threshold for ranging regime fallback */
  obiThreshold: number;
  /** Z-score threshold for ranging regime fallback */
  zScoreThreshold: number;
  /** OBI depth levels for ranging fallback */
  obiDepthLevels: number;
  /** Base trade size in USDC */
  sizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Base take-profit (scaled per regime) */
  takeProfitPct: number;
  /** Base stop-loss (scaled per regime) */
  stopLossPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: RegimeAdaptiveConfig = {
  minPriceTicks: 30,
  rsiPeriod: 7,
  rsiOversold: 35,
  rsiOverbought: 65,
  minTrendMomentum: 0.02,
  obiThreshold: 0.3,
  zScoreThreshold: 1.5,
  obiDepthLevels: 5,
  sizeUsdc: 30,
  maxPositions: 5,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 12 * 60_000,
  cooldownMs: 90_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'regime-adaptive-momentum';

// ── Internal types ───────────────────────────────────────────────────────────

interface PriceTick {
  price: number;
  timestamp: number;
}

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  entryRegime: MarketRegime;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
  takeProfitPct: number;
  stopLossPct: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Compute RSI (Relative Strength Index) from price array. */
export function calcRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50; // neutral default

  let avgGain = 0;
  let avgLoss = 0;

  // Initial averages
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed averages
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/** Compute momentum as fractional price change over n ticks. */
export function calcMomentum(prices: number[], lookback: number): number {
  if (prices.length < lookback + 1) return 0;
  const old = prices[prices.length - 1 - lookback];
  const current = prices[prices.length - 1];
  if (old === 0) return 0;
  return (current - old) / old;
}

/** Compute OBI from raw orderbook. */
export function calcOBI(book: RawOrderBook, depthLevels: number): number {
  const sumVolume = (levels: OrderBookLevel[], n: number): number => {
    let total = 0;
    const limit = Math.min(n, levels.length);
    for (let i = 0; i < limit; i++) total += parseFloat(levels[i].size);
    return total;
  };
  const bidVol = sumVolume(book.bids, depthLevels);
  const askVol = sumVolume(book.asks, depthLevels);
  const total = bidVol + askVol;
  if (total === 0) return 0;
  return (bidVol - askVol) / total;
}

/** Compute z-score of latest price vs rolling window. */
export function calcZScore(prices: number[]): number {
  if (prices.length < 3) return 0;
  const n = prices.length;
  const mean = prices.reduce((s, p) => s + p, 0) / n;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (prices[n - 1] - mean) / std;
}

/** Detect pullback: short-term counter-move within a longer trend. */
export function detectPullback(
  rsi: number,
  m15: number,
  rsiOversold: number,
  rsiOverbought: number,
  minMomentum: number,
): 'bullish-pullback' | 'bearish-pullback' | 'none' {
  // Uptrend (m15 positive) + RSI oversold → bullish pullback (buy dip)
  if (m15 > minMomentum && rsi < rsiOversold) return 'bullish-pullback';
  // Downtrend (m15 negative) + RSI overbought → bearish pullback (sell rip)
  if (m15 < -minMomentum && rsi > rsiOverbought) return 'bearish-pullback';
  return 'none';
}

/** Get regime-specific position size multiplier and TP/SL scaling. */
export function getRegimeParams(regime: MarketRegime, baseTP: number, baseSL: number): {
  sizeMultiplier: number;
  takeProfitPct: number;
  stopLossPct: number;
} {
  switch (regime) {
    case 'trending-up':
    case 'trending-down':
      return { sizeMultiplier: 1.2, takeProfitPct: baseTP * 1.3, stopLossPct: baseSL };
    case 'ranging':
      return { sizeMultiplier: 0.9, takeProfitPct: baseTP * 0.8, stopLossPct: baseSL * 0.8 };
    case 'volatile':
      return { sizeMultiplier: 0.5, takeProfitPct: baseTP * 0.7, stopLossPct: baseSL * 1.3 };
    default:
      return { sizeMultiplier: 0, takeProfitPct: baseTP, stopLossPct: baseSL };
  }
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface RegimeAdaptiveDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<RegimeAdaptiveConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createRegimeAdaptiveMomentumTick(deps: RegimeAdaptiveDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: RegimeAdaptiveConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const detector = new MarketRegimeDetector();

  // Per-market state
  const priceHistory = new Map<string, PriceTick[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordPrice(tokenId: string, price: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: Date.now() });
    if (history.length > cfg.minPriceTicks * 3) {
      history.splice(0, history.length - cfg.minPriceTicks * 3);
    }
  }

  function getPrices(tokenId: string): number[] {
    return (priceHistory.get(tokenId) ?? []).map(t => t.price);
  }

  function isOnCooldown(tokenId: string): boolean {
    return Date.now() < (cooldowns.get(tokenId) ?? 0);
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
        currentPrice = bestBidAsk(book).mid;
        recordPrice(pos.tokenId, currentPrice);
      } catch {
        continue;
      }

      // TP / SL (using per-position regime-scaled thresholds)
      if (pos.side === 'yes') {
        const gain = (currentPrice - pos.entryPrice) / pos.entryPrice;
        if (gain >= pos.takeProfitPct) {
          shouldExit = true;
          reason = `take-profit (${(gain * 100).toFixed(2)}%)`;
        } else if (-gain >= pos.stopLossPct) {
          shouldExit = true;
          reason = `stop-loss (${(gain * 100).toFixed(2)}%)`;
        }
      } else {
        const gain = (pos.entryPrice - currentPrice) / pos.entryPrice;
        if (gain >= pos.takeProfitPct) {
          shouldExit = true;
          reason = `take-profit (${(gain * 100).toFixed(2)}%)`;
        } else if (-gain >= pos.stopLossPct) {
          shouldExit = true;
          reason = `stop-loss (${(gain * 100).toFixed(2)}%)`;
        }
      }

      // Regime shift exit: if regime changed to opposite direction
      if (!shouldExit) {
        const prices = getPrices(pos.tokenId);
        if (prices.length >= cfg.minPriceTicks) {
          const regime = detector.detectRegime(prices);
          if (pos.side === 'yes' && regime.regime === 'trending-down') {
            shouldExit = true;
            reason = `regime shift (${pos.entryRegime} → ${regime.regime})`;
          } else if (pos.side === 'no' && regime.regime === 'trending-up') {
            shouldExit = true;
            reason = `regime shift (${pos.entryRegime} → ${regime.regime})`;
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
            regime: pos.entryRegime,
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

        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);
        if (prices.length < cfg.minPriceTicks) continue;

        // Detect regime
        const regime = detector.detectRegime(prices);
        if (regime.regime === 'unknown') continue;

        // Compute signals
        const rsi = calcRSI(prices, cfg.rsiPeriod);
        const m5 = calcMomentum(prices, 5);
        const m15 = calcMomentum(prices, 15);

        // Get regime-specific parameters
        const regimeParams = getRegimeParams(regime.regime, cfg.takeProfitPct, cfg.stopLossPct);
        if (regimeParams.sizeMultiplier === 0) continue; // unknown → skip

        let side: 'yes' | 'no' | null = null;

        if (regime.regime === 'trending-up' || regime.regime === 'trending-down') {
          // Momentum + pullback confluence
          const pullback = detectPullback(rsi, m15, cfg.rsiOversold, cfg.rsiOverbought, cfg.minTrendMomentum);

          if (pullback === 'bullish-pullback' && m5 > -0.005) {
            // Uptrend pullback with short-term stabilization → buy YES
            side = 'yes';
          } else if (pullback === 'bearish-pullback' && m5 < 0.005) {
            // Downtrend pullback with short-term stabilization → buy NO
            side = 'no';
          }
        } else if (regime.regime === 'ranging') {
          // Mean reversion fallback: OBI + z-score
          const obi = calcOBI(book, cfg.obiDepthLevels);
          const z = calcZScore(prices.slice(-20));

          if (z < -cfg.zScoreThreshold && obi > cfg.obiThreshold) {
            side = 'yes';
          } else if (z > cfg.zScoreThreshold && obi < -cfg.obiThreshold) {
            side = 'no';
          }
        } else if (regime.regime === 'volatile') {
          // Only high-confidence pullbacks in volatile markets
          const pullback = detectPullback(rsi, m15, cfg.rsiOversold - 10, cfg.rsiOverbought + 10, cfg.minTrendMomentum * 2);

          if (pullback === 'bullish-pullback') side = 'yes';
          else if (pullback === 'bearish-pullback') side = 'no';
        }

        if (!side) continue;

        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

        const baseSize = kellySizer
          ? kellySizer.getSize(STRATEGY_NAME).size
          : cfg.sizeUsdc;
        const posSize = baseSize * regimeParams.sizeMultiplier;

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
          entryRegime: regime.regime,
          sizeUsdc: posSize,
          orderId: order.id,
          openedAt: Date.now(),
          takeProfitPct: regimeParams.takeProfitPct,
          stopLossPct: regimeParams.stopLossPct,
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          regime: regime.regime,
          adx: regime.adx.toFixed(1),
          rsi: rsi.toFixed(1),
          m5: m5.toFixed(4),
          m15: m15.toFixed(4),
          entryPrice: entryPrice.toFixed(4),
          size: posSize.toFixed(2),
          tp: regimeParams.takeProfitPct.toFixed(4),
          sl: regimeParams.stopLossPct.toFixed(4),
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
