/**
 * Orderbook Depth Ratio strategy for Polymarket binary markets.
 *
 * Monitors asymmetric orderbook liquidity at multiple depth levels (top 3-5
 * levels) to predict short-term directional moves. When one side has
 * significantly more volume than the other, it signals institutional intent.
 *
 * Signal logic:
 *   depthRatio = SUM(bid_vol at levels 1..N) / SUM(ask_vol at levels 1..N)
 *   z = z-score of current depthRatio vs rolling history
 *
 *   depthRatio > highThreshold AND z > zScoreThreshold → BUY YES (heavy bid support)
 *   depthRatio < lowThreshold  AND z < -zScoreThreshold → BUY NO  (heavy ask pressure)
 *   Additional filter: mid-price momentum must align (not fighting the tape)
 */
import type { ClobClient, RawOrderBook, OrderBookLevel } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface OrderbookDepthConfig {
  /** Number of orderbook levels to sum for depth ratio */
  depthLevels: number;
  /** Depth ratio above which we consider heavy bid support */
  highThreshold: number;
  /** Depth ratio below which we consider heavy ask pressure */
  lowThreshold: number;
  /** Min absolute z-score for depth ratio signal */
  zScoreThreshold: number;
  /** Whether mid-price momentum must align with depth signal */
  momentumAlignRequired: boolean;
  /** Number of depth ratio observations for z-score */
  lookbackPeriods: number;
  /** Trade size in USDC */
  sizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction (0.025 = 2.5%) */
  takeProfitPct: number;
  /** Stop-loss as fraction (0.018 = 1.8%) */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: OrderbookDepthConfig = {
  depthLevels: 5,
  highThreshold: 3.0,
  lowThreshold: 0.33,
  zScoreThreshold: 1.5,
  momentumAlignRequired: true,
  lookbackPeriods: 20,
  sizeUsdc: 30,
  maxPositions: 4,
  takeProfitPct: 0.025,
  stopLossPct: 0.018,
  maxHoldMs: 8 * 60_000,
  cooldownMs: 60_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'orderbook-depth-ratio';

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

/**
 * Compute depth ratio from raw orderbook levels.
 * depthRatio = SUM(bid_vol) / SUM(ask_vol) for the top N levels.
 * Returns 0 when both sides are empty, Infinity when only bids exist,
 * and 0 when only asks exist.
 */
export function calcDepthRatio(book: RawOrderBook, levels: number): number {
  const sumVolume = (lvls: OrderBookLevel[], n: number): number => {
    let total = 0;
    const limit = Math.min(n, lvls.length);
    for (let i = 0; i < limit; i++) {
      total += parseFloat(lvls[i].size);
    }
    return total;
  };

  const bidVol = sumVolume(book.bids, levels);
  const askVol = sumVolume(book.asks, levels);

  if (bidVol === 0 && askVol === 0) return 0;
  if (askVol === 0) return Infinity;
  return bidVol / askVol;
}

/**
 * Compute z-score of the latest depth ratio relative to a rolling window.
 * Returns 0 if fewer than 3 observations or zero variance.
 */
export function calcDepthZScore(ratios: number[]): number {
  if (ratios.length < 3) return 0;
  const n = ratios.length;
  const mean = ratios.reduce((s, r) => s + r, 0) / n;
  const variance = ratios.reduce((s, r) => s + (r - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (ratios[n - 1] - mean) / std;
}

/**
 * Detect short-term price momentum from the last 3 ticks.
 * Returns 'up' if prices are trending up, 'down' if trending down,
 * 'flat' otherwise. Requires at least 3 prices.
 */
export function detectMomentum(prices: number[]): 'up' | 'down' | 'flat' {
  if (prices.length < 3) return 'flat';
  const last3 = prices.slice(-3);
  if (last3[2] > last3[1] && last3[1] > last3[0]) return 'up';
  if (last3[2] < last3[1] && last3[1] < last3[0]) return 'down';
  return 'flat';
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface OrderbookDepthDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<OrderbookDepthConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createOrderbookDepthRatioTick(deps: OrderbookDepthDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
    kellySizer,
  } = deps;
  const cfg: OrderbookDepthConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const depthHistory = new Map<string, number[]>();
  const priceHistory = new Map<string, PriceTick[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordDepthRatio(tokenId: string, ratio: number): void {
    let history = depthHistory.get(tokenId);
    if (!history) {
      history = [];
      depthHistory.set(tokenId, history);
    }
    history.push(ratio);
    if (history.length > cfg.lookbackPeriods * 2) {
      history.splice(0, history.length - cfg.lookbackPeriods * 2);
    }
  }

  function getDepthWindow(tokenId: string): number[] {
    const history = depthHistory.get(tokenId);
    if (!history) return [];
    return history.slice(-cfg.lookbackPeriods);
  }

  function recordPrice(tokenId: string, price: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: Date.now() });
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

      // Get current price and depth ratio
      let currentPrice: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        const ba = bestBidAsk(book);
        currentPrice = ba.mid;
        recordPrice(pos.tokenId, currentPrice);

        // Record depth ratio for reversal detection
        const ratio = calcDepthRatio(book, cfg.depthLevels);
        recordDepthRatio(pos.tokenId, ratio);
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

      // Depth ratio reversal: if ratio flips to opposite extreme
      if (!shouldExit) {
        const depthWindow = getDepthWindow(pos.tokenId);
        if (depthWindow.length > 0) {
          const currentRatio = depthWindow[depthWindow.length - 1];
          if (pos.side === 'yes' && currentRatio < cfg.lowThreshold) {
            shouldExit = true;
            reason = `depth-ratio reversal (ratio=${currentRatio.toFixed(2)}, was long YES)`;
          } else if (pos.side === 'no' && currentRatio > cfg.highThreshold) {
            shouldExit = true;
            reason = `depth-ratio reversal (ratio=${currentRatio.toFixed(2)}, was long NO)`;
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

        // Calculate depth ratio and record
        const ratio = calcDepthRatio(book, cfg.depthLevels);
        recordDepthRatio(market.yesTokenId, ratio);

        // Need enough depth ratio history
        const depthWindow = getDepthWindow(market.yesTokenId);
        if (depthWindow.length < cfg.lookbackPeriods) continue;

        const z = calcDepthZScore(depthWindow);

        // Check momentum alignment
        const prices = getPriceWindow(market.yesTokenId);
        const momentum = detectMomentum(prices);

        // Entry conditions
        let side: 'yes' | 'no' | null = null;

        if (ratio > cfg.highThreshold && z > cfg.zScoreThreshold) {
          // Heavy bid support → buy YES (expect price up)
          if (!cfg.momentumAlignRequired || momentum === 'up' || momentum === 'flat') {
            side = 'yes';
          }
        } else if (ratio < cfg.lowThreshold && z < -cfg.zScoreThreshold) {
          // Heavy ask pressure → buy NO (expect price down)
          if (!cfg.momentumAlignRequired || momentum === 'down' || momentum === 'flat') {
            side = 'no';
          }
        }

        if (!side) continue;

        // Determine token and price
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid); // NO price ~ 1 - YES bid

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
          depthRatio: ratio.toFixed(3),
          depthZScore: z.toFixed(2),
          momentum,
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

  return async function orderbookDepthRatioTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(cfg.scanLimit);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: depthHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
