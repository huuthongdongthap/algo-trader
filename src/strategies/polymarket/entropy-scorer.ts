/**
 * Entropy Scorer strategy for Polymarket binary markets.
 *
 * Measures market uncertainty via Shannon entropy of orderbook price/size
 * distribution. Low entropy indicates high conviction on one side of the book,
 * which is a tradeable setup. High entropy means uncertainty — skip.
 *
 * Signal logic:
 *   1. Calculate Shannon entropy of orderbook: normalize sizes across all
 *      levels, compute -sum(p * log2(p)).
 *   2. Track entropy history per market with a rolling window.
 *   3. Low entropy signal: entropy < lowEntropyThreshold — market has strong
 *      conviction on one side.
 *   4. Determine direction from concentration: if bid-side entropy < ask-side
 *      entropy → bullish conviction → BUY YES, vice versa.
 *   5. Confirm with entropy trend: entropy should be decreasing (conviction
 *      building).
 *   6. Require minimum book depth (minLevels) to avoid false signals on thin
 *      books.
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface EntropyScorerConfig {
  /** Shannon entropy threshold — below this is a tradeable low-entropy signal */
  lowEntropyThreshold: number;
  /** Rolling window length for entropy history */
  entropyWindow: number;
  /** Minimum number of levels on each side to consider the book valid */
  minLevels: number;
  /** Entropy must drop this much from window average to confirm trend */
  minEntropyDrop: number;
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
}

const DEFAULT_CONFIG: EntropyScorerConfig = {
  lowEntropyThreshold: 1.5,
  entropyWindow: 25,
  minLevels: 3,
  minEntropyDrop: 0.2,
  takeProfitPct: 0.035,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'entropy-scorer' as StrategyName;

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

/**
 * Calculate Shannon entropy from a list of raw sizes.
 * Normalizes sizes into a probability distribution then computes
 * -sum(p * log2(p)). Returns 0 if input is empty or all zeros.
 */
export function calcShannonEntropy(sizes: number[]): number {
  if (sizes.length === 0) return 0;

  let total = 0;
  for (const s of sizes) {
    if (s > 0) total += s;
  }
  if (total <= 0) return 0;

  let entropy = 0;
  for (const s of sizes) {
    if (s <= 0) continue;
    const p = s / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Calculate Shannon entropy for one side (bids or asks) of an order book.
 * Extracts sizes from the levels and delegates to calcShannonEntropy.
 */
export function calcSideEntropy(levels: { price: string; size: string }[]): number {
  const sizes = levels.map(l => parseFloat(l.size)).filter(s => s > 0);
  return calcShannonEntropy(sizes);
}

/**
 * Check whether the current entropy is below the low-entropy threshold.
 */
export function isLowEntropy(entropy: number, threshold: number): boolean {
  return entropy < threshold;
}

/**
 * Check whether entropy is decreasing: current entropy must be at least
 * `minDrop` below the average of the history window.
 * Returns false if history is empty.
 */
export function isEntropyDecreasing(
  currentEntropy: number,
  entropyHistory: number[],
  minDrop: number,
): boolean {
  if (entropyHistory.length === 0) return false;

  let sum = 0;
  for (const e of entropyHistory) {
    sum += e;
  }
  const avg = sum / entropyHistory.length;

  return avg - currentEntropy >= minDrop;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface EntropyScorerDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<EntropyScorerConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createEntropyScorerTick(deps: EntropyScorerDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: EntropyScorerConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const entropyHistory = new Map<string, number[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordEntropy(tokenId: string, entropy: number): void {
    let history = entropyHistory.get(tokenId);
    if (!history) {
      history = [];
      entropyHistory.set(tokenId, history);
    }
    history.push(entropy);
    if (history.length > cfg.entropyWindow * 2) {
      history.splice(0, history.length - cfg.entropyWindow * 2);
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
        const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
        const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
        currentPrice = (bid + ask) / 2;
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

        // Require minimum book depth
        if (book.bids.length < cfg.minLevels || book.asks.length < cfg.minLevels) continue;

        const bid = parseFloat(book.bids[0].price);
        const ask = parseFloat(book.asks[0].price);
        const mid = (bid + ask) / 2;
        if (mid <= 0 || mid >= 1) continue;

        // Calculate full-book entropy
        const allSizes = [
          ...book.bids.map(l => parseFloat(l.size)),
          ...book.asks.map(l => parseFloat(l.size)),
        ].filter(s => s > 0);
        const fullEntropy = calcShannonEntropy(allSizes);

        // Record and check history
        recordEntropy(market.yesTokenId, fullEntropy);

        const history = entropyHistory.get(market.yesTokenId);
        if (!history || history.length < 2) continue;

        // Check low entropy condition
        if (!isLowEntropy(fullEntropy, cfg.lowEntropyThreshold)) continue;

        // Check entropy is decreasing (conviction building)
        const windowHistory = history.slice(0, -1).slice(-cfg.entropyWindow);
        if (!isEntropyDecreasing(fullEntropy, windowHistory, cfg.minEntropyDrop)) continue;

        // Determine direction from side entropy asymmetry
        const bidEntropy = calcSideEntropy(book.bids);
        const askEntropy = calcSideEntropy(book.asks);

        // Lower entropy on a side means more concentration → conviction on that side
        // Bid-side low entropy → bullish conviction → BUY YES
        // Ask-side low entropy → bearish conviction → BUY NO
        const side: 'yes' | 'no' = bidEntropy < askEntropy ? 'yes' : 'no';
        const tokenId = side === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ask : (1 - bid);
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
          fullEntropy: fullEntropy.toFixed(4),
          bidEntropy: bidEntropy.toFixed(4),
          askEntropy: askEntropy.toFixed(4),
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

  return async function entropyScorerTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(20);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: entropyHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
