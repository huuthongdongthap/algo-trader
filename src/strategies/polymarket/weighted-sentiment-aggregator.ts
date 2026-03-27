/**
 * Weighted Sentiment Aggregator strategy for Polymarket binary markets.
 *
 * Aggregates multiple market microstructure signals (book imbalance, price
 * velocity, volume trend) into a single weighted sentiment score. Trades
 * when the composite score exceeds a threshold, providing higher confidence
 * than any individual signal.
 *
 * Signal logic:
 *   1. Calculate book imbalance = (bidSize - askSize) / (bidSize + askSize)
 *   2. Calculate price velocity = (current - prev) / prev over short window
 *   3. Calculate volume trend = current volume / avg volume
 *   4. Composite score = w_imbalance * imbalance + w_velocity * velocity + w_volume * (volumeTrend - 1)
 *   5. When score > threshold → BUY YES, score < -threshold → BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface WeightedSentimentAggregatorConfig {
  /** Weight for book imbalance signal */
  wImbalance: number;
  /** Weight for price velocity signal */
  wVelocity: number;
  /** Weight for volume trend signal */
  wVolume: number;
  /** Composite score threshold for entry */
  scoreThreshold: number;
  /** Number of price snapshots for velocity calculation */
  velocityWindow: number;
  /** Number of volume snapshots for average calculation */
  volumeWindow: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (0.025 = 2.5%) */
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

export const DEFAULT_CONFIG: WeightedSentimentAggregatorConfig = {
  wImbalance: 0.4,
  wVelocity: 0.35,
  wVolume: 0.25,
  scoreThreshold: 0.15,
  velocityWindow: 5,
  volumeWindow: 10,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'weighted-sentiment-aggregator' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

interface PriceSnapshot {
  price: number;
  timestamp: number;
}

interface VolumeSnapshot {
  volume: number;
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
 * Calculate book imbalance from bid and ask sizes.
 * Returns (bidSize - askSize) / (bidSize + askSize), or 0 if both are 0.
 */
export function calcBookImbalance(bidSize: number, askSize: number): number {
  const total = bidSize + askSize;
  if (total === 0) return 0;
  return (bidSize - askSize) / total;
}

/**
 * Calculate price velocity from a window of prices.
 * Returns (last - first) / first, or 0 if fewer than 2 prices or first is 0.
 */
export function calcPriceVelocity(prices: number[]): number {
  if (prices.length < 2) return 0;
  const first = prices[0];
  if (first === 0) return 0;
  const last = prices[prices.length - 1];
  return (last - first) / first;
}

/**
 * Calculate volume trend as current volume relative to average.
 * Returns currentVol / avgVol, or 0 if avgVol is 0.
 */
export function calcVolumeTrend(currentVol: number, avgVol: number): number {
  if (avgVol === 0) return 0;
  return currentVol / avgVol;
}

/**
 * Calculate composite sentiment score from individual signals.
 * score = wImbalance * imbalance + wVelocity * velocity + wVolume * (volumeTrend - 1)
 */
export function calcCompositeScore(
  imbalance: number,
  velocity: number,
  volumeTrend: number,
  config: Pick<WeightedSentimentAggregatorConfig, 'wImbalance' | 'wVelocity' | 'wVolume'>,
): number {
  return (
    config.wImbalance * imbalance +
    config.wVelocity * velocity +
    config.wVolume * (volumeTrend - 1)
  );
}

/**
 * Determine trade signal from composite score and threshold.
 * Returns 'yes' if score > threshold, 'no' if score < -threshold, null otherwise.
 */
export function determineSignal(score: number, threshold: number): 'yes' | 'no' | null {
  if (score > threshold) return 'yes';
  if (score < -threshold) return 'no';
  return null;
}

/** Extract best bid/ask/mid and sizes from raw order book. */
function bestBidAsk(book: RawOrderBook): {
  bid: number; ask: number; mid: number;
  bidSize: number; askSize: number;
} {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  const bidSize = book.bids.reduce((s, l) => s + parseFloat(l.size), 0);
  const askSize = book.asks.reduce((s, l) => s + parseFloat(l.size), 0);
  return { bid, ask, mid: (bid + ask) / 2, bidSize, askSize };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface WeightedSentimentAggregatorDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<WeightedSentimentAggregatorConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createWeightedSentimentAggregatorTick(
  deps: WeightedSentimentAggregatorDeps,
): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: WeightedSentimentAggregatorConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, PriceSnapshot[]>();
  const volumeHistory = new Map<string, VolumeSnapshot[]>();
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

    if (history.length > cfg.velocityWindow) {
      history.splice(0, history.length - cfg.velocityWindow);
    }
  }

  function recordVolume(tokenId: string, volume: number): void {
    let history = volumeHistory.get(tokenId);
    if (!history) {
      history = [];
      volumeHistory.set(tokenId, history);
    }
    history.push({ volume, timestamp: Date.now() });

    if (history.length > cfg.volumeWindow) {
      history.splice(0, history.length - cfg.volumeWindow);
    }
  }

  function getPrices(tokenId: string): number[] {
    return (priceHistory.get(tokenId) ?? []).map(s => s.price);
  }

  function getAvgVolume(tokenId: string): number {
    const history = volumeHistory.get(tokenId) ?? [];
    if (history.length === 0) return 0;
    let sum = 0;
    for (const s of history) sum += s.volume;
    return sum / history.length;
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

        // Record price and volume
        recordPrice(market.yesTokenId, ba.mid);
        const bookVolume = ba.bidSize + ba.askSize;
        recordVolume(market.yesTokenId, bookVolume);

        // Get signal components
        const imbalance = calcBookImbalance(ba.bidSize, ba.askSize);
        const prices = getPrices(market.yesTokenId);
        const velocity = calcPriceVelocity(prices);
        const avgVol = getAvgVolume(market.yesTokenId);
        const volumeTrend = calcVolumeTrend(bookVolume, avgVol);

        // Calculate composite score
        const score = calcCompositeScore(imbalance, velocity, volumeTrend, cfg);

        // Determine signal
        const signal = determineSignal(score, cfg.scoreThreshold);
        if (signal === null) continue;

        const tokenId = signal === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = signal === 'yes' ? ba.ask : (1 - ba.bid);

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
          side: signal,
          entryPrice,
          sizeUsdc: posSize,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side: signal,
          entryPrice: entryPrice.toFixed(4),
          score: score.toFixed(4),
          imbalance: imbalance.toFixed(4),
          velocity: velocity.toFixed(4),
          volumeTrend: volumeTrend.toFixed(4),
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

  return async function weightedSentimentAggregatorTick(): Promise<void> {
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
