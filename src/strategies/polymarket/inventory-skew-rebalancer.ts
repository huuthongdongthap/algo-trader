/**
 * Inventory Skew Rebalancer strategy for Polymarket.
 *
 * A portfolio-level strategy that monitors aggregate exposure across all
 * active positions and rebalances when skew exceeds thresholds. Prevents
 * concentration risk by:
 *   1. Tracking all open positions across markets (tokenId, side, size, currentPrice)
 *   2. Computing portfolio-level skew: (yesExposure - noExposure) / totalExposure
 *   3. Trimming overweight positions and adding to underweight ones when |skew| > threshold
 *   4. Enforcing per-market concentration limits
 *   5. Only trimming positions with positive unrealised P&L (don't sell losers)
 */
import type { ClobClient } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface InventorySkewRebalancerConfig {
  /** Absolute skew threshold to trigger rebalance — range (0, 1] */
  skewThreshold: number;
  /** Max fraction of total portfolio any single position may occupy */
  maxConcentrationPct: number;
  /** Fraction of an overweight position to sell when trimming */
  trimPct: number;
  /** Minimum unrealised P&L (USDC) before a position may be trimmed */
  minPnlToTrim: number;
  /** Minimum interval between rebalance passes (ms) */
  rebalanceIntervalMs: number;
  /** Max number of trades placed per rebalance pass */
  maxTradesPerRebalance: number;
  /** Default position size (USDC string) for the buy side of rebalance */
  positionSize: string;
}

const DEFAULT_CONFIG: InventorySkewRebalancerConfig = {
  skewThreshold: 0.3,
  maxConcentrationPct: 0.4,
  trimPct: 0.25,
  minPnlToTrim: 0.01,
  rebalanceIntervalMs: 60_000,
  maxTradesPerRebalance: 3,
  positionSize: '10',
};

const STRATEGY_NAME = 'inventory-skew-rebalancer' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface TrackedPosition {
  tokenId: string;
  side: 'yes' | 'no';
  size: number;
  entryPrice: number;
  currentPrice: number;
  marketId: string;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Calculate portfolio skew: (yesExposure - noExposure) / totalExposure. Returns 0 when empty. */
export function calcSkew(positions: TrackedPosition[]): number {
  let yesExposure = 0;
  let noExposure = 0;
  for (const p of positions) {
    const value = p.size * p.currentPrice;
    if (p.side === 'yes') {
      yesExposure += value;
    } else {
      noExposure += value;
    }
  }
  const total = yesExposure + noExposure;
  if (total === 0) return 0;
  return (yesExposure - noExposure) / total;
}

/** Calculate the concentration of a single position relative to total exposure. */
export function calcConcentration(position: TrackedPosition, positions: TrackedPosition[]): number {
  const total = positions.reduce((sum, p) => sum + p.size * p.currentPrice, 0);
  if (total === 0) return 0;
  return (position.size * position.currentPrice) / total;
}

/** Determine whether a rebalance should occur given current skew and elapsed time. */
export function shouldRebalance(
  skew: number,
  skewThreshold: number,
  lastRebalanceAt: number,
  rebalanceIntervalMs: number,
  now: number,
): boolean {
  if (now - lastRebalanceAt < rebalanceIntervalMs) return false;
  return Math.abs(skew) > skewThreshold;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface InventorySkewRebalancerDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<InventorySkewRebalancerConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createInventorySkewRebalancerTick(
  deps: InventorySkewRebalancerDeps,
): () => Promise<void> {
  const { clob, orderManager, eventBus } = deps;
  const cfg: InventorySkewRebalancerConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Portfolio state — populated via eventBus listener
  const positions: TrackedPosition[] = [];
  let lastRebalanceAt = 0;

  // Listen for trade executions to track positions
  eventBus.on('trade.executed', (payload: any) => {
    const trade = payload.trade ?? payload;
    const tokenId: string = trade.tokenId ?? trade.marketId;
    const side: 'yes' | 'no' = trade.side === 'buy' ? 'yes' : 'no';
    const size = parseFloat(trade.fillSize ?? trade.size ?? '0');
    const price = parseFloat(trade.fillPrice ?? trade.price ?? '0');
    const marketId: string = trade.marketId ?? tokenId;

    if (size <= 0) return;

    // Upsert: if we already track this tokenId+side, add to size
    const existing = positions.find(p => p.tokenId === tokenId && p.side === side);
    if (existing) {
      // Weighted-average entry price
      const totalOldValue = existing.size * existing.entryPrice;
      existing.size += size;
      existing.entryPrice = (totalOldValue + size * price) / existing.size;
    } else {
      positions.push({
        tokenId,
        side,
        size,
        entryPrice: price,
        currentPrice: price,
        marketId,
      });
    }
  });

  // ── Helpers ──────────────────────────────────────────────────────────────

  async function refreshPrices(): Promise<void> {
    for (const pos of positions) {
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
        const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
        pos.currentPrice = (bid + ask) / 2;
      } catch {
        // keep previous price
      }
    }
  }

  function unrealizedPnl(pos: TrackedPosition): number {
    return pos.size * (pos.currentPrice - pos.entryPrice);
  }

  // ── Rebalance logic ────────────────────────────────────────────────────

  async function rebalance(): Promise<void> {
    const now = Date.now();
    const skew = calcSkew(positions);

    if (!shouldRebalance(skew, cfg.skewThreshold, lastRebalanceAt, cfg.rebalanceIntervalMs, now)) {
      return;
    }

    lastRebalanceAt = now;
    let tradesPlaced = 0;

    // Determine which side is overweight
    const overweightSide: 'yes' | 'no' = skew > 0 ? 'yes' : 'no';
    const underweightSide: 'yes' | 'no' = skew > 0 ? 'no' : 'yes';

    // Sort overweight positions by value descending (trim largest first)
    const overweight = positions
      .filter(p => p.side === overweightSide)
      .sort((a, b) => b.size * b.currentPrice - a.size * a.currentPrice);

    for (const pos of overweight) {
      if (tradesPlaced >= cfg.maxTradesPerRebalance) break;

      const pnl = unrealizedPnl(pos);
      if (pnl < cfg.minPnlToTrim) continue;

      const trimSize = pos.size * cfg.trimPct;
      if (trimSize <= 0) continue;

      try {
        await orderManager.placeOrder({
          tokenId: pos.tokenId,
          side: 'sell',
          price: pos.currentPrice.toFixed(4),
          size: String(trimSize),
          orderType: 'IOC',
        });

        pos.size -= trimSize;
        tradesPlaced++;

        logger.info('Trimmed overweight position', STRATEGY_NAME, {
          tokenId: pos.tokenId,
          side: pos.side,
          trimSize,
          remaining: pos.size,
          pnl: pnl.toFixed(4),
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: `rebal-${now}-${tradesPlaced}`,
            marketId: pos.marketId,
            side: 'sell',
            fillPrice: String(pos.currentPrice),
            fillSize: String(trimSize),
            fees: '0',
            timestamp: now,
            strategy: STRATEGY_NAME,
          },
        });
      } catch (err) {
        logger.warn('Trim order failed', STRATEGY_NAME, {
          tokenId: pos.tokenId,
          err: String(err),
        });
      }
    }

    // Buy underweight side if we still have trade budget
    if (tradesPlaced < cfg.maxTradesPerRebalance) {
      const underweight = positions.filter(p => p.side === underweightSide);
      // Pick the position with lowest concentration to add to (spread risk)
      const sorted = underweight.sort(
        (a, b) => calcConcentration(a, positions) - calcConcentration(b, positions),
      );

      for (const pos of sorted) {
        if (tradesPlaced >= cfg.maxTradesPerRebalance) break;

        const buySize = parseFloat(cfg.positionSize);
        if (buySize <= 0) continue;

        try {
          await orderManager.placeOrder({
            tokenId: pos.tokenId,
            side: 'buy',
            price: pos.currentPrice.toFixed(4),
            size: String(buySize),
            orderType: 'IOC',
          });

          pos.size += buySize;
          tradesPlaced++;

          logger.info('Added to underweight position', STRATEGY_NAME, {
            tokenId: pos.tokenId,
            side: pos.side,
            addedSize: buySize,
            newSize: pos.size,
          });
        } catch (err) {
          logger.warn('Buy order failed', STRATEGY_NAME, {
            tokenId: pos.tokenId,
            err: String(err),
          });
        }
      }
    }

    // Remove positions with negligible size
    for (let i = positions.length - 1; i >= 0; i--) {
      if (positions[i].size < 1e-9) {
        positions.splice(i, 1);
      }
    }
  }

  // ── Concentration check ────────────────────────────────────────────────

  async function checkConcentration(): Promise<void> {
    const now = Date.now();
    let tradesPlaced = 0;

    for (const pos of positions) {
      if (tradesPlaced >= cfg.maxTradesPerRebalance) break;

      const concentration = calcConcentration(pos, positions);
      if (concentration <= cfg.maxConcentrationPct) continue;

      const pnl = unrealizedPnl(pos);
      if (pnl < cfg.minPnlToTrim) continue;

      const trimSize = pos.size * cfg.trimPct;
      if (trimSize <= 0) continue;

      try {
        await orderManager.placeOrder({
          tokenId: pos.tokenId,
          side: 'sell',
          price: pos.currentPrice.toFixed(4),
          size: String(trimSize),
          orderType: 'IOC',
        });

        pos.size -= trimSize;
        tradesPlaced++;

        logger.info('Trimmed concentrated position', STRATEGY_NAME, {
          tokenId: pos.tokenId,
          concentration: concentration.toFixed(4),
          trimSize,
          remaining: pos.size,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: `conc-${now}-${tradesPlaced}`,
            marketId: pos.marketId,
            side: 'sell',
            fillPrice: String(pos.currentPrice),
            fillSize: String(trimSize),
            fees: '0',
            timestamp: now,
            strategy: STRATEGY_NAME,
          },
        });
      } catch (err) {
        logger.warn('Concentration trim failed', STRATEGY_NAME, {
          tokenId: pos.tokenId,
          err: String(err),
        });
      }
    }
  }

  // ── Main tick ────────────────────────────────────────────────────────────

  return async function inventorySkewRebalancerTick(): Promise<void> {
    try {
      if (positions.length === 0) {
        logger.debug('No positions to rebalance', STRATEGY_NAME, {});
        return;
      }

      await refreshPrices();
      await checkConcentration();
      await rebalance();

      logger.debug('Tick complete', STRATEGY_NAME, {
        positionCount: positions.length,
        skew: calcSkew(positions).toFixed(4),
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
