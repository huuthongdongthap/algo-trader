/**
 * Correlation Breakdown strategy for Polymarket binary markets.
 *
 * Detects when historically correlated markets within the same event decouple,
 * then trades the outlier back toward the group mean — betting on reversion.
 *
 * Signal logic:
 *   For each event group from gamma.getEvents(), track prices of all markets.
 *   Compute rolling Pearson correlation between all market pairs over corrWindow.
 *   Also track a long-term "baseline" correlation using baselineWindow.
 *
 *   Breakdown detection: current rolling correlation drops below
 *   baseline - breakdownThreshold for any pair.
 *
 *   Entry: identify the outlier market (largest recent return deviation from
 *   the event average). If the outlier went up → BUY NO, if down → BUY YES.
 *
 * Exit conditions:
 *   - Take-profit: price moved takeProfitPct in our favour
 *   - Stop-loss:   price moved stopLossPct against us
 *   - Max hold:    position older than maxHoldMs
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket, GammaMarketGroup } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface CorrelationBreakdownConfig {
  /** Short rolling window for current correlation */
  corrWindow: number;
  /** Longer window for baseline correlation */
  baselineWindow: number;
  /** Drop below baseline - this threshold triggers breakdown */
  breakdownThreshold: number;
  /** Min ticks of pair history required */
  minPairHistory: number;
  /** Min volume filter for markets */
  minVolume: number;
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
  /** Trade size in USDC (string) */
  positionSize: string;
}

const DEFAULT_CONFIG: CorrelationBreakdownConfig = {
  corrWindow: 15,
  baselineWindow: 50,
  breakdownThreshold: 0.4,
  minPairHistory: 20,
  minVolume: 5000,
  takeProfitPct: 0.035,
  stopLossPct: 0.025,
  maxHoldMs: 20 * 60_000,
  maxPositions: 3,
  cooldownMs: 180_000,
  positionSize: '12',
};

const STRATEGY_NAME: StrategyName = 'correlation-breakdown' as StrategyName;

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
 * Compute Pearson correlation coefficient between two price series.
 * Returns 0 if fewer than 3 data points.
 */
export function calcCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += a[i]; sumB += b[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i] - meanA;
    const dB = b[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom === 0) return 0;
  return cov / denom;
}

/**
 * Compute rolling correlation over the last `window` ticks of two series.
 * Takes the trailing `window` elements from each series.
 */
export function rollingCorrelation(a: number[], b: number[], window: number): number {
  const minLen = Math.min(a.length, b.length);
  if (minLen < window) return 0;
  const sliceA = a.slice(-window);
  const sliceB = b.slice(-window);
  return calcCorrelation(sliceA, sliceB);
}

/**
 * Detect whether a correlation breakdown has occurred.
 * Breakdown = currentCorr < baselineCorr - threshold.
 */
export function isBreakdown(
  currentCorr: number,
  baselineCorr: number,
  threshold: number,
): boolean {
  return currentCorr < baselineCorr - threshold;
}

/**
 * Compute simple return over the last `window` prices.
 * Return = (last - first) / first. Returns 0 if insufficient data.
 */
export function calcReturn(prices: number[], window: number): number {
  if (prices.length < 2 || window < 2) return 0;
  const n = Math.min(window, prices.length);
  const start = prices[prices.length - n];
  const end = prices[prices.length - 1];
  if (start === 0) return 0;
  return (end - start) / start;
}

/**
 * Given per-market returns, find the outlier — the market whose return
 * deviates most from the average return across the event.
 * Returns null if fewer than 2 markets.
 */
export function findOutlier(
  marketReturns: Map<string, number>,
): { tokenId: string; deviation: number; ret: number } | null {
  if (marketReturns.size < 2) return null;

  let sum = 0;
  for (const ret of marketReturns.values()) sum += ret;
  const avg = sum / marketReturns.size;

  let best: { tokenId: string; deviation: number; ret: number } | null = null;
  for (const [tokenId, ret] of marketReturns) {
    const deviation = ret - avg;
    if (!best || Math.abs(deviation) > Math.abs(best.deviation)) {
      best = { tokenId, deviation, ret };
    }
  }

  return best;
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

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface CorrelationBreakdownDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<CorrelationBreakdownConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createCorrelationBreakdownTick(deps: CorrelationBreakdownDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: CorrelationBreakdownConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Internal state
  const priceHistory = new Map<string, number[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordPrice(tokenId: string, price: number): void {
    let arr = priceHistory.get(tokenId);
    if (!arr) {
      arr = [];
      priceHistory.set(tokenId, arr);
    }
    arr.push(price);
    // Keep enough history for baseline window + some buffer
    if (arr.length > cfg.baselineWindow * 2) {
      arr.splice(0, arr.length - cfg.baselineWindow * 2);
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
        recordPrice(pos.tokenId, currentMid);
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

  async function scanEntries(events: GammaMarketGroup[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const event of events) {
      if (positions.length >= cfg.maxPositions) break;

      // Filter to active, open markets with YES tokens and sufficient volume
      const activeMarkets = event.markets.filter(
        m => m.yesTokenId && !m.closed && !m.resolved && m.active && m.volume >= cfg.minVolume,
      );
      if (activeMarkets.length < 2) continue;

      // Fetch prices and record history for all markets in this group
      const marketMids = new Map<string, number>();
      for (const m of activeMarkets) {
        try {
          const book = await clob.getOrderBook(m.yesTokenId);
          const mid = bestMid(book);
          if (mid <= 0 || mid >= 1) continue;
          recordPrice(m.yesTokenId, mid);
          marketMids.set(m.yesTokenId, mid);
        } catch {
          continue;
        }
      }

      // Need at least 2 markets with data
      if (marketMids.size < 2) continue;

      // Check all pairs for correlation breakdown
      const tokenIds = [...marketMids.keys()];
      let breakdownDetected = false;

      for (let i = 0; i < tokenIds.length && !breakdownDetected; i++) {
        for (let j = i + 1; j < tokenIds.length && !breakdownDetected; j++) {
          const histA = priceHistory.get(tokenIds[i]);
          const histB = priceHistory.get(tokenIds[j]);
          if (!histA || !histB) continue;

          // Require minimum pair history
          if (Math.min(histA.length, histB.length) < cfg.minPairHistory) continue;

          // Need baseline window of data for baseline correlation
          if (Math.min(histA.length, histB.length) < cfg.baselineWindow) continue;

          const currentCorr = rollingCorrelation(histA, histB, cfg.corrWindow);
          const baselineCorr = rollingCorrelation(histA, histB, cfg.baselineWindow);

          if (isBreakdown(currentCorr, baselineCorr, cfg.breakdownThreshold)) {
            breakdownDetected = true;
          }
        }
      }

      if (!breakdownDetected) continue;

      // Compute per-market returns
      const marketReturns = new Map<string, number>();
      for (const tokenId of tokenIds) {
        const history = priceHistory.get(tokenId);
        if (!history || history.length < cfg.corrWindow) continue;
        const ret = calcReturn(history, cfg.corrWindow);
        marketReturns.set(tokenId, ret);
      }

      if (marketReturns.size < 2) continue;

      // Find the outlier
      const outlier = findOutlier(marketReturns);
      if (!outlier) continue;

      const targetTokenId = outlier.tokenId;
      if (hasPositionFor(targetTokenId)) continue;
      if (isOnCooldown(targetTokenId)) continue;

      // Determine direction: outlier went up → BUY NO, outlier went down → BUY YES
      const side: 'yes' | 'no' = outlier.deviation > 0 ? 'no' : 'yes';

      // Find the GammaMarket for this outlier
      const targetMarket = activeMarkets.find(m => m.yesTokenId === targetTokenId);
      if (!targetMarket) continue;

      const entryTokenId = side === 'yes' ? targetTokenId : (targetMarket.noTokenId ?? targetTokenId);

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
          conditionId: targetMarket.conditionId,
          side,
          entryPrice,
          sizeUsdc: posSize,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry breakdown', STRATEGY_NAME, {
          tokenId: entryTokenId,
          side,
          entryPrice: entryPrice.toFixed(4),
          outlierDeviation: (outlier.deviation * 100).toFixed(2) + '%',
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

  return async function correlationBreakdownTick(): Promise<void> {
    try {
      await checkExits();

      const events = await gamma.getEvents();

      await scanEntries(events);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
