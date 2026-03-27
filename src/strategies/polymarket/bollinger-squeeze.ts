/**
 * Bollinger Band Squeeze strategy for Polymarket binary markets.
 *
 * Detects periods of low volatility (Bollinger Band squeeze) on binary market
 * prices, then trades the breakout direction. When bands narrow significantly
 * relative to their historical width, a breakout is imminent. Trades in the
 * direction of the breakout once price closes outside the bands.
 *
 * Signal logic:
 *   1. Track rolling price window for each market
 *   2. Calculate SMA and standard deviation over the window
 *   3. Upper band = SMA + multiplier * std, Lower band = SMA - multiplier * std
 *   4. Band width = (upper - lower) / SMA
 *   5. Track band width history; when current width < squeezeThreshold * average width → squeeze detected
 *   6. When price breaks above upper band during squeeze → BUY YES (bullish breakout)
 *   7. When price breaks below lower band during squeeze → BUY NO (bearish breakout)
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface BollingerSqueezeConfig {
  /** SMA lookback window */
  smaWindow: number;
  /** Standard deviation multiplier for bands */
  bandMultiplier: number;
  /** Width < avg * this = squeeze */
  squeezeThreshold: number;
  /** Band width history size */
  widthWindow: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (0.03 = 3%) */
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

export const DEFAULT_CONFIG: BollingerSqueezeConfig = {
  smaWindow: 20,
  bandMultiplier: 2.0,
  squeezeThreshold: 0.6,
  widthWindow: 30,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'bollinger-squeeze' as StrategyName;

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
 * Calculate simple moving average. Returns 0 if prices array is empty.
 */
export function calcSMA(prices: number[]): number {
  if (prices.length === 0) return 0;
  let sum = 0;
  for (const p of prices) sum += p;
  return sum / prices.length;
}

/**
 * Calculate population standard deviation given prices and their mean.
 */
export function calcStdDev(prices: number[], mean: number): number {
  if (prices.length === 0) return 0;
  let sumSq = 0;
  for (const p of prices) {
    const diff = p - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / prices.length);
}

/**
 * Calculate upper band, lower band, and band width from SMA + std.
 * width = (upper - lower) / SMA. Returns width 0 if SMA is 0.
 */
export function calcBands(
  sma: number,
  std: number,
  multiplier: number,
): { upper: number; lower: number; width: number } {
  const upper = sma + multiplier * std;
  const lower = sma - multiplier * std;
  const width = sma === 0 ? 0 : (upper - lower) / sma;
  return { upper, lower, width };
}

/**
 * Determine if bands are squeezing: current width < avgWidth * threshold.
 */
export function isSqueezing(currentWidth: number, avgWidth: number, threshold: number): boolean {
  return currentWidth < avgWidth * threshold;
}

/**
 * Detect breakout direction.
 * Returns 'bullish' if price > upper, 'bearish' if price < lower, null otherwise.
 */
export function detectBreakout(
  price: number,
  upper: number,
  lower: number,
): 'bullish' | 'bearish' | null {
  if (price > upper) return 'bullish';
  if (price < lower) return 'bearish';
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface BollingerSqueezeDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<BollingerSqueezeConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createBollingerSqueezeTick(deps: BollingerSqueezeDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: BollingerSqueezeConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
  const widthHistory = new Map<string, number[]>();
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

    // Keep only smaWindow snapshots
    if (history.length > cfg.smaWindow) {
      history.splice(0, history.length - cfg.smaWindow);
    }
  }

  function recordWidth(tokenId: string, width: number): void {
    let history = widthHistory.get(tokenId);
    if (!history) {
      history = [];
      widthHistory.set(tokenId, history);
    }
    history.push(width);

    // Keep only widthWindow entries
    if (history.length > cfg.widthWindow) {
      history.splice(0, history.length - cfg.widthWindow);
    }
  }

  function getPrices(tokenId: string): number[] {
    return priceHistory.get(tokenId) ?? [];
  }

  function getWidths(tokenId: string): number[] {
    return widthHistory.get(tokenId) ?? [];
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

        // Record price
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need full SMA window for meaningful calculation
        if (prices.length < cfg.smaWindow) continue;

        // Calculate Bollinger Bands
        const sma = calcSMA(prices);
        const std = calcStdDev(prices, sma);
        const bands = calcBands(sma, std, cfg.bandMultiplier);

        // Record band width
        recordWidth(market.yesTokenId, bands.width);
        const widths = getWidths(market.yesTokenId);

        // Need at least 2 width entries to compute average
        if (widths.length < 2) continue;

        // Check for squeeze
        const avgWidth = calcSMA(widths);
        const squeezing = isSqueezing(bands.width, avgWidth, cfg.squeezeThreshold);
        if (!squeezing) continue;

        // Check for breakout
        const breakout = detectBreakout(ba.mid, bands.upper, bands.lower);
        if (!breakout) continue;

        // Determine signal
        const side: 'yes' | 'no' = breakout === 'bullish' ? 'yes' : 'no';
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
          sma: sma.toFixed(4),
          std: std.toFixed(4),
          upper: bands.upper.toFixed(4),
          lower: bands.lower.toFixed(4),
          width: bands.width.toFixed(4),
          avgWidth: avgWidth.toFixed(4),
          breakout,
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

  return async function bollingerSqueezeTick(): Promise<void> {
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
