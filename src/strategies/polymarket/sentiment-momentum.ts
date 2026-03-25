/**
 * Sentiment Momentum strategy for Polymarket binary markets.
 *
 * Detects rapid sentiment shifts by analyzing price action patterns that
 * indicate news-driven moves. When price moves rapidly in one direction
 * with increasing volume, it signals a sentiment shift that often continues
 * (momentum). Uses rate-of-change and volume confirmation.
 *
 * Signal logic:
 *   Track price snapshots with timestamps for each market.
 *   Calculate ROC = (price_now - price_n_ago) / price_n_ago over rocWindow.
 *   Calculate volume acceleration = tick volume vs average tick volume.
 *   Sentiment score = ROC * volumeRatio.
 *   Track sentiment score EMA for trend confirmation.
 *
 *   Entry: |sentimentScore| > sentimentThreshold AND EMA confirms direction
 *   Direction: positive sentiment -> BUY YES, negative -> BUY NO
 *   Anti-whipsaw: require sentiment to persist for minConfirmTicks.
 *
 * Exit conditions:
 *   - Take-profit: price moved takeProfitPct in our favour
 *   - Stop-loss:   price moved stopLossPct against us
 *   - Max hold:    position older than maxHoldMs
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface SentimentMomentumConfig {
  /** Number of snapshots for ROC calculation */
  rocWindow: number;
  /** Minimum volume ratio (current vs average) to confirm momentum */
  volumeRatioThreshold: number;
  /** Minimum |sentimentScore| to trigger entry */
  sentimentThreshold: number;
  /** EMA alpha for sentiment score smoothing */
  sentimentEmaAlpha: number;
  /** Consecutive ticks sentiment must persist before entry */
  minConfirmTicks: number;
  /** Minimum tick volume to consider a market */
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
  /** Trade size in USDC */
  positionSize: string;
  /** Max price snapshots to keep per market */
  maxSnapshotHistory: number;
}

export const DEFAULT_CONFIG: SentimentMomentumConfig = {
  rocWindow: 15,
  volumeRatioThreshold: 1.5,
  sentimentThreshold: 0.08,
  sentimentEmaAlpha: 0.15,
  minConfirmTicks: 3,
  minVolume: 8000,
  takeProfitPct: 0.045,
  stopLossPct: 0.025,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '15',
  maxSnapshotHistory: 100,
};

const STRATEGY_NAME: StrategyName = 'sentiment-momentum' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface PriceSnapshot {
  price: number;
  timestamp: number;
  volume: number;
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
 * Compute the rate of change over the last `window` snapshots.
 * ROC = (price_now - price_n_ago) / price_n_ago
 * Returns 0 if insufficient data.
 */
export function calcROC(snapshots: PriceSnapshot[], window: number): number {
  if (snapshots.length < 2 || window < 2) return 0;
  const n = Math.min(window, snapshots.length);
  const start = snapshots[snapshots.length - n].price;
  const end = snapshots[snapshots.length - 1].price;
  if (start === 0) return 0;
  return (end - start) / start;
}

/**
 * Compute volume ratio: current tick volume vs average volume across all snapshots.
 * Returns 0 if no snapshots or all volumes are zero.
 */
export function calcVolumeRatio(snapshots: PriceSnapshot[], currentVolume: number): number {
  if (snapshots.length === 0) return 0;
  let total = 0;
  for (const s of snapshots) {
    total += s.volume;
  }
  const avg = total / snapshots.length;
  if (avg === 0) return 0;
  return currentVolume / avg;
}

/**
 * Compute sentiment score = ROC * volumeRatio.
 */
export function calcSentimentScore(roc: number, volumeRatio: number): number {
  return roc * volumeRatio;
}

/**
 * Update EMA with new value.
 * EMA_new = alpha * value + (1 - alpha) * EMA_old
 * Returns the new EMA value.
 */
export function updateEMA(prevEma: number, value: number, alpha: number): number {
  return alpha * value + (1 - alpha) * prevEma;
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

/** Estimate tick volume from order book depth. */
function estimateVolume(book: RawOrderBook): number {
  let vol = 0;
  for (const b of book.bids) vol += parseFloat(b.size);
  for (const a of book.asks) vol += parseFloat(a.size);
  return vol;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface SentimentMomentumDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<SentimentMomentumConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createSentimentMomentumTick(deps: SentimentMomentumDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: SentimentMomentumConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Internal state
  const priceSnapshots = new Map<string, PriceSnapshot[]>();
  const sentimentEma = new Map<string, number>();
  const confirmCounter = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordSnapshot(tokenId: string, price: number, volume: number): void {
    let arr = priceSnapshots.get(tokenId);
    if (!arr) {
      arr = [];
      priceSnapshots.set(tokenId, arr);
    }
    arr.push({ price, timestamp: Date.now(), volume });
    if (arr.length > cfg.maxSnapshotHistory) {
      arr.splice(0, arr.length - cfg.maxSnapshotHistory);
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
        const vol = estimateVolume(book);
        recordSnapshot(pos.tokenId, currentMid, vol);
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

  async function scanEntries(): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    const events = await gamma.getEvents(10);

    for (const event of events) {
      if (positions.length >= cfg.maxPositions) break;

      const activeMarkets = event.markets.filter(
        (m: GammaMarket) => m.yesTokenId && !m.closed && !m.resolved && m.active,
      );

      for (const market of activeMarkets) {
        if (positions.length >= cfg.maxPositions) break;

        const yesTokenId = market.yesTokenId;
        if (!yesTokenId) continue;
        if (hasPositionFor(yesTokenId)) continue;
        if (market.noTokenId && hasPositionFor(market.noTokenId)) continue;
        if (isOnCooldown(yesTokenId)) continue;
        if (market.noTokenId && isOnCooldown(market.noTokenId)) continue;

        // Fetch order book
        let mid: number;
        let volume: number;
        try {
          const book = await clob.getOrderBook(yesTokenId);
          mid = bestMid(book);
          volume = estimateVolume(book);
          if (mid <= 0 || mid >= 1) continue;
          recordSnapshot(yesTokenId, mid, volume);
        } catch {
          continue;
        }

        // Check minimum volume
        if (volume < cfg.minVolume) continue;

        // Get snapshots
        const snapshots = priceSnapshots.get(yesTokenId);
        if (!snapshots || snapshots.length < cfg.rocWindow) continue;

        // Calculate ROC
        const roc = calcROC(snapshots, cfg.rocWindow);

        // Calculate volume ratio
        const volumeRatio = calcVolumeRatio(snapshots, volume);

        // Calculate sentiment score
        const sentimentScore = calcSentimentScore(roc, volumeRatio);

        // Update EMA
        const prevEma = sentimentEma.get(yesTokenId) ?? 0;
        const newEma = updateEMA(prevEma, sentimentScore, cfg.sentimentEmaAlpha);
        sentimentEma.set(yesTokenId, newEma);

        // Check threshold
        if (Math.abs(sentimentScore) <= cfg.sentimentThreshold) {
          confirmCounter.set(yesTokenId, 0);
          continue;
        }

        // Check EMA confirms direction (same sign)
        if ((sentimentScore > 0 && newEma <= 0) || (sentimentScore < 0 && newEma >= 0)) {
          confirmCounter.set(yesTokenId, 0);
          continue;
        }

        // Check volume ratio threshold
        if (volumeRatio < cfg.volumeRatioThreshold) {
          confirmCounter.set(yesTokenId, 0);
          continue;
        }

        // Anti-whipsaw: increment confirm counter
        const count = (confirmCounter.get(yesTokenId) ?? 0) + 1;
        confirmCounter.set(yesTokenId, count);
        if (count < cfg.minConfirmTicks) continue;

        // Determine direction
        const side: 'yes' | 'no' = sentimentScore > 0 ? 'yes' : 'no';
        const entryTokenId = side === 'yes' ? yesTokenId : (market.noTokenId ?? yesTokenId);

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
            conditionId: market.conditionId,
            side,
            entryPrice,
            sizeUsdc: posSize,
            orderId: order.id,
            openedAt: Date.now(),
          });

          logger.info('Entry sentiment-momentum', STRATEGY_NAME, {
            tokenId: entryTokenId,
            side,
            entryPrice: entryPrice.toFixed(4),
            sentimentScore: sentimentScore.toFixed(4),
            sentimentEma: newEma.toFixed(4),
            volumeRatio: volumeRatio.toFixed(2),
            roc: (roc * 100).toFixed(2) + '%',
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

          // Reset confirm counter after successful entry
          confirmCounter.set(yesTokenId, 0);
        } catch (err) {
          logger.debug('Entry failed', STRATEGY_NAME, {
            tokenId: entryTokenId,
            err: String(err),
          });
        }
      }
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function sentimentMomentumTick(): Promise<void> {
    try {
      await checkExits();
      await scanEntries();

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceSnapshots.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
