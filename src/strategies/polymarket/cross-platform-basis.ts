/**
 * Cross-Platform Basis strategy for Polymarket binary markets.
 *
 * Exploits price discrepancies between Polymarket and synthetic "fair values"
 * derived from market data. Compares on-chain price with a model-based fair
 * value estimate.
 *
 * Signal logic:
 *   1. For each market, get the current mid price from orderbook
 *   2. Calculate a "model fair value" using multiple signals:
 *      - recent price EMA
 *      - volume-weighted price
 *      - reversion-to-mean component
 *   3. fairValue = w_ema * priceEma + w_vwap * estimatedVwap + w_mean * 0.5
 *   4. basis = mid - fairValue
 *   5. When |basis| > basisThreshold → trade toward fair value
 *   6. If mid > fairValue (overpriced) → BUY NO. If mid < fairValue (underpriced) → BUY YES
 *   7. Track basis history with EMA for trend confirmation
 *   8. Require basis to be widening (current > EMA) for entry
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface CrossPlatformBasisConfig {
  /** Weight for price EMA in fair value calculation */
  w_ema: number;
  /** Weight for VWAP estimate in fair value calculation */
  w_vwap: number;
  /** Weight for mean-reversion component (toward 0.5) */
  w_mean: number;
  /** Alpha for price EMA (0 < alpha < 1) */
  emaAlpha: number;
  /** Minimum |basis| to trigger a signal */
  basisThreshold: number;
  /** Alpha for basis EMA tracking */
  basisEmaAlpha: number;
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

export const DEFAULT_CONFIG: CrossPlatformBasisConfig = {
  w_ema: 0.5,
  w_vwap: 0.3,
  w_mean: 0.2,
  emaAlpha: 0.1,
  basisThreshold: 0.03,
  basisEmaAlpha: 0.15,
  priceWindow: 30,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'cross-platform-basis' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface PriceSnapshot {
  price: number;
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
 * Calculate model fair value from price EMA, estimated VWAP, and mean-reversion component.
 * fairValue = w_ema * priceEma + w_vwap * estimatedVwap + w_mean * 0.5
 */
export function calcFairValue(
  priceEma: number,
  estimatedVwap: number,
  config: Pick<CrossPlatformBasisConfig, 'w_ema' | 'w_vwap' | 'w_mean'>,
): number {
  return config.w_ema * priceEma + config.w_vwap * estimatedVwap + config.w_mean * 0.5;
}

/**
 * Calculate basis = mid - fairValue.
 * Positive basis means mid is above fair value (overpriced).
 * Negative basis means mid is below fair value (underpriced).
 */
export function calcBasis(mid: number, fairValue: number): number {
  return mid - fairValue;
}

/**
 * Update an exponential moving average with a simple alpha-based formula.
 * newEma = alpha * newValue + (1 - alpha) * prevEma
 * Returns newValue when there is no previous EMA (initial case).
 */
export function updateBasisEma(prevEma: number | null, newValue: number, alpha: number): number {
  if (prevEma === null) return newValue;
  if (alpha <= 0) return prevEma;
  if (alpha >= 1) return newValue;
  return alpha * newValue + (1 - alpha) * prevEma;
}

/**
 * Update a price EMA using the same alpha-based formula.
 */
function updatePriceEma(prevEma: number | null, price: number, alpha: number): number {
  if (prevEma === null) return price;
  if (alpha <= 0) return prevEma;
  if (alpha >= 1) return price;
  return alpha * price + (1 - alpha) * prevEma;
}

/**
 * Estimate a VWAP from price/volume snapshots.
 * Returns simple average of prices if total volume is 0.
 */
function estimateVwap(snapshots: PriceSnapshot[]): number {
  if (snapshots.length === 0) return 0.5;

  let totalVolume = 0;
  let volumeWeightedPrice = 0;

  for (const snap of snapshots) {
    volumeWeightedPrice += snap.price * snap.volume;
    totalVolume += snap.volume;
  }

  if (totalVolume === 0) {
    // Fallback to simple average
    let sum = 0;
    for (const snap of snapshots) sum += snap.price;
    return sum / snapshots.length;
  }

  return volumeWeightedPrice / totalVolume;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface CrossPlatformBasisDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<CrossPlatformBasisConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createCrossPlatformBasisTick(deps: CrossPlatformBasisDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: CrossPlatformBasisConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, PriceSnapshot[]>();
  const priceEmaState = new Map<string, number>();
  const basisEmaState = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordPrice(tokenId: string, price: number, volume: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push({ price, volume, timestamp: Date.now() });

    // Keep only priceWindow snapshots
    if (history.length > cfg.priceWindow) {
      history.splice(0, history.length - cfg.priceWindow);
    }
  }

  function getSnapshots(tokenId: string): PriceSnapshot[] {
    return priceHistory.get(tokenId) ?? [];
  }

  function updatePriceEmaState(tokenId: string, price: number): number {
    const prev = priceEmaState.get(tokenId) ?? null;
    const ema = updatePriceEma(prev, price, cfg.emaAlpha);
    priceEmaState.set(tokenId, ema);
    return ema;
  }

  function updateBasisEmaState(tokenId: string, basis: number): number {
    const prev = basisEmaState.get(tokenId) ?? null;
    const ema = updateBasisEma(prev, Math.abs(basis), cfg.basisEmaAlpha);
    basisEmaState.set(tokenId, ema);
    return ema;
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

        // Estimate volume from book depth
        const bookVolume = book.bids.reduce((s, l) => s + parseFloat(l.size), 0)
          + book.asks.reduce((s, l) => s + parseFloat(l.size), 0);

        // Record price snapshot
        recordPrice(market.yesTokenId, ba.mid, bookVolume);
        const snapshots = getSnapshots(market.yesTokenId);

        // Need at least 2 snapshots for meaningful EMA + VWAP
        if (snapshots.length < 2) continue;

        // Update price EMA
        const priceEma = updatePriceEmaState(market.yesTokenId, ba.mid);

        // Estimate VWAP from history
        const vwap = estimateVwap(snapshots);

        // Calculate fair value
        const fairValue = calcFairValue(priceEma, vwap, cfg);

        // Calculate basis
        const basis = calcBasis(ba.mid, fairValue);

        // Update basis EMA
        const basisEma = updateBasisEmaState(market.yesTokenId, basis);

        // Check threshold
        if (Math.abs(basis) < cfg.basisThreshold) continue;

        // Require basis to be widening: |current basis| > basis EMA
        if (Math.abs(basis) <= basisEma) continue;

        // Determine signal
        // mid > fairValue → overpriced → BUY NO
        // mid < fairValue → underpriced → BUY YES
        const side: 'yes' | 'no' = basis < 0 ? 'yes' : 'no';
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
          fairValue: fairValue.toFixed(4),
          basis: basis.toFixed(4),
          basisEma: basisEma.toFixed(4),
          priceEma: priceEma.toFixed(4),
          vwap: vwap.toFixed(4),
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

  return async function crossPlatformBasisTick(): Promise<void> {
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
