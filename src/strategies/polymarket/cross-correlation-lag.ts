/**
 * Cross-Correlation Lag strategy for Polymarket binary markets.
 *
 * Detects lagged correlations between markets — when market A's price changes
 * predict market B's future changes with a time lag. Uses cross-correlation
 * analysis to find lead-lag relationships, then trades the lagging market
 * based on the leading market's recent moves.
 *
 * Signal logic:
 *   1. For pairs of markets in the same event, compute cross-correlation at different lags
 *   2. Find the lag with maximum correlation
 *   3. If market A leads market B by k ticks, use A's recent k-tick move to predict B
 *   4. When predicted move > threshold → trade B in the predicted direction
 *   5. BUY YES on B if A moved up, BUY NO on B if A moved down
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface CrossCorrelationLagConfig {
  /** Maximum lag (in ticks) to test for cross-correlation */
  maxLag: number;
  /** Minimum absolute correlation to act on */
  minCorrelation: number;
  /** Minimum predicted move magnitude to trigger a trade */
  predictionThreshold: number;
  /** Number of price snapshots to retain per market */
  priceWindow: number;
  /** Minimum number of markets per event to consider */
  minMarketsPerEvent: number;
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

export const DEFAULT_CONFIG: CrossCorrelationLagConfig = {
  maxLag: 5,
  minCorrelation: 0.6,
  predictionThreshold: 0.02,
  priceWindow: 20,
  minMarketsPerEvent: 2,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'cross-correlation-lag' as StrategyName;

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
 * Standard Pearson correlation coefficient between two equal-length arrays.
 * Returns 0 if insufficient data (length < 2) or zero variance.
 */
export function calcPearsonCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let covXY = 0;
  let varX = 0;
  let varY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    covXY += dx * dy;
    varX += dx * dx;
    varY += dy * dy;
  }

  if (varX === 0 || varY === 0) return 0;

  return covXY / Math.sqrt(varX * varY);
}

/**
 * Cross-correlation between seriesA and seriesB at a given lag.
 * Positive lag means seriesA leads seriesB (A[i] correlates with B[i + lag]).
 * Returns 0 if insufficient overlapping data.
 */
export function calcCrossCorrelation(seriesA: number[], seriesB: number[], lag: number): number {
  if (lag < 0) return 0;
  const n = Math.min(seriesA.length, seriesB.length) - lag;
  if (n < 2) return 0;

  const a = seriesA.slice(0, n);
  const b = seriesB.slice(lag, lag + n);
  return calcPearsonCorrelation(a, b);
}

/**
 * Find the lag (from 1..maxLag) with the highest absolute correlation
 * between seriesA and seriesB.
 */
export function findBestLag(
  seriesA: number[],
  seriesB: number[],
  maxLag: number,
): { lag: number; correlation: number } {
  let bestLag = 0;
  let bestCorr = 0;

  for (let lag = 1; lag <= maxLag; lag++) {
    const corr = calcCrossCorrelation(seriesA, seriesB, lag);
    if (Math.abs(corr) > Math.abs(bestCorr)) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  return { lag: bestLag, correlation: bestCorr };
}

/**
 * Predict the expected move of the lagging market based on the leading
 * market's price change over the last `lag` ticks.
 * Returns the leader's move = last price - price `lag` ticks ago.
 * Returns 0 if insufficient data.
 */
export function predictMove(leaderPrices: number[], lag: number): number {
  if (lag <= 0 || leaderPrices.length < lag + 1) return 0;
  return leaderPrices[leaderPrices.length - 1] - leaderPrices[leaderPrices.length - 1 - lag];
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface CrossCorrelationLagDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<CrossCorrelationLagConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createCrossCorrelationLagTick(deps: CrossCorrelationLagDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: CrossCorrelationLagConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

    // Keep only priceWindow snapshots
    if (history.length > cfg.priceWindow) {
      history.splice(0, history.length - cfg.priceWindow);
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

  async function scanEntries(eventMarkets: GammaMarket[][]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const markets of eventMarkets) {
      if (positions.length >= cfg.maxPositions) break;

      // Filter to eligible markets
      const eligible = markets.filter(m =>
        m.yesTokenId && !m.closed && !m.resolved && (m.volume ?? 0) >= cfg.minVolume,
      );

      if (eligible.length < cfg.minMarketsPerEvent) continue;

      // Fetch orderbooks and record prices
      const marketPrices = new Map<string, { market: GammaMarket; mid: number; bid: number; ask: number }>();

      for (const market of eligible) {
        try {
          const book = await clob.getOrderBook(market.yesTokenId);
          const ba = bestBidAsk(book);
          if (ba.mid <= 0 || ba.mid >= 1) continue;
          recordPrice(market.yesTokenId, ba.mid);
          marketPrices.set(market.yesTokenId, { market, ...ba });
        } catch {
          continue;
        }
      }

      // Check all pairs for lead-lag relationships
      const tokenIds = Array.from(marketPrices.keys());
      for (let i = 0; i < tokenIds.length; i++) {
        if (positions.length >= cfg.maxPositions) break;

        for (let j = 0; j < tokenIds.length; j++) {
          if (i === j) continue;
          if (positions.length >= cfg.maxPositions) break;

          const leaderTokenId = tokenIds[i];
          const followerTokenId = tokenIds[j];
          const leaderPrices = getPrices(leaderTokenId);
          const followerPrices = getPrices(followerTokenId);

          // Need enough data for cross-correlation
          if (leaderPrices.length < cfg.maxLag + 2) continue;
          if (followerPrices.length < cfg.maxLag + 2) continue;

          const { lag, correlation } = findBestLag(leaderPrices, followerPrices, cfg.maxLag);
          if (lag === 0 || Math.abs(correlation) < cfg.minCorrelation) continue;

          // Use leader's recent move to predict follower
          const predicted = predictMove(leaderPrices, lag);
          if (Math.abs(predicted) < cfg.predictionThreshold) continue;

          // Check if we can trade the follower
          if (hasPosition(followerTokenId)) continue;
          const followerInfo = marketPrices.get(followerTokenId);
          if (!followerInfo) continue;
          if (isOnCooldown(followerTokenId)) continue;

          // Determine direction: positive correlation + positive leader move → BUY YES
          // positive correlation + negative leader move → BUY NO
          // negative correlation flips the direction
          const effectiveMove = correlation > 0 ? predicted : -predicted;
          const side: 'yes' | 'no' = effectiveMove > 0 ? 'yes' : 'no';
          const tokenId = side === 'yes'
            ? followerTokenId
            : (followerInfo.market.noTokenId ?? followerTokenId);
          const entryPrice = side === 'yes' ? followerInfo.ask : (1 - followerInfo.bid);
          const posSize = parseFloat(cfg.positionSize);

          try {
            const order = await orderManager.placeOrder({
              tokenId,
              side: 'buy',
              price: entryPrice.toFixed(4),
              size: String(Math.round(posSize / entryPrice)),
              orderType: 'GTC',
            });

            positions.push({
              tokenId,
              conditionId: followerInfo.market.conditionId,
              side,
              entryPrice,
              sizeUsdc: posSize,
              orderId: order.id,
              openedAt: Date.now(),
            });

            logger.info('Entry position', STRATEGY_NAME, {
              conditionId: followerInfo.market.conditionId,
              side,
              entryPrice: entryPrice.toFixed(4),
              leaderTokenId,
              followerTokenId,
              lag,
              correlation: correlation.toFixed(4),
              predictedMove: predicted.toFixed(4),
              size: posSize.toFixed(2),
            });

            eventBus.emit('trade.executed', {
              trade: {
                orderId: order.id,
                marketId: followerInfo.market.conditionId,
                side: 'buy',
                fillPrice: String(entryPrice),
                fillSize: String(posSize),
                fees: '0',
                timestamp: Date.now(),
                strategy: STRATEGY_NAME,
              },
            });
          } catch (err) {
            logger.debug('Entry order failed', STRATEGY_NAME, {
              followerTokenId,
              err: String(err),
            });
          }
        }
      }
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function crossCorrelationLagTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover event groups with their markets
      const events = await gamma.getEvents(15);

      // 3. Group markets per event
      const eventMarkets: GammaMarket[][] = events
        .map(e => e.markets)
        .filter(m => m.length >= cfg.minMarketsPerEvent);

      // 4. Scan for entries
      await scanEntries(eventMarkets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
