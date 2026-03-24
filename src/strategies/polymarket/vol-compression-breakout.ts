/**
 * Volatility Compression Breakout strategy for Polymarket binary markets.
 *
 * Detects when a market's realized volatility compresses to unusually low
 * levels (pre-breakout pattern), then trades the direction of the initial
 * breakout move. Markets in "coiled" low-vol states tend to produce
 * explosive moves.
 *
 * Signal logic:
 *   volShort  = realized vol (std dev of returns) over last 10 ticks
 *   volLong   = realized vol over last 40 ticks
 *   volRatio  = volShort / volLong
 *
 *   volRatio < compressionThreshold (0.4) → market is compressed
 *
 *   Once compressed, wait for price move > breakoutMultiplier × ATR
 *     ATR = average |price[i] - price[i-1]| over last 10 ticks
 *
 *   Direction: trade in breakout direction (momentum, not mean reversion)
 *     Price breaks UP  → BUY YES
 *     Price breaks DOWN → BUY NO
 *
 *   Confirmation: volume must be above median (not low-volume noise)
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface VolCompressionConfig {
  /** Ticks for short-term vol */
  shortVolWindow: number;
  /** Ticks for baseline vol */
  longVolWindow: number;
  /** volShort/volLong ratio trigger */
  compressionThreshold: number;
  /** Price move vs ATR to confirm breakout */
  breakoutMultiplier: number;
  /** ATR lookback period in ticks */
  atrPeriod: number;
  /** Trade size in USDC */
  sizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction (wider — breakouts run further) */
  takeProfitPct: number;
  /** Stop-loss as fraction (tight — false breakout protection) */
  stopLossPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: VolCompressionConfig = {
  shortVolWindow: 10,
  longVolWindow: 40,
  compressionThreshold: 0.4,
  breakoutMultiplier: 2.5,
  atrPeriod: 10,
  sizeUsdc: 30,
  maxPositions: 4,
  takeProfitPct: 0.035,
  stopLossPct: 0.015,
  maxHoldMs: 12 * 60_000,
  cooldownMs: 120_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'vol-compression-breakout';

// ── Internal types ───────────────────────────────────────────────────────────

interface PriceTick {
  price: number;
  timestamp: number;
}

interface CompressionEntry {
  compressed: boolean;
  compressedAt: number;
}

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
  /** Price at the time of entry, used for failed-breakout detection */
  compressionMid: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Compute realized volatility (standard deviation of returns) from raw prices.
 * Returns 0 if fewer than 2 prices.
 */
export function calcRealizedVol(prices: number[]): number {
  if (prices.length < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }

  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/**
 * Compute Average True Range: average |price[i] - price[i-1]| over the
 * last `period` ticks. Returns 0 if fewer than 2 prices.
 */
export function calcATR(prices: number[], period: number): number {
  if (prices.length < 2) return 0;

  const slice = prices.slice(-period - 1); // need period+1 prices for period diffs
  if (slice.length < 2) return 0;

  let sum = 0;
  const diffs = slice.length - 1;
  for (let i = 1; i < slice.length; i++) {
    sum += Math.abs(slice[i] - slice[i - 1]);
  }
  return sum / diffs;
}

/**
 * Detect whether volatility is compressed: short-term vol is unusually
 * low relative to longer-term baseline.
 */
export function detectCompression(volShort: number, volLong: number, threshold: number): boolean {
  if (volLong <= 0) return false;
  return (volShort / volLong) < threshold;
}

/**
 * Detect breakout direction. Checks if the latest price move (last tick
 * vs the mean of previous ticks) exceeds multiplier × ATR.
 * Returns 'up', 'down', or null.
 */
export function detectBreakout(
  prices: number[],
  atr: number,
  multiplier: number,
): 'up' | 'down' | null {
  if (prices.length < 2 || atr <= 0) return null;

  const last = prices[prices.length - 1];
  const prev = prices[prices.length - 2];
  const move = last - prev;

  if (move > multiplier * atr) return 'up';
  if (move < -(multiplier * atr)) return 'down';
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface VolCompressionDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<VolCompressionConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createVolCompressionBreakoutTick(deps: VolCompressionDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: VolCompressionConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, PriceTick[]>();
  const compressionState = new Map<string, CompressionEntry>();
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
    // Keep at most longVolWindow * 3 ticks
    const maxTicks = cfg.longVolWindow * 3;
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

      // Failed breakout: price reverses back into compression range within 2 min
      if (!shouldExit && (now - pos.openedAt) < 2 * 60_000) {
        const movedBack = pos.side === 'yes'
          ? currentPrice <= pos.compressionMid
          : currentPrice >= pos.compressionMid;
        if (movedBack) {
          shouldExit = true;
          reason = 'failed breakout (price reversed into compression range)';
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

        // Get price windows
        const shortPrices = getPrices(market.yesTokenId, cfg.shortVolWindow);
        const longPrices = getPrices(market.yesTokenId, cfg.longVolWindow);

        // Need enough history for both windows
        if (shortPrices.length < cfg.shortVolWindow) continue;
        if (longPrices.length < cfg.longVolWindow) continue;

        // Calculate volatility
        const volShort = calcRealizedVol(shortPrices);
        const volLong = calcRealizedVol(longPrices);

        // Check / update compression state
        const state = compressionState.get(market.yesTokenId);
        const isCompressed = detectCompression(volShort, volLong, cfg.compressionThreshold);

        if (isCompressed && (!state || !state.compressed)) {
          // Just entered compression
          compressionState.set(market.yesTokenId, { compressed: true, compressedAt: Date.now() });
          continue; // Wait for breakout on subsequent ticks
        }

        if (!isCompressed && state?.compressed) {
          // Exited compression — check for breakout
          const atrPrices = getPrices(market.yesTokenId, cfg.atrPeriod + 1);
          const atr = calcATR(atrPrices, cfg.atrPeriod);
          const breakoutPrices = getPrices(market.yesTokenId, cfg.shortVolWindow);
          const breakoutDir = detectBreakout(breakoutPrices, atr, cfg.breakoutMultiplier);

          // Clear compression state
          compressionState.set(market.yesTokenId, { compressed: false, compressedAt: 0 });

          if (!breakoutDir) continue;

          // Volume confirmation: check that volume is above median
          // We use market.volume24h vs market.volume as a simple proxy
          // (higher 24h share of total = active market)
          if (market.volume24h !== undefined && market.volume !== undefined) {
            if (market.volume > 0 && (market.volume24h / market.volume) < 0.01) continue;
          }

          // Direction: breakout = momentum, not mean reversion
          const side: 'yes' | 'no' = breakoutDir === 'up' ? 'yes' : 'no';
          const tokenId = side === 'yes'
            ? market.yesTokenId
            : (market.noTokenId ?? market.yesTokenId);
          const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

          const posSize = kellySizer
            ? kellySizer.getSize(STRATEGY_NAME).size
            : cfg.sizeUsdc;

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
            compressionMid: ba.mid,
          });

          logger.info('Entry position', STRATEGY_NAME, {
            conditionId: market.conditionId,
            side,
            entryPrice: entryPrice.toFixed(4),
            volShort: volShort.toFixed(6),
            volLong: volLong.toFixed(6),
            volRatio: (volShort / volLong).toFixed(4),
            breakoutDir,
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
        } else if (!isCompressed && (!state || !state.compressed)) {
          // Not compressed and wasn't before — nothing to do
          continue;
        }
        // If still compressed, keep waiting
      } catch (err) {
        logger.debug('Scan error', STRATEGY_NAME, {
          market: market.conditionId,
          err: String(err),
        });
      }
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function volCompressionBreakoutTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
        compressedMarkets: [...compressionState.values()].filter(s => s.compressed).length,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
