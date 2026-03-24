/**
 * Cross-Event Drift Catcher strategy for Polymarket binary markets.
 *
 * When one market in an event group moves significantly, other correlated
 * markets in that group should follow. This strategy catches the "drift" —
 * trading the lagging market expecting it to catch up to the leader.
 *
 * Signal logic:
 *   For each event group from gamma.getEvents(), track prices of all markets.
 *   Compute per-market returns over a short window (last 5 ticks).
 *
 *   Leader detection:  market with |return| > driftThreshold  (3%)
 *   Laggard detection: other markets in group with |return| < followThreshold (0.5%)
 *
 *   Entry: BUY YES on laggard if leader went up, BUY NO if leader went down
 *   Filter: minimum Pearson correlation between leader/laggard (0.3)
 *
 * Exit conditions:
 *   - Take-profit: price moved takeProfitPct in our favour
 *   - Stop-loss:   price moved stopLossPct against us
 *   - Max hold:    position older than maxHoldMs
 *   - Convergence: laggard caught up to within 50% of leader's move
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket, GammaMarketGroup } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface CrossEventDriftConfig {
  /** Min absolute return for a market to be considered "leader" */
  driftThreshold: number;
  /** Max absolute return for a market to be considered "laggard" */
  followThreshold: number;
  /** Min Pearson correlation between leader and laggard */
  minCorrelation: number;
  /** Ticks used for correlation calculation */
  lookbackPeriods: number;
  /** Ticks used for return calculation */
  returnWindow: number;
  /** Trade size in USDC */
  sizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction of entry price */
  takeProfitPct: number;
  /** Stop-loss as fraction of entry price */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max events to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: CrossEventDriftConfig = {
  driftThreshold: 0.03,
  followThreshold: 0.005,
  minCorrelation: 0.3,
  lookbackPeriods: 15,
  returnWindow: 5,
  sizeUsdc: 25,
  maxPositions: 5,
  takeProfitPct: 0.02,
  stopLossPct: 0.015,
  maxHoldMs: 10 * 60_000,
  cooldownMs: 90_000,
  scanLimit: 8,
};

const STRATEGY_NAME: StrategyName = 'cross-event-drift' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  leaderReturn: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Compute the return over the last `window` prices.
 * Return = (last - first) / first  over the trailing window.
 * Returns 0 if insufficient data.
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
 * Identify the leader (biggest absolute return exceeding driftThreshold)
 * and laggards (markets with |return| below followThreshold).
 */
export function findLeaderLaggards(
  marketReturns: Map<string, number>,
  driftThreshold: number,
  followThreshold: number,
): { leader: { id: string; ret: number } | null; laggards: string[] } {
  let leader: { id: string; ret: number } | null = null;

  // Find the market with the largest absolute return above driftThreshold
  for (const [id, ret] of marketReturns) {
    if (Math.abs(ret) >= driftThreshold) {
      if (!leader || Math.abs(ret) > Math.abs(leader.ret)) {
        leader = { id, ret };
      }
    }
  }

  if (!leader) return { leader: null, laggards: [] };

  // Laggards: all other markets with |return| < followThreshold
  const laggards: string[] = [];
  for (const [id, ret] of marketReturns) {
    if (id !== leader.id && Math.abs(ret) < followThreshold) {
      laggards.push(id);
    }
  }

  return { leader, laggards };
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

export interface CrossEventDriftDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<CrossEventDriftConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createCrossEventDriftTick(deps: CrossEventDriftDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: CrossEventDriftConfig = { ...DEFAULT_CONFIG, ...deps.config };

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
    if (arr.length > cfg.lookbackPeriods * 2) {
      arr.splice(0, arr.length - cfg.lookbackPeriods * 2);
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

      // Convergence: laggard caught up to within 50% of leader's move
      if (!shouldExit) {
        const history = priceHistory.get(pos.tokenId);
        if (history && history.length >= cfg.returnWindow) {
          const laggardReturn = calcReturn(history, cfg.returnWindow);
          // If laggard return is >= 50% of leader's original return magnitude, converged
          if (Math.abs(laggardReturn) >= Math.abs(pos.leaderReturn) * 0.5) {
            shouldExit = true;
            reason = `convergence (laggard=${(laggardReturn * 100).toFixed(2)}%, leader=${(pos.leaderReturn * 100).toFixed(2)}%)`;
          }
        }
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

      // Filter to active, open markets with YES tokens
      const activeMarkets = event.markets.filter(
        m => m.yesTokenId && !m.closed && !m.resolved && m.active,
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

      // Compute returns for all markets in this group
      const marketReturns = new Map<string, number>();
      for (const [tokenId] of marketMids) {
        const history = priceHistory.get(tokenId);
        if (!history || history.length < cfg.returnWindow) continue;
        const ret = calcReturn(history, cfg.returnWindow);
        marketReturns.set(tokenId, ret);
      }

      if (marketReturns.size < 2) continue;

      // Find leader and laggards
      const { leader, laggards } = findLeaderLaggards(
        marketReturns,
        cfg.driftThreshold,
        cfg.followThreshold,
      );

      if (!leader || laggards.length === 0) continue;

      // Trade each laggard
      for (const laggardId of laggards) {
        if (positions.length >= cfg.maxPositions) break;
        if (hasPositionFor(laggardId)) continue;
        if (isOnCooldown(laggardId)) continue;

        // Check correlation between leader and laggard
        const leaderHistory = priceHistory.get(leader.id)?.slice(-cfg.lookbackPeriods) ?? [];
        const laggardHistory = priceHistory.get(laggardId)?.slice(-cfg.lookbackPeriods) ?? [];
        const corr = calcCorrelation(leaderHistory, laggardHistory);
        if (corr < cfg.minCorrelation) continue;

        // Entry: BUY YES if leader went up, BUY NO if leader went down
        const side: 'yes' | 'no' = leader.ret > 0 ? 'yes' : 'no';

        // Find the GammaMarket for this laggard to get noTokenId
        const laggardMarket = activeMarkets.find(m => m.yesTokenId === laggardId);
        if (!laggardMarket) continue;

        const entryTokenId = side === 'yes' ? laggardId : (laggardMarket.noTokenId ?? laggardId);

        let entryPrice: number;
        try {
          const book = await clob.getOrderBook(entryTokenId);
          entryPrice = bestAsk(book);
        } catch {
          continue;
        }

        const posSize = kellySizer
          ? kellySizer.getSize(STRATEGY_NAME).size
          : cfg.sizeUsdc;

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
            conditionId: laggardMarket.conditionId,
            side,
            entryPrice,
            leaderReturn: leader.ret,
            sizeUsdc: posSize,
            orderId: order.id,
            openedAt: Date.now(),
          });

          logger.info('Entry drift', STRATEGY_NAME, {
            tokenId: entryTokenId,
            side,
            entryPrice: entryPrice.toFixed(4),
            leaderReturn: (leader.ret * 100).toFixed(2) + '%',
            correlation: corr.toFixed(3),
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
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function crossEventDriftTick(): Promise<void> {
    try {
      await checkExits();

      const events = await gamma.getEvents(cfg.scanLimit);

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
