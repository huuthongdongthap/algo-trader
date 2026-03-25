/**
 * Funding Rate Arbitrage strategy for Polymarket binary markets.
 *
 * In prediction markets, when a binary outcome trades at some price, the
 * "implied funding" for holding that position is the opportunity cost vs
 * the risk-free rate. When correlated CEX perpetual contracts have high
 * funding rates, it creates a basis trade opportunity.
 *
 * Signal logic:
 *   1. For each market, calculate implied yield = (1 - price) / timeToResolution (annualized)
 *   2. Compare with a synthetic "funding rate" derived from recent price velocity and OI changes
 *   3. When implied yield > fundingThreshold AND price velocity is mean-reverting → BUY YES
 *   4. When implied yield < -fundingThreshold AND price velocity accelerating away → BUY NO
 *   5. Track funding rate history with exponential decay (halfLifeMs)
 *   6. Require minimum OI (volume proxy) from gamma client
 *   7. Use adaptive position sizing based on funding rate magnitude
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface FundingRateArbConfig {
  /** Annualized yield threshold to trigger signal */
  fundingThreshold: number;
  /** Half-life in ms for exponential moving average of funding rate */
  halfLifeMs: number;
  /** Minimum implied yield (annualized) to consider a market */
  minImpliedYield: number;
  /** Number of price snapshots for velocity calculation */
  velocityWindow: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (0.035 = 3.5%) */
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

export const DEFAULT_CONFIG: FundingRateArbConfig = {
  fundingThreshold: 0.15,
  halfLifeMs: 300_000,
  minImpliedYield: 0.05,
  velocityWindow: 20,
  minVolume: 10_000,
  takeProfitPct: 0.035,
  stopLossPct: 0.02,
  maxHoldMs: 30 * 60_000,
  maxPositions: 4,
  cooldownMs: 180_000,
  positionSize: '15',
};

const STRATEGY_NAME: StrategyName = 'funding-rate-arb';

// ── Internal types ───────────────────────────────────────────────────────────

export interface PriceSnapshot {
  price: number;
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

/** Milliseconds in a year (365.25 days). */
const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/**
 * Calculate annualized implied yield from a YES token price and time to resolution.
 * impliedYield = (1 - price) / (timeToResolutionMs / MS_PER_YEAR)
 * Returns 0 when timeToResolution <= 0 or price is out of (0, 1).
 */
export function calcImpliedYield(price: number, timeToResolutionMs: number): number {
  if (price <= 0 || price >= 1) return 0;
  if (timeToResolutionMs <= 0) return 0;
  const yearsToResolution = timeToResolutionMs / MS_PER_YEAR;
  return (1 - price) / yearsToResolution;
}

/**
 * Calculate price velocity from a series of price snapshots.
 * Uses simple linear regression slope over the window.
 * Returns the annualized rate of price change.
 */
export function calcPriceVelocity(snapshots: PriceSnapshot[]): number {
  if (snapshots.length < 2) return 0;

  const n = snapshots.length;
  const t0 = snapshots[0].timestamp;

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const snap of snapshots) {
    const x = (snap.timestamp - t0) / MS_PER_YEAR; // time in years
    const y = snap.price;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumXX += x * x;
  }

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * Update an exponential moving average with a new sample.
 * decay = exp(-ln(2) * dt / halfLife)
 */
export function updateEma(prevEma: number, newValue: number, dtMs: number, halfLifeMs: number): number {
  if (halfLifeMs <= 0) return newValue;
  const decay = Math.exp(-Math.LN2 * dtMs / halfLifeMs);
  return decay * prevEma + (1 - decay) * newValue;
}

/**
 * Determine whether velocity is mean-reverting (slowing down / reversing)
 * or accelerating. Compares first-half velocity to second-half velocity.
 * Returns true if the price is mean-reverting (velocity decreasing in magnitude).
 */
export function isMeanReverting(snapshots: PriceSnapshot[]): boolean {
  if (snapshots.length < 4) return false;

  const mid = Math.floor(snapshots.length / 2);
  const firstHalf = snapshots.slice(0, mid);
  const secondHalf = snapshots.slice(mid);

  const v1 = calcPriceVelocity(firstHalf);
  const v2 = calcPriceVelocity(secondHalf);

  // Mean-reverting: magnitude of velocity is decreasing or direction reversed
  return Math.abs(v2) < Math.abs(v1) || (v1 > 0 && v2 < 0) || (v1 < 0 && v2 > 0);
}

/**
 * Determine entry signal based on implied yield, funding rate EMA, and velocity.
 */
export function shouldEnter(
  impliedYield: number,
  fundingEma: number,
  meanReverting: boolean,
  config: FundingRateArbConfig,
): 'buy-yes' | 'buy-no' | null {
  if (Math.abs(impliedYield) < config.minImpliedYield) return null;

  // BUY YES: high implied yield + mean-reverting velocity → price likely to recover toward 1
  if (impliedYield > config.fundingThreshold && fundingEma > config.fundingThreshold && meanReverting) {
    return 'buy-yes';
  }

  // BUY NO: negative implied yield signal + accelerating away → price likely to drop toward 0
  if (impliedYield < -config.fundingThreshold && fundingEma < -config.fundingThreshold && !meanReverting) {
    return 'buy-no';
  }

  return null;
}

/**
 * Calculate adaptive position size based on funding rate magnitude.
 * Scales linearly from 0.5x to 1.5x of base size.
 */
export function adaptiveSize(baseSizeUsdc: number, fundingEma: number, threshold: number): number {
  const magnitude = Math.abs(fundingEma);
  const scale = Math.min(1.5, 0.5 + (magnitude / threshold));
  return baseSizeUsdc * scale;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface FundingRateArbDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<FundingRateArbConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createFundingRateArbTick(deps: FundingRateArbDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: FundingRateArbConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, PriceSnapshot[]>();
  const fundingRateEma = new Map<string, number>();
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

    // Keep only velocityWindow snapshots
    if (history.length > cfg.velocityWindow) {
      history.splice(0, history.length - cfg.velocityWindow);
    }
  }

  function getSnapshots(tokenId: string): PriceSnapshot[] {
    return priceHistory.get(tokenId) ?? [];
  }

  function updateFundingEma(tokenId: string, newRate: number): number {
    const prev = fundingRateEma.get(tokenId) ?? newRate;
    const snapshots = getSnapshots(tokenId);
    const dtMs = snapshots.length >= 2
      ? snapshots[snapshots.length - 1].timestamp - snapshots[snapshots.length - 2].timestamp
      : cfg.halfLifeMs; // default to half-life for first sample
    const ema = updateEma(prev, newRate, dtMs, cfg.halfLifeMs);
    fundingRateEma.set(tokenId, ema);
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

        // Record price snapshot
        recordPrice(market.yesTokenId, ba.mid);
        const snapshots = getSnapshots(market.yesTokenId);

        // Calculate time to resolution
        const endDate = market.endDate ? new Date(market.endDate).getTime() : 0;
        const timeToResolutionMs = endDate - Date.now();
        if (timeToResolutionMs <= 0) continue;

        // Calculate implied yield
        const impliedYield = calcImpliedYield(ba.mid, timeToResolutionMs);

        // Calculate price velocity as synthetic funding rate
        const velocity = calcPriceVelocity(snapshots);

        // Update funding rate EMA
        const ema = updateFundingEma(market.yesTokenId, impliedYield + velocity);

        // Check mean-reversion
        const meanReverting = isMeanReverting(snapshots);

        // Determine signal
        const signal = shouldEnter(impliedYield, ema, meanReverting, cfg);
        if (!signal) continue;

        // Determine token and price
        const side: 'yes' | 'no' = signal === 'buy-yes' ? 'yes' : 'no';
        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

        // Adaptive position sizing
        const baseSizeUsdc = parseFloat(cfg.positionSize);
        const posSize = adaptiveSize(baseSizeUsdc, ema, cfg.fundingThreshold);

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
          impliedYield: impliedYield.toFixed(4),
          fundingEma: ema.toFixed(4),
          velocity: velocity.toFixed(4),
          meanReverting,
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

  return async function fundingRateArbTick(): Promise<void> {
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
