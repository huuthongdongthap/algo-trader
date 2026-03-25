/**
 * Volatility Surface Arbitrage strategy for Polymarket binary markets.
 *
 * Exploits mispricing between correlated markets by comparing their implied
 * volatilities. When two related markets (same event) have divergent implied
 * vols, the strategy trades the convergence.
 *
 * Signal logic:
 *   For each event group from gamma.getEvents(), get all active markets.
 *   Calculate implied vol for each market using a simplified binary option
 *   vol formula:  impliedVol = price * (1 - price) / sqrt(daysToExpiry)
 *
 *   For pairs of markets in the same event, compute vol spread = |vol_A - vol_B|.
 *   Track vol spread history with an EMA.
 *
 *   When vol spread > spreadThreshold AND spread is widening (above EMA):
 *     → buy the market with lower implied vol (the "cheaper vol" side)
 *
 *   Entry requires minimum price correlation between the pair over a
 *   configurable lookback window.
 *
 * Exit conditions:
 *   - Take-profit: price moved takeProfitPct in our favour
 *   - Stop-loss:   price moved stopLossPct against us
 *   - Max hold:    position older than maxHoldMs
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarketGroup } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface VolatilitySurfaceArbConfig {
  /** Minimum vol spread to trigger entry */
  spreadThreshold: number;
  /** EMA smoothing factor for spread history */
  emaAlpha: number;
  /** Number of ticks for price correlation window */
  corrWindow: number;
  /** Minimum price correlation between paired markets */
  minCorrelation: number;
  /** Minimum 24h volume to consider a market */
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
  /** Trade size in USDC (string for order compat) */
  positionSize: string;
}

const DEFAULT_CONFIG: VolatilitySurfaceArbConfig = {
  spreadThreshold: 0.03,
  emaAlpha: 0.1,
  corrWindow: 20,
  minCorrelation: 0.3,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 30 * 60_000,
  maxPositions: 3,
  cooldownMs: 180_000,
  positionSize: '12',
};

const STRATEGY_NAME: StrategyName = 'volatility-surface-arb' as StrategyName;

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
 * Compute implied volatility for a binary option market.
 * Uses the simplified formula: price * (1 - price) / sqrt(daysToExpiry).
 * Returns 0 if daysToExpiry <= 0 or price is out of (0, 1) range.
 */
export function calcImpliedVol(price: number, daysToExpiry: number): number {
  if (daysToExpiry <= 0) return 0;
  if (price <= 0 || price >= 1) return 0;
  return (price * (1 - price)) / Math.sqrt(daysToExpiry);
}

/**
 * Compute the absolute vol spread between two markets.
 */
export function calcVolSpread(volA: number, volB: number): number {
  return Math.abs(volA - volB);
}

/**
 * Update an EMA with a new value.
 * If previous EMA is null (first value), returns the raw value.
 */
export function updateEma(prevEma: number | null, value: number, alpha: number): number {
  if (prevEma === null) return value;
  return alpha * value + (1 - alpha) * prevEma;
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
 * Compute days remaining from now to an end date string.
 */
export function daysToExpiry(endDate: string, now?: number): number {
  const end = new Date(endDate).getTime();
  const current = now ?? Date.now();
  const diffMs = end - current;
  return diffMs / (24 * 60 * 60 * 1000);
}

/**
 * Generate a stable pair key from two token IDs (order-independent).
 */
export function pairKey(tokenA: string, tokenB: string): string {
  return tokenA < tokenB ? `${tokenA}:${tokenB}` : `${tokenB}:${tokenA}`;
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

export interface VolatilitySurfaceArbDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<VolatilitySurfaceArbConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createVolatilitySurfaceArbTick(deps: VolatilitySurfaceArbDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: VolatilitySurfaceArbConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Internal state
  const volHistory = new Map<string, number[]>();
  const spreadEma = new Map<string, number>();
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
    if (arr.length > cfg.corrWindow * 2) {
      arr.splice(0, arr.length - cfg.corrWindow * 2);
    }
  }

  function recordVol(tokenId: string, vol: number): void {
    let arr = volHistory.get(tokenId);
    if (!arr) {
      arr = [];
      volHistory.set(tokenId, arr);
    }
    arr.push(vol);
    if (arr.length > cfg.corrWindow * 2) {
      arr.splice(0, arr.length - cfg.corrWindow * 2);
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

      // Filter to active, open markets with YES tokens and sufficient volume
      const activeMarkets = event.markets.filter(
        m => m.yesTokenId && !m.closed && !m.resolved && m.active && m.volume24h >= cfg.minVolume,
      );
      if (activeMarkets.length < 2) continue;

      // Fetch prices and compute implied vol for all markets in this group
      const marketVols = new Map<string, number>();
      const marketMids = new Map<string, number>();

      for (const m of activeMarkets) {
        try {
          const book = await clob.getOrderBook(m.yesTokenId);
          const mid = bestMid(book);
          if (mid <= 0 || mid >= 1) continue;
          recordPrice(m.yesTokenId, mid);
          marketMids.set(m.yesTokenId, mid);

          const dte = daysToExpiry(m.endDate);
          const vol = calcImpliedVol(mid, dte);
          if (vol <= 0) continue;
          recordVol(m.yesTokenId, vol);
          marketVols.set(m.yesTokenId, vol);
        } catch {
          continue;
        }
      }

      if (marketVols.size < 2) continue;

      // Compare all pairs within this event
      const tokenIds = Array.from(marketVols.keys());
      for (let a = 0; a < tokenIds.length; a++) {
        if (positions.length >= cfg.maxPositions) break;
        for (let b = a + 1; b < tokenIds.length; b++) {
          if (positions.length >= cfg.maxPositions) break;

          const tokenA = tokenIds[a];
          const tokenB = tokenIds[b];
          const volA = marketVols.get(tokenA)!;
          const volB = marketVols.get(tokenB)!;

          const spread = calcVolSpread(volA, volB);
          if (spread < cfg.spreadThreshold) continue;

          // Update spread EMA
          const pk = pairKey(tokenA, tokenB);
          const prevEma = spreadEma.get(pk) ?? null;
          const newEma = updateEma(prevEma, spread, cfg.emaAlpha);
          spreadEma.set(pk, newEma);

          // Spread must be widening (above EMA) — skip if first data point (prevEma was null)
          if (prevEma === null) continue;
          if (spread <= newEma) continue;

          // Check price correlation
          const histA = priceHistory.get(tokenA)?.slice(-cfg.corrWindow) ?? [];
          const histB = priceHistory.get(tokenB)?.slice(-cfg.corrWindow) ?? [];
          const corr = calcCorrelation(histA, histB);
          if (corr < cfg.minCorrelation) continue;

          // Identify the cheaper vol side (lower implied vol)
          const cheaperTokenId = volA < volB ? tokenA : tokenB;

          if (hasPositionFor(cheaperTokenId)) continue;
          if (isOnCooldown(cheaperTokenId)) continue;

          // Find the GammaMarket for the cheaper vol token
          const targetMarket = activeMarkets.find(m => m.yesTokenId === cheaperTokenId);
          if (!targetMarket) continue;

          // Buy YES on the cheaper vol market
          const entryTokenId = cheaperTokenId;
          let entryPrice: number;
          try {
            const book = await clob.getOrderBook(entryTokenId);
            entryPrice = bestAsk(book);
          } catch {
            continue;
          }

          const posSize = parseFloat(cfg.positionSize);

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
              conditionId: targetMarket.conditionId,
              side: 'yes',
              entryPrice,
              sizeUsdc: posSize,
              orderId: order.id,
              openedAt: Date.now(),
            });

            logger.info('Entry vol-arb', STRATEGY_NAME, {
              tokenId: entryTokenId,
              entryPrice: entryPrice.toFixed(4),
              volSpread: spread.toFixed(4),
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
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function volatilitySurfaceArbTick(): Promise<void> {
    try {
      await checkExits();

      const events = await gamma.getEvents();

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
