/**
 * Kalman Filter Tracker strategy for Polymarket binary markets.
 *
 * Uses a 1D Kalman filter to estimate the "true" price from noisy orderbook
 * data. When the filter's prediction diverges significantly from the observed
 * price (large normalized innovation), it trades the convergence back to the
 * estimated fair value.
 *
 * Signal logic:
 *   1. Maintain a Kalman filter state per market: estimated price (x), estimation error covariance (P)
 *   2. Predict step: x_pred = x, P_pred = P + processNoise (Q)
 *   3. Update step: innovation = observed_mid - x_pred, S = P_pred + R,
 *      K = P_pred / S, x_new = x_pred + K * innovation, P_new = (1 - K) * P_pred
 *   4. Signal: when |innovation| / sqrt(S) > innovationThreshold (normalized innovation)
 *   5. Direction: innovation > 0 → price jumped up unexpectedly → will revert → BUY NO.
 *      innovation < 0 → BUY YES
 *   6. Track innovation history for regime detection
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface KalmanFilterTrackerConfig {
  /** Process noise covariance (Q) — how much we expect the true price to drift per tick */
  processNoise: number;
  /** Measurement noise covariance (R) — how noisy the orderbook mid is */
  measurementNoise: number;
  /** Normalized innovation threshold to trigger a trade */
  innovationThreshold: number;
  /** Minimum number of ticks before the filter is considered warmed up */
  minTicks: number;
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

export const DEFAULT_CONFIG: KalmanFilterTrackerConfig = {
  processNoise: 0.0001,
  measurementNoise: 0.001,
  innovationThreshold: 2.0,
  minTicks: 10,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 10 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'kalman-filter-tracker' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface KalmanState {
  /** Estimated price */
  x: number;
  /** Estimation error covariance */
  P: number;
  /** Number of ticks processed */
  ticks: number;
  /** Recent innovation values for regime detection */
  innovationHistory: number[];
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
 * Kalman predict step.
 * x_pred = x (constant-velocity model, no control input)
 * P_pred = P + Q
 */
export function kalmanPredict(x: number, P: number, Q: number): { xPred: number; pPred: number } {
  return {
    xPred: x,
    pPred: P + Q,
  };
}

/**
 * Kalman update step.
 * innovation = observation - x_pred
 * S = P_pred + R
 * K = P_pred / S
 * x_new = x_pred + K * innovation
 * P_new = (1 - K) * P_pred
 */
export function kalmanUpdate(
  xPred: number,
  pPred: number,
  observation: number,
  R: number,
): { x: number; P: number; innovation: number; S: number; K: number } {
  const innovation = observation - xPred;
  const S = pPred + R;
  const K = S > 0 ? pPred / S : 0;
  const x = xPred + K * innovation;
  const P = (1 - K) * pPred;
  return { x, P, innovation, S, K };
}

/**
 * Calculate the normalized innovation (Mahalanobis-like distance in 1D).
 * Returns |innovation| / sqrt(S).
 * Returns 0 when S <= 0.
 */
export function calcNormalizedInnovation(innovation: number, S: number): number {
  if (S <= 0) return 0;
  return Math.abs(innovation) / Math.sqrt(S);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface KalmanFilterTrackerDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<KalmanFilterTrackerConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createKalmanFilterTrackerTick(deps: KalmanFilterTrackerDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: KalmanFilterTrackerConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market Kalman state
  const kalmanStates = new Map<string, KalmanState>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function getOrCreateState(tokenId: string, initPrice: number): KalmanState {
    let state = kalmanStates.get(tokenId);
    if (!state) {
      state = {
        x: initPrice,
        P: cfg.measurementNoise, // initialize covariance to measurement noise
        ticks: 0,
        innovationHistory: [],
      };
      kalmanStates.set(tokenId, state);
    }
    return state;
  }

  function tickState(tokenId: string, observation: number): {
    state: KalmanState;
    innovation: number;
    S: number;
    normalizedInnovation: number;
  } {
    const state = getOrCreateState(tokenId, observation);

    // Predict
    const { xPred, pPred } = kalmanPredict(state.x, state.P, cfg.processNoise);

    // Update
    const updated = kalmanUpdate(xPred, pPred, observation, cfg.measurementNoise);

    const normalizedInnovation = calcNormalizedInnovation(updated.innovation, updated.S);

    // Store updated state
    state.x = updated.x;
    state.P = updated.P;
    state.ticks += 1;

    // Track innovation history (keep last 50)
    state.innovationHistory.push(updated.innovation);
    if (state.innovationHistory.length > 50) {
      state.innovationHistory.splice(0, state.innovationHistory.length - 50);
    }

    return { state, innovation: updated.innovation, S: updated.S, normalizedInnovation };
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

      try {
        // Fetch orderbook for YES token
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        // Run Kalman filter tick
        const { state, innovation, S, normalizedInnovation } = tickState(market.yesTokenId, ba.mid);

        // Need minimum ticks for filter warmup
        if (state.ticks < cfg.minTicks) continue;

        // Check if normalized innovation exceeds threshold
        if (normalizedInnovation <= cfg.innovationThreshold) continue;

        // Determine direction:
        // innovation > 0 → observed price jumped UP unexpectedly → expect revert DOWN → BUY NO
        // innovation < 0 → observed price dropped unexpectedly → expect revert UP → BUY YES
        const side: 'yes' | 'no' = innovation < 0 ? 'yes' : 'no';
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

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
          normalizedInnovation: normalizedInnovation.toFixed(4),
          innovation: innovation.toFixed(6),
          kalmanEstimate: state.x.toFixed(4),
          ticks: state.ticks,
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

  return async function kalmanFilterTrackerTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: kalmanStates.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
