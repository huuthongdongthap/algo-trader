/**
 * Book Imbalance Reversal strategy for Polymarket binary markets.
 *
 * Combines order book imbalance (OBI) with mean reversion z-score to
 * predict short-term price direction. Enters when the book is skewed
 * AND price has deviated from its rolling mean.
 *
 * Signal logic:
 *   OBI = (Σ bid_vol - Σ ask_vol) / (Σ bid_vol + Σ ask_vol)
 *   z   = (price - SMA) / StdDev
 *
 *   z < -zThreshold AND OBI > +obiThreshold → BUY YES  (oversold + buy pressure)
 *   z > +zThreshold AND OBI < -obiThreshold → BUY NO   (overbought + sell pressure)
 */
import type { ClobClient, RawOrderBook, OrderBookLevel } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface BookImbalanceConfig {
  /** Min absolute OBI to trigger (0–1) */
  obiThreshold: number;
  /** Number of orderbook levels to sum for OBI */
  obiDepthLevels: number;
  /** Min absolute z-score for mean reversion signal */
  zScoreThreshold: number;
  /** Number of price ticks for SMA / StdDev */
  lookbackPeriods: number;
  /** Trade size in USDC */
  sizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction (0.03 = 3%) */
  takeProfitPct: number;
  /** Stop-loss as fraction (0.02 = 2%) */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: BookImbalanceConfig = {
  obiThreshold: 0.3,
  obiDepthLevels: 5,
  zScoreThreshold: 1.5,
  lookbackPeriods: 20,
  sizeUsdc: 30,
  maxPositions: 5,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 10 * 60_000,
  cooldownMs: 60_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'book-imbalance-reversal';

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
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Compute Order Book Imbalance from raw levels. */
export function calcOBI(book: RawOrderBook, depthLevels: number): number {
  const sumVolume = (levels: OrderBookLevel[], n: number): number => {
    let total = 0;
    const limit = Math.min(n, levels.length);
    for (let i = 0; i < limit; i++) {
      total += parseFloat(levels[i].size);
    }
    return total;
  };

  const bidVol = sumVolume(book.bids, depthLevels);
  const askVol = sumVolume(book.asks, depthLevels);
  const total = bidVol + askVol;
  if (total === 0) return 0;
  return (bidVol - askVol) / total;
}

/** Compute z-score of the latest price relative to a rolling window. */
export function calcZScore(prices: number[]): number {
  if (prices.length < 3) return 0;
  const n = prices.length;
  const mean = prices.reduce((s, p) => s + p, 0) / n;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (prices[n - 1] - mean) / std;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface BookImbalanceDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<BookImbalanceConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createBookImbalanceReversalTick(deps: BookImbalanceDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
    kellySizer,
  } = deps;
  const cfg: BookImbalanceConfig = { ...DEFAULT_CONFIG, ...deps.config };

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
    // Keep only lookback * 2 entries
    if (history.length > cfg.lookbackPeriods * 2) {
      history.splice(0, history.length - cfg.lookbackPeriods * 2);
    }
  }

  function getPriceWindow(tokenId: string): number[] {
    const history = priceHistory.get(tokenId);
    if (!history) return [];
    return history.slice(-cfg.lookbackPeriods).map(t => t.price);
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
        recordPrice(pos.tokenId, currentPrice);
      } catch {
        continue; // skip if can't fetch
      }

      // Take profit
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
        // For NO positions: we profit when price goes down
        const gain = (pos.entryPrice - currentPrice) / pos.entryPrice;
        if (gain >= cfg.takeProfitPct) {
          shouldExit = true;
          reason = `take-profit (${(gain * 100).toFixed(2)}%)`;
        } else if (-gain >= cfg.stopLossPct) {
          shouldExit = true;
          reason = `stop-loss (${(gain * 100).toFixed(2)}%)`;
        }
      }

      // Mean reversion complete: z-score back near zero
      if (!shouldExit) {
        const window = getPriceWindow(pos.tokenId);
        const z = calcZScore(window);
        if (Math.abs(z) < 0.3) {
          shouldExit = true;
          reason = `mean-reversion complete (z=${z.toFixed(2)})`;
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

  // ── Entry logic ──────────────────────────────────────────────────────────

  async function scanEntries(markets: GammaMarket[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.yesTokenId)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId)) continue;

      try {
        // Fetch orderbook for YES token
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        recordPrice(market.yesTokenId, ba.mid);

        // Calculate signals
        const obi = calcOBI(book, cfg.obiDepthLevels);
        const window = getPriceWindow(market.yesTokenId);
        const z = calcZScore(window);

        // Need enough price history
        if (window.length < cfg.lookbackPeriods) continue;

        // Entry conditions
        let side: 'yes' | 'no' | null = null;

        if (z < -cfg.zScoreThreshold && obi > cfg.obiThreshold) {
          // Oversold + buy pressure → buy YES (expect price up)
          side = 'yes';
        } else if (z > cfg.zScoreThreshold && obi < -cfg.obiThreshold) {
          // Overbought + sell pressure → buy NO (expect price down)
          side = 'no';
        }

        if (!side) continue;

        // Determine token and price
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid); // NO price ≈ 1 - YES bid

        // Position sizing
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
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          obi: obi.toFixed(3),
          zScore: z.toFixed(2),
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

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function bookImbalanceReversalTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(cfg.scanLimit);

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
