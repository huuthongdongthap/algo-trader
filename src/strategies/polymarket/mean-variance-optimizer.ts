/**
 * Mean-Variance Optimizer strategy for Polymarket binary markets.
 *
 * Applies simplified Markowitz mean-variance optimization to select the best
 * risk-adjusted market to trade. For each candidate market, estimates expected
 * return and variance, then selects the one with the highest Sharpe-like ratio.
 * Only trades the single best opportunity per tick.
 *
 * Signal logic:
 *   1. For each market, estimate expected return from price trend
 *   2. Estimate variance from rolling price volatility
 *   3. Calculate Sharpe-like ratio = expected return / sqrt(variance)
 *   4. Select market with highest |ratio| above minimum threshold
 *   5. If ratio > 0 → BUY YES (positive expected return), ratio < 0 → BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface MeanVarianceOptimizerConfig {
  /** Number of price snapshots for expected return calculation */
  returnWindow: number;
  /** Number of price snapshots for variance calculation */
  varianceWindow: number;
  /** Minimum |Sharpe ratio| to trigger a trade */
  minSharpeRatio: number;
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

export const DEFAULT_CONFIG: MeanVarianceOptimizerConfig = {
  returnWindow: 15,
  varianceWindow: 20,
  minSharpeRatio: 1.5,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 3,
  cooldownMs: 120_000,
  positionSize: '15',
};

const STRATEGY_NAME = 'mean-variance-optimizer' as StrategyName;

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
 * Calculate expected return from a price series: (last - first) / first.
 * Returns 0 if fewer than 2 prices or first price is 0.
 */
export function calcExpectedReturn(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  if (first === 0) return 0;
  return (prices[prices.length - 1] - first) / first;
}

/**
 * Calculate population variance of period-over-period returns.
 * Returns 0 if fewer than 2 prices.
 */
export function calcVariance(prices: number[]): number {
  if (prices.length < 2) return 0;

  // Calculate returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] === 0) {
      returns.push(0);
    } else {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }

  if (returns.length === 0) return 0;

  // Mean
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / returns.length;

  // Population variance
  let sqSum = 0;
  for (const r of returns) sqSum += (r - mean) ** 2;
  return sqSum / returns.length;
}

/**
 * Calculate Sharpe-like ratio = expectedReturn / sqrt(variance).
 * Returns 0 if variance <= 0.
 */
export function calcSharpeRatio(expectedReturn: number, variance: number): number {
  if (variance <= 0) return 0;
  return expectedReturn / Math.sqrt(variance);
}

/**
 * Select the candidate market with the highest |ratio| above minRatio.
 * Returns null if no candidate meets the threshold.
 */
export function selectBestMarket(
  candidates: { id: string; ratio: number }[],
  minRatio: number,
): { id: string; ratio: number } | null {
  let best: { id: string; ratio: number } | null = null;
  let bestAbs = 0;

  for (const c of candidates) {
    const absRatio = Math.abs(c.ratio);
    if (absRatio >= minRatio && absRatio > bestAbs) {
      best = c;
      bestAbs = absRatio;
    }
  }

  return best;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface MeanVarianceOptimizerDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<MeanVarianceOptimizerConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createMeanVarianceOptimizerTick(deps: MeanVarianceOptimizerDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: MeanVarianceOptimizerConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
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

    // Keep only max(returnWindow, varianceWindow) snapshots
    const maxWindow = Math.max(cfg.returnWindow, cfg.varianceWindow);
    if (history.length > maxWindow) {
      history.splice(0, history.length - maxWindow);
    }
  }

  function getPrices(tokenId: string): number[] {
    return priceHistory.get(tokenId) ?? [];
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

    // Build candidate list with Sharpe ratios
    const candidates: { id: string; ratio: number; market: GammaMarket; entryPrice: number; tokenId: string }[] = [];

    for (const market of markets) {
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

        // Record price snapshot
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need enough data for analysis
        if (prices.length < 2) continue;

        // Calculate expected return using returnWindow
        const returnPrices = prices.slice(-cfg.returnWindow);
        const expectedReturn = calcExpectedReturn(returnPrices);

        // Calculate variance using varianceWindow
        const variancePrices = prices.slice(-cfg.varianceWindow);
        const variance = calcVariance(variancePrices);

        // Calculate Sharpe-like ratio
        const ratio = calcSharpeRatio(expectedReturn, variance);

        if (Math.abs(ratio) < cfg.minSharpeRatio) continue;

        // Determine entry price based on direction
        const side: 'yes' | 'no' = ratio > 0 ? 'yes' : 'no';
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

        candidates.push({
          id: market.conditionId,
          ratio,
          market,
          entryPrice,
          tokenId,
        });
      } catch (err) {
        logger.debug('Scan error', STRATEGY_NAME, {
          market: market.conditionId,
          err: String(err),
        });
      }
    }

    // Select best market
    const best = selectBestMarket(
      candidates.map(c => ({ id: c.id, ratio: c.ratio })),
      cfg.minSharpeRatio,
    );

    if (!best) return;

    const selected = candidates.find(c => c.id === best.id);
    if (!selected) return;

    if (positions.length >= cfg.maxPositions) return;

    const posSize = parseFloat(cfg.positionSize);
    const side: 'yes' | 'no' = selected.ratio > 0 ? 'yes' : 'no';

    try {
      const order = await orderManager.placeOrder({
        tokenId: selected.tokenId,
        side: 'buy',
        price: selected.entryPrice.toFixed(4),
        size: String(Math.round(posSize / selected.entryPrice)),
        orderType: 'GTC',
      });

      positions.push({
        tokenId: selected.tokenId,
        conditionId: selected.market.conditionId,
        side,
        entryPrice: selected.entryPrice,
        sizeUsdc: posSize,
        orderId: order.id,
        openedAt: Date.now(),
      });

      logger.info('Entry position', STRATEGY_NAME, {
        conditionId: selected.market.conditionId,
        side,
        entryPrice: selected.entryPrice.toFixed(4),
        sharpeRatio: selected.ratio.toFixed(4),
        size: posSize.toFixed(2),
      });

      eventBus.emit('trade.executed', {
        trade: {
          orderId: order.id,
          marketId: selected.market.conditionId,
          side: 'buy',
          fillPrice: String(selected.entryPrice),
          fillSize: String(posSize),
          fees: '0',
          timestamp: Date.now(),
          strategy: STRATEGY_NAME,
        },
      });
    } catch (err) {
      logger.debug('Entry failed', STRATEGY_NAME, {
        market: selected.market.conditionId,
        err: String(err),
      });
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function meanVarianceOptimizerTick(): Promise<void> {
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
