/**
 * Decay Rate Momentum strategy for Polymarket binary markets.
 *
 * Measures the rate at which price momentum decays over time. Fast-decaying
 * momentum suggests a temporary spike (fade it). Slow-decaying momentum
 * suggests a genuine trend (follow it). Uses exponential decay curve fitting
 * on rolling momentum measurements.
 *
 * Signal logic:
 *   1. Calculate momentum at multiple lookback windows (e.g., 3, 5, 10, 15 ticks)
 *   2. Fit an exponential decay: momentum(t) ≈ A * exp(-lambda * t)
 *   3. High lambda (fast decay) → momentum is fading → counter-trend trade
 *   4. Low lambda (slow decay) → genuine momentum → trend-following trade
 *   5. When lambda < slowDecayThreshold → BUY YES if momentum positive, BUY NO if negative
 *   6. When lambda > fastDecayThreshold → fade: BUY NO if momentum positive, BUY YES if negative
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface DecayRateMomentumConfig {
  /** Multiple lookback windows for decay estimation */
  lookbackWindows: number[];
  /** Lambda below this = genuine trend (slow decay) */
  slowDecayThreshold: number;
  /** Lambda above this = fading spike (fast decay) */
  fastDecayThreshold: number;
  /** Minimum |momentum| to consider */
  minMomentumAbs: number;
  /** Number of price snapshots to retain */
  priceWindow: number;
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

export const DEFAULT_CONFIG: DecayRateMomentumConfig = {
  lookbackWindows: [3, 5, 10, 15],
  slowDecayThreshold: 0.05,
  fastDecayThreshold: 0.2,
  minMomentumAbs: 0.01,
  priceWindow: 20,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'decay-rate-momentum' as StrategyName;

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
 * Calculate momentum at a given lookback window.
 * momentum = (last - prices[length - window]) / prices[length - window]
 * Returns 0 if insufficient data or divisor is 0.
 */
export function calcMomentumAtWindow(prices: number[], window: number): number {
  if (prices.length < window || window <= 0) return 0;
  const reference = prices[prices.length - window];
  if (reference === 0) return 0;
  const last = prices[prices.length - 1];
  return (last - reference) / reference;
}

/**
 * Estimate the exponential decay rate (lambda) from a series of momentum values.
 * Simple estimate: lambda = -ln(last/first) / (length-1).
 * Clamped to [0, 1]. Returns 0 if invalid (e.g., negative ratio, length < 2).
 */
export function estimateDecayRate(momentums: number[]): number {
  if (momentums.length < 2) return 0;
  const first = momentums[0];
  const last = momentums[momentums.length - 1];
  if (first === 0) return 0;
  const ratio = last / first;
  if (ratio <= 0) return 0;
  const lambda = -Math.log(ratio) / (momentums.length - 1);
  // Clamp to [0, 1]
  if (lambda < 0) return 0;
  if (lambda > 1) return 1;
  return lambda;
}

/**
 * Classify the decay rate into 'slow', 'fast', or 'neutral'.
 */
export function classifyDecay(
  lambda: number,
  slowThreshold: number,
  fastThreshold: number,
): 'slow' | 'fast' | 'neutral' {
  if (lambda < slowThreshold) return 'slow';
  if (lambda > fastThreshold) return 'fast';
  return 'neutral';
}

/**
 * Determine the trading signal based on decay classification and latest momentum.
 * - slow decay + positive momentum → 'yes' (trend-following, buy YES)
 * - slow decay + negative momentum → 'no' (trend-following, buy NO)
 * - fast decay + positive momentum → 'no' (fade the spike, buy NO)
 * - fast decay + negative momentum → 'yes' (fade the spike, buy YES)
 * - neutral → null (no trade)
 */
export function determineSignal(
  decayClass: string,
  latestMomentum: number,
): 'yes' | 'no' | null {
  if (decayClass === 'slow') {
    return latestMomentum > 0 ? 'yes' : 'no';
  }
  if (decayClass === 'fast') {
    return latestMomentum > 0 ? 'no' : 'yes';
  }
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface DecayRateMomentumDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<DecayRateMomentumConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createDecayRateMomentumTick(deps: DecayRateMomentumDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: DecayRateMomentumConfig = { ...DEFAULT_CONFIG, ...deps.config };

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

        // Record price snapshot
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need enough data for largest lookback window
        const maxWindow = Math.max(...cfg.lookbackWindows);
        if (prices.length < maxWindow) continue;

        // Calculate momentum at each lookback window
        const momentums: number[] = [];
        for (const window of cfg.lookbackWindows) {
          momentums.push(calcMomentumAtWindow(prices, window));
        }

        // Check minimum momentum
        const latestMomentum = momentums[0]; // shortest window = most recent
        if (Math.abs(latestMomentum) < cfg.minMomentumAbs) continue;

        // Use absolute momentums for decay estimation
        const absMomentums = momentums.map(m => Math.abs(m));

        // Estimate decay rate
        const lambda = estimateDecayRate(absMomentums);

        // Classify decay
        const decayClass = classifyDecay(lambda, cfg.slowDecayThreshold, cfg.fastDecayThreshold);

        // Determine signal
        const signal = determineSignal(decayClass, latestMomentum);
        if (signal === null) continue;

        const side: 'yes' | 'no' = signal;
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
          lambda: lambda.toFixed(4),
          decayClass,
          latestMomentum: latestMomentum.toFixed(4),
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

  return async function decayRateMomentumTick(): Promise<void> {
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
