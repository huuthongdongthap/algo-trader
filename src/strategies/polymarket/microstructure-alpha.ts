/**
 * Microstructure Alpha strategy for Polymarket binary markets.
 *
 * Analyzes order book microstructure for short-term alpha signals by combining
 * multiple microstructure features into a composite score:
 *   1. Spread compression — tightening spread predicts directional move
 *   2. Queue imbalance — asymmetry in resting order sizes at best bid/ask
 *   3. Mid-price momentum — consecutive mid-price changes in same direction
 *   4. Level consumption rate — how fast top levels are being eaten
 *
 * Signal logic:
 *   spreadCompression = 1 - (currentSpread / avgSpread). High = impending breakout.
 *   queueImbalance = (bestBidSize - bestAskSize) / (bestBidSize + bestAskSize).
 *   midMomentum = sum of last N mid-price changes (signed, normalized).
 *   compositeScore = w1*spreadCompression + w2*queueImbalance + w3*midMomentum
 *   Entry when |compositeScore| > entryThreshold.
 *   score > 0 → BUY YES, score < 0 → BUY NO.
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface MicrostructureAlphaConfig {
  /** Rolling window length for spread history */
  spreadHistoryLen: number;
  /** Rolling window length for mid-price momentum */
  midHistoryLen: number;
  /** Weight for spread compression signal */
  w_spread: number;
  /** Weight for queue imbalance signal */
  w_queue: number;
  /** Weight for mid-price momentum signal */
  w_momentum: number;
  /** Composite score threshold for entry */
  entryThreshold: number;
  /** Minimum spread in basis points to avoid illiquid markets */
  minSpreadBps: number;
  /** Take-profit as fraction */
  takeProfitPct: number;
  /** Stop-loss as fraction */
  stopLossPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Trade size in USDC */
  positionSize: string;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: MicrostructureAlphaConfig = {
  spreadHistoryLen: 50,
  midHistoryLen: 20,
  w_spread: 0.3,
  w_queue: 0.4,
  w_momentum: 0.3,
  entryThreshold: 0.55,
  minSpreadBps: 50,
  takeProfitPct: 0.025,
  stopLossPct: 0.015,
  maxHoldMs: 5 * 60_000,
  maxPositions: 6,
  cooldownMs: 60_000,
  positionSize: '10',
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'microstructure-alpha';

// ── Internal types ──────────────────────────────────────────────────────────

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

/** Extract best bid/ask/mid and sizes from raw order book. */
export function bestBidAsk(book: RawOrderBook): {
  bid: number;
  ask: number;
  mid: number;
  bidSize: number;
  askSize: number;
} {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  const bidSize = book.bids.length > 0 ? parseFloat(book.bids[0].size) : 0;
  const askSize = book.asks.length > 0 ? parseFloat(book.asks[0].size) : 0;
  return { bid, ask, mid: (bid + ask) / 2, bidSize, askSize };
}

/**
 * Calculate spread compression.
 * spreadCompression = 1 - (currentSpread / avgSpread)
 * Returns 0 if avgSpread is 0.
 */
export function calcSpreadCompression(currentSpread: number, spreadHistory: number[]): number {
  if (spreadHistory.length === 0) return 0;

  let sum = 0;
  for (const s of spreadHistory) {
    sum += s;
  }
  const avgSpread = sum / spreadHistory.length;
  if (avgSpread <= 0) return 0;

  return 1 - (currentSpread / avgSpread);
}

/**
 * Calculate queue imbalance from best bid/ask sizes.
 * queueImbalance = (bestBidSize - bestAskSize) / (bestBidSize + bestAskSize)
 * Range: [-1, 1]. Positive = more resting bids = bullish.
 * Returns 0 if both sizes are 0.
 */
export function calcQueueImbalance(bestBidSize: number, bestAskSize: number): number {
  const total = bestBidSize + bestAskSize;
  if (total <= 0) return 0;
  return (bestBidSize - bestAskSize) / total;
}

/**
 * Calculate mid-price momentum as the normalized sum of recent mid-price changes.
 * Takes the last N changes (diffs) and sums them, then normalizes by
 * dividing by the average absolute change to get a dimensionless signal.
 * Returns 0 if insufficient data.
 */
export function calcMidMomentum(midHistory: number[], window: number): number {
  if (midHistory.length < 2) return 0;

  const changes: number[] = [];
  const start = Math.max(0, midHistory.length - window - 1);
  for (let i = start + 1; i < midHistory.length; i++) {
    changes.push(midHistory[i] - midHistory[i - 1]);
  }

  if (changes.length === 0) return 0;

  const sum = changes.reduce((a, b) => a + b, 0);
  const absSum = changes.reduce((a, b) => a + Math.abs(b), 0);

  if (absSum <= 0) return 0;

  // Normalized momentum: range [-1, 1]
  return sum / absSum;
}

/**
 * Calculate composite microstructure score.
 * compositeScore = w_spread * spreadCompression + w_queue * queueImbalance + w_momentum * midMomentum
 */
export function calcCompositeScore(
  spreadCompression: number,
  queueImbalance: number,
  midMomentum: number,
  wSpread: number,
  wQueue: number,
  wMomentum: number,
): number {
  return wSpread * spreadCompression + wQueue * queueImbalance + wMomentum * midMomentum;
}

/**
 * Check if spread is above minimum threshold in basis points.
 * spreadBps = (ask - bid) / mid * 10000
 */
export function spreadAboveMinBps(bid: number, ask: number, minBps: number): boolean {
  const mid = (bid + ask) / 2;
  if (mid <= 0) return false;
  const spreadBps = ((ask - bid) / mid) * 10_000;
  return spreadBps >= minBps;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface MicrostructureAlphaDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<MicrostructureAlphaConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createMicrostructureAlphaTick(deps: MicrostructureAlphaDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: MicrostructureAlphaConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const spreadHistory = new Map<string, number[]>();
  const midPriceHistory = new Map<string, number[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordSpread(tokenId: string, spread: number): void {
    let history = spreadHistory.get(tokenId);
    if (!history) {
      history = [];
      spreadHistory.set(tokenId, history);
    }
    history.push(spread);
    if (history.length > cfg.spreadHistoryLen * 2) {
      history.splice(0, history.length - cfg.spreadHistoryLen * 2);
    }
  }

  function recordMid(tokenId: string, mid: number): void {
    let history = midPriceHistory.get(tokenId);
    if (!history) {
      history = [];
      midPriceHistory.set(tokenId, history);
    }
    history.push(mid);
    const maxLen = cfg.midHistoryLen * 2;
    if (history.length > maxLen) {
      history.splice(0, history.length - maxLen);
    }
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
        recordSpread(pos.tokenId, ba.ask - ba.bid);
        recordMid(pos.tokenId, ba.mid);
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

        const currentSpread = ba.ask - ba.bid;

        // Check minimum spread (avoid illiquid markets)
        if (!spreadAboveMinBps(ba.bid, ba.ask, cfg.minSpreadBps)) continue;

        // Record data
        recordSpread(market.yesTokenId, currentSpread);
        recordMid(market.yesTokenId, ba.mid);

        // Need enough spread history
        const spreads = spreadHistory.get(market.yesTokenId);
        if (!spreads || spreads.length < 2) continue;

        // Calculate signals
        const compression = calcSpreadCompression(currentSpread, spreads.slice(0, -1));
        const imbalance = calcQueueImbalance(ba.bidSize, ba.askSize);

        const mids = midPriceHistory.get(market.yesTokenId);
        const momentum = mids ? calcMidMomentum(mids, cfg.midHistoryLen) : 0;

        const score = calcCompositeScore(
          compression, imbalance, momentum,
          cfg.w_spread, cfg.w_queue, cfg.w_momentum,
        );

        // Check entry threshold
        if (Math.abs(score) <= cfg.entryThreshold) continue;

        // Determine direction
        const side: 'yes' | 'no' = score > 0 ? 'yes' : 'no';
        const tokenId = side === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);
        const sizeUsdc = parseFloat(cfg.positionSize);

        const order = await orderManager.placeOrder({
          tokenId,
          side: 'buy',
          price: entryPrice.toFixed(4),
          size: String(Math.round(sizeUsdc / entryPrice)),
          orderType: 'GTC',
        });

        positions.push({
          tokenId,
          conditionId: market.conditionId,
          side,
          entryPrice,
          sizeUsdc,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          compositeScore: score.toFixed(4),
          compression: compression.toFixed(4),
          imbalance: imbalance.toFixed(4),
          momentum: momentum.toFixed(4),
          size: sizeUsdc,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: order.id,
            marketId: market.conditionId,
            side: 'buy',
            fillPrice: String(entryPrice),
            fillSize: String(sizeUsdc),
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

  return async function microstructureAlphaTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: spreadHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
