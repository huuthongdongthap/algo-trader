/**
 * Pairs / Statistical Arbitrage strategy for Polymarket binary markets.
 *
 * Identifies pairs of correlated markets (e.g. related political events) and
 * trades mean reversion of their price spread. When the spread between two
 * historically correlated markets deviates beyond a z-score threshold, the
 * strategy goes long the undervalued leg and short the overvalued leg,
 * expecting convergence.
 *
 * Signal logic:
 *   spread      = priceA - priceB
 *   spreadMean  = SMA(spread, lookback)
 *   spreadStd   = StdDev(spread, lookback)
 *   zSpread     = (spread - spreadMean) / spreadStd
 *
 *   zSpread > +threshold  → BUY NO on A + BUY YES on B  (A overpriced, B underpriced)
 *   zSpread < -threshold  → BUY YES on A + BUY NO on B  (A underpriced, B overpriced)
 *
 * Pair discovery: uses GammaClient.getEvents() to find market groups (events)
 * containing multiple related binary markets. Markets within the same event
 * are natural pair candidates.
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket, GammaMarketGroup } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface PairsStatArbConfig {
  /** Minimum ticks before computing z-score */
  lookbackPeriods: number;
  /** Min absolute z-score of spread to trigger entry */
  zScoreThreshold: number;
  /** Min correlation coefficient to consider a valid pair */
  minCorrelation: number;
  /** Trade size per leg in USDC */
  sizeUsdc: number;
  /** Max concurrent pair positions */
  maxPositions: number;
  /** Take-profit: exit when z-score crosses back within this band */
  takeProfitZ: number;
  /** Stop-loss: exit when z-score expands beyond this */
  stopLossZ: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Per-pair cooldown after exit (ms) */
  cooldownMs: number;
  /** Max events to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: PairsStatArbConfig = {
  lookbackPeriods: 25,
  zScoreThreshold: 2.0,
  minCorrelation: 0.5,
  sizeUsdc: 25,
  maxPositions: 4,
  takeProfitZ: 0.5,
  stopLossZ: 3.5,
  maxHoldMs: 15 * 60_000,
  cooldownMs: 120_000,
  scanLimit: 10,
};

const STRATEGY_NAME: StrategyName = 'pairs-stat-arb';

// ── Internal types ───────────────────────────────────────────────────────────

interface SpreadTick {
  spreadValue: number;
  priceA: number;
  priceB: number;
  timestamp: number;
}

interface PairPosition {
  pairKey: string;
  legA: { tokenId: string; conditionId: string; side: 'yes' | 'no'; entryPrice: number; orderId: string };
  legB: { tokenId: string; conditionId: string; side: 'yes' | 'no'; entryPrice: number; orderId: string };
  entryZScore: number;
  sizeUsdc: number;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Create a canonical key for a market pair (order-independent). */
export function pairKey(tokenIdA: string, tokenIdB: string): string {
  return tokenIdA < tokenIdB ? `${tokenIdA}:${tokenIdB}` : `${tokenIdB}:${tokenIdA}`;
}

/** Compute Pearson correlation coefficient between two price series. */
export function calcCorrelation(pricesA: number[], pricesB: number[]): number {
  const n = Math.min(pricesA.length, pricesB.length);
  if (n < 3) return 0;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += pricesA[i]; sumB += pricesB[i]; }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let cov = 0, varA = 0, varB = 0;
  for (let i = 0; i < n; i++) {
    const dA = pricesA[i] - meanA;
    const dB = pricesB[i] - meanB;
    cov += dA * dB;
    varA += dA * dA;
    varB += dB * dB;
  }

  const denom = Math.sqrt(varA * varB);
  if (denom === 0) return 0;
  return cov / denom;
}

/** Compute z-score of the current spread value relative to spread history. */
export function calcSpreadZScore(spreads: number[]): number {
  if (spreads.length < 3) return 0;
  const n = spreads.length;
  const mean = spreads.reduce((s, v) => s + v, 0) / n;
  const variance = spreads.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (spreads[n - 1] - mean) / std;
}

/** Compute rolling mean of spread values. */
export function calcSpreadMean(spreads: number[]): number {
  if (spreads.length === 0) return 0;
  return spreads.reduce((s, v) => s + v, 0) / spreads.length;
}

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

/** Extract best bid from raw order book. */
function bestBid(book: RawOrderBook): number {
  return book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface PairsStatArbDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<PairsStatArbConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createPairsStatArbTick(deps: PairsStatArbDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: PairsStatArbConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-pair state
  const spreadHistory = new Map<string, SpreadTick[]>();
  const priceHistoryA = new Map<string, number[]>();
  const priceHistoryB = new Map<string, number[]>();
  const positions: PairPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordSpread(key: string, priceA: number, priceB: number): void {
    let history = spreadHistory.get(key);
    if (!history) {
      history = [];
      spreadHistory.set(key, history);
    }
    history.push({ spreadValue: priceA - priceB, priceA, priceB, timestamp: Date.now() });
    if (history.length > cfg.lookbackPeriods * 2) {
      history.splice(0, history.length - cfg.lookbackPeriods * 2);
    }
  }

  function recordPrice(map: Map<string, number[]>, key: string, price: number): void {
    let arr = map.get(key);
    if (!arr) {
      arr = [];
      map.set(key, arr);
    }
    arr.push(price);
    if (arr.length > cfg.lookbackPeriods * 2) {
      arr.splice(0, arr.length - cfg.lookbackPeriods * 2);
    }
  }

  function getSpreadWindow(key: string): number[] {
    const history = spreadHistory.get(key);
    if (!history) return [];
    return history.slice(-cfg.lookbackPeriods).map(t => t.spreadValue);
  }

  function isOnCooldown(key: string): boolean {
    const until = cooldowns.get(key) ?? 0;
    return Date.now() < until;
  }

  function hasPositionFor(key: string): boolean {
    return positions.some(p => p.pairKey === key);
  }

  // ── Exit logic ─────────────────────────────────────────────────────────

  async function checkExits(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      let shouldExit = false;
      let reason = '';

      // Fetch current prices for both legs
      let midA: number, midB: number;
      try {
        const [bookA, bookB] = await Promise.all([
          clob.getOrderBook(pos.legA.tokenId),
          clob.getOrderBook(pos.legB.tokenId),
        ]);
        midA = bestMid(bookA);
        midB = bestMid(bookB);
        recordSpread(pos.pairKey, midA, midB);
      } catch {
        continue;
      }

      // Current z-score of spread
      const spreads = getSpreadWindow(pos.pairKey);
      const z = calcSpreadZScore(spreads);

      // Take-profit: spread returned to mean (z near 0)
      if (Math.abs(z) <= cfg.takeProfitZ) {
        shouldExit = true;
        reason = `take-profit (z=${z.toFixed(2)}, spread converged)`;
      }

      // Stop-loss: spread diverged further
      if (!shouldExit) {
        if (pos.entryZScore > 0 && z > cfg.stopLossZ) {
          shouldExit = true;
          reason = `stop-loss (z=${z.toFixed(2)}, spread expanded)`;
        } else if (pos.entryZScore < 0 && z < -cfg.stopLossZ) {
          shouldExit = true;
          reason = `stop-loss (z=${z.toFixed(2)}, spread expanded)`;
        }
      }

      // Max hold time
      if (!shouldExit && now - pos.openedAt > cfg.maxHoldMs) {
        shouldExit = true;
        reason = 'max hold time';
      }

      if (shouldExit) {
        try {
          // Exit leg A
          const exitSideA = pos.legA.side === 'yes' ? 'sell' : 'buy';
          await orderManager.placeOrder({
            tokenId: pos.legA.tokenId,
            side: exitSideA,
            price: midA.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / midA)),
            orderType: 'IOC',
          });

          // Exit leg B
          const exitSideB = pos.legB.side === 'yes' ? 'sell' : 'buy';
          await orderManager.placeOrder({
            tokenId: pos.legB.tokenId,
            side: exitSideB,
            price: midB.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / midB)),
            orderType: 'IOC',
          });

          const pnlA = pos.legA.side === 'yes'
            ? (midA - pos.legA.entryPrice) : (pos.legA.entryPrice - midA);
          const pnlB = pos.legB.side === 'yes'
            ? (midB - pos.legB.entryPrice) : (pos.legB.entryPrice - midB);
          const totalPnl = (pnlA + pnlB) * (pos.sizeUsdc / ((pos.legA.entryPrice + pos.legB.entryPrice) / 2));

          logger.info('Exit pair', STRATEGY_NAME, {
            pairKey: pos.pairKey,
            pnl: totalPnl.toFixed(4),
            reason,
          });

          eventBus.emit('trade.executed', {
            trade: {
              orderId: `${pos.legA.orderId}+${pos.legB.orderId}`,
              marketId: pos.pairKey,
              side: 'sell',
              fillPrice: `${midA}/${midB}`,
              fillSize: String(pos.sizeUsdc * 2),
              fees: '0',
              timestamp: Date.now(),
              strategy: STRATEGY_NAME,
            },
          });

          cooldowns.set(pos.pairKey, now + cfg.cooldownMs);
          toRemove.push(i);
        } catch (err) {
          logger.warn('Exit failed', STRATEGY_NAME, { pairKey: pos.pairKey, err: String(err) });
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

      // Filter to active, open markets with YES tokens
      const activeMarkets = event.markets.filter(
        m => m.yesTokenId && !m.closed && !m.resolved && m.active,
      );
      if (activeMarkets.length < 2) continue;

      // Generate pairs from markets within this event
      for (let a = 0; a < activeMarkets.length - 1 && positions.length < cfg.maxPositions; a++) {
        for (let b = a + 1; b < activeMarkets.length && positions.length < cfg.maxPositions; b++) {
          const mA = activeMarkets[a];
          const mB = activeMarkets[b];
          const key = pairKey(mA.yesTokenId, mB.yesTokenId);

          if (hasPositionFor(key)) continue;
          if (isOnCooldown(key)) continue;

          try {
            const [bookA, bookB] = await Promise.all([
              clob.getOrderBook(mA.yesTokenId),
              clob.getOrderBook(mB.yesTokenId),
            ]);

            const midA = bestMid(bookA);
            const midB = bestMid(bookB);
            if (midA <= 0 || midA >= 1 || midB <= 0 || midB >= 1) continue;

            recordPrice(priceHistoryA, key, midA);
            recordPrice(priceHistoryB, key, midB);
            recordSpread(key, midA, midB);

            // Need enough history
            const spreads = getSpreadWindow(key);
            if (spreads.length < cfg.lookbackPeriods) continue;

            // Check correlation
            const pA = priceHistoryA.get(key)?.slice(-cfg.lookbackPeriods) ?? [];
            const pB = priceHistoryB.get(key)?.slice(-cfg.lookbackPeriods) ?? [];
            const corr = calcCorrelation(pA, pB);
            if (Math.abs(corr) < cfg.minCorrelation) continue;

            // Compute spread z-score
            const z = calcSpreadZScore(spreads);
            if (Math.abs(z) < cfg.zScoreThreshold) continue;

            // Entry signal
            // z > threshold → A overpriced relative to B → short A, long B
            // z < -threshold → A underpriced relative to B → long A, short B
            const sideA: 'yes' | 'no' = z > 0 ? 'no' : 'yes';
            const sideB: 'yes' | 'no' = z > 0 ? 'yes' : 'no';

            const tokenIdA = sideA === 'yes' ? mA.yesTokenId : (mA.noTokenId ?? mA.yesTokenId);
            const tokenIdB = sideB === 'yes' ? mB.yesTokenId : (mB.noTokenId ?? mB.yesTokenId);

            const entryPriceA = sideA === 'yes' ? bestAsk(bookA) : (1 - bestBid(bookA));
            const entryPriceB = sideB === 'yes' ? bestAsk(bookB) : (1 - bestBid(bookB));

            const posSize = kellySizer
              ? kellySizer.getSize(STRATEGY_NAME).size
              : cfg.sizeUsdc;

            const [orderA, orderB] = await Promise.all([
              orderManager.placeOrder({
                tokenId: tokenIdA,
                side: 'buy',
                price: entryPriceA.toFixed(4),
                size: String(Math.round(posSize / entryPriceA)),
                orderType: 'GTC',
              }),
              orderManager.placeOrder({
                tokenId: tokenIdB,
                side: 'buy',
                price: entryPriceB.toFixed(4),
                size: String(Math.round(posSize / entryPriceB)),
                orderType: 'GTC',
              }),
            ]);

            positions.push({
              pairKey: key,
              legA: { tokenId: tokenIdA, conditionId: mA.conditionId, side: sideA, entryPrice: entryPriceA, orderId: orderA.id },
              legB: { tokenId: tokenIdB, conditionId: mB.conditionId, side: sideB, entryPrice: entryPriceB, orderId: orderB.id },
              entryZScore: z,
              sizeUsdc: posSize,
              openedAt: Date.now(),
            });

            logger.info('Entry pair', STRATEGY_NAME, {
              pairKey: key,
              legA: { conditionId: mA.conditionId, side: sideA, price: entryPriceA.toFixed(4) },
              legB: { conditionId: mB.conditionId, side: sideB, price: entryPriceB.toFixed(4) },
              zScore: z.toFixed(2),
              correlation: corr.toFixed(3),
              size: posSize,
            });

            eventBus.emit('trade.executed', {
              trade: {
                orderId: `${orderA.id}+${orderB.id}`,
                marketId: key,
                side: 'buy',
                fillPrice: `${entryPriceA}/${entryPriceB}`,
                fillSize: String(posSize * 2),
                fees: '0',
                timestamp: Date.now(),
                strategy: STRATEGY_NAME,
              },
            });
          } catch (err) {
            logger.debug('Pair scan error', STRATEGY_NAME, {
              pair: key,
              err: String(err),
            });
          }
        }
      }
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function pairsStatArbTick(): Promise<void> {
    try {
      await checkExits();

      const events = await gamma.getEvents(cfg.scanLimit);

      await scanEntries(events);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedPairs: spreadHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
