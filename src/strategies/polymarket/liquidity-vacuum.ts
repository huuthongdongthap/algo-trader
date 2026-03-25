/**
 * Liquidity Vacuum strategy for Polymarket binary markets.
 *
 * Detects sudden liquidity drops in the orderbook and trades the snap-back.
 * When total resting liquidity drops sharply below its recent average, it
 * indicates a temporary vacuum that often fills quickly.
 *
 * Signal logic:
 *   1. Calculate total liquidity per market: sum of all bid sizes + all ask sizes
 *   2. Track liquidity history with rolling average (liquidityWindow ticks)
 *   3. Detect vacuum: currentLiquidity < avgLiquidity * vacuumRatio (e.g., 0.3 = 70% drop)
 *   4. When vacuum detected on one side (bids or asks), price is dislocated
 *   5. If bid liquidity dropped more → price will recover up → BUY YES
 *   6. If ask liquidity dropped more → price will recover down → BUY NO
 *   7. Require midPrice is not at extremes (0.10–0.90 range)
 *   8. Anti-stale: only trade if vacuum detected in the last vacuumFreshnessMs
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface LiquidityVacuumConfig {
  /** Rolling window length for liquidity history */
  liquidityWindow: number;
  /** Ratio threshold — vacuum detected when current < avg * vacuumRatio */
  vacuumRatio: number;
  /** Minimum average liquidity to consider a market (filters illiquid) */
  minAvgLiquidity: number;
  /** Max age of a vacuum event before it's considered stale (ms) */
  vacuumFreshnessMs: number;
  /** Lower bound of mid-price range for entry */
  priceRangeLow: number;
  /** Upper bound of mid-price range for entry */
  priceRangeHigh: number;
  /** Take-profit as fraction */
  takeProfitPct: number;
  /** Stop-loss as fraction */
  stopLossPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Trade size in USDC */
  positionSize: string;
}

const DEFAULT_CONFIG: LiquidityVacuumConfig = {
  liquidityWindow: 30,
  vacuumRatio: 0.3,
  minAvgLiquidity: 1000,
  vacuumFreshnessMs: 30_000,
  priceRangeLow: 0.10,
  priceRangeHigh: 0.90,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 5 * 60_000,
  maxPositions: 4,
  cooldownMs: 60_000,
  positionSize: '10',
};

const STRATEGY_NAME: StrategyName = 'liquidity-vacuum' as StrategyName;

// ── Internal types ──────────────────────────────────────────────────────────

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

interface VacuumEvent {
  timestamp: number;
  bidLiquidity: number;
  askLiquidity: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Calculate total liquidity from an order book (sum of all bid sizes + all ask sizes).
 */
export function calcTotalLiquidity(book: RawOrderBook): number {
  let total = 0;
  for (const level of book.bids) {
    total += parseFloat(level.size);
  }
  for (const level of book.asks) {
    total += parseFloat(level.size);
  }
  return total;
}

/**
 * Calculate the bid-to-ask liquidity ratio.
 * Returns { bidLiquidity, askLiquidity, ratio }.
 * ratio = bidLiquidity / (bidLiquidity + askLiquidity).
 * Returns ratio 0.5 if both are 0.
 */
export function calcBidAskLiquidityRatio(book: RawOrderBook): {
  bidLiquidity: number;
  askLiquidity: number;
  ratio: number;
} {
  let bidLiquidity = 0;
  let askLiquidity = 0;
  for (const level of book.bids) {
    bidLiquidity += parseFloat(level.size);
  }
  for (const level of book.asks) {
    askLiquidity += parseFloat(level.size);
  }
  const total = bidLiquidity + askLiquidity;
  const ratio = total <= 0 ? 0.5 : bidLiquidity / total;
  return { bidLiquidity, askLiquidity, ratio };
}

/**
 * Detect whether a vacuum exists: current liquidity is below avgLiquidity * vacuumRatio.
 * Returns true if vacuum detected.
 */
export function isVacuum(
  currentLiquidity: number,
  avgLiquidity: number,
  vacuumRatio: number,
): boolean {
  if (avgLiquidity <= 0) return false;
  return currentLiquidity < avgLiquidity * vacuumRatio;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface LiquidityVacuumDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<LiquidityVacuumConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createLiquidityVacuumTick(deps: LiquidityVacuumDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: LiquidityVacuumConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const liquidityHistory = new Map<string, number[]>();
  const lastVacuum = new Map<string, VacuumEvent>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordLiquidity(tokenId: string, liquidity: number): void {
    let history = liquidityHistory.get(tokenId);
    if (!history) {
      history = [];
      liquidityHistory.set(tokenId, history);
    }
    history.push(liquidity);
    if (history.length > cfg.liquidityWindow * 2) {
      history.splice(0, history.length - cfg.liquidityWindow * 2);
    }
  }

  function getAvgLiquidity(tokenId: string): number {
    const history = liquidityHistory.get(tokenId);
    if (!history || history.length === 0) return 0;
    const window = history.slice(-cfg.liquidityWindow);
    let sum = 0;
    for (const v of window) {
      sum += v;
    }
    return sum / window.length;
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(tokenId: string): boolean {
    return positions.some(p => p.tokenId === tokenId);
  }

  function getMidPrice(book: RawOrderBook): number {
    const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
    const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
    return (bid + ask) / 2;
  }

  // ── Exit logic ─────────────────────────────────────────────────────────

  async function checkExits(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      let shouldExit = false;
      let reason = '';

      let currentPrice: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        currentPrice = getMidPrice(book);
        recordLiquidity(pos.tokenId, calcTotalLiquidity(book));
      } catch {
        continue;
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
            price: currentPrice.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / currentPrice)),
            orderType: 'IOC',
          });

          const pnl = pos.side === 'yes'
            ? (currentPrice - pos.entryPrice) * (pos.sizeUsdc / pos.entryPrice)
            : (pos.entryPrice - currentPrice) * (pos.sizeUsdc / pos.entryPrice);

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

  // ── Entry logic ────────────────────────────────────────────────────────

  async function scanEntries(markets: GammaMarket[]): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.yesTokenId)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId)) continue;

      try {
        const book = await clob.getOrderBook(market.yesTokenId);
        const mid = getMidPrice(book);

        // Price range filter
        if (mid < cfg.priceRangeLow || mid > cfg.priceRangeHigh) continue;

        const totalLiquidity = calcTotalLiquidity(book);
        const { bidLiquidity, askLiquidity } = calcBidAskLiquidityRatio(book);

        // Record liquidity
        recordLiquidity(market.yesTokenId, totalLiquidity);

        // Need enough history
        const history = liquidityHistory.get(market.yesTokenId);
        if (!history || history.length < 2) continue;

        const avgLiq = getAvgLiquidity(market.yesTokenId);

        // Minimum average liquidity filter
        if (avgLiq < cfg.minAvgLiquidity) continue;

        // Check for vacuum
        if (!isVacuum(totalLiquidity, avgLiq, cfg.vacuumRatio)) continue;

        // Record vacuum event
        const now = Date.now();
        lastVacuum.set(market.yesTokenId, {
          timestamp: now,
          bidLiquidity,
          askLiquidity,
        });

        // Anti-stale check
        const vacuum = lastVacuum.get(market.yesTokenId);
        if (!vacuum || now - vacuum.timestamp > cfg.vacuumFreshnessMs) continue;

        // Determine direction based on which side lost more liquidity
        // If bid liquidity dropped more → price will recover up → BUY YES
        // If ask liquidity dropped more → price will recover down → BUY NO
        const side: 'yes' | 'no' = bidLiquidity < askLiquidity ? 'yes' : 'no';
        const tokenId = side === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);

        const entryPrice = side === 'yes'
          ? (book.asks.length > 0 ? parseFloat(book.asks[0].price) : mid)
          : (book.bids.length > 0 ? 1 - parseFloat(book.bids[0].price) : 1 - mid);

        const sizeUsdc = parseFloat(cfg.positionSize);

        const order = await orderManager.placeOrder({
          tokenId,
          side: 'buy',
          price: entryPrice.toFixed(4),
          size: String(Math.round(sizeUsdc / entryPrice)),
          orderType: 'GTC',
        });

        positions.push({
          tokenId,
          conditionId: market.conditionId,
          side,
          entryPrice,
          sizeUsdc,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          totalLiquidity: totalLiquidity.toFixed(2),
          avgLiquidity: avgLiq.toFixed(2),
          bidLiquidity: bidLiquidity.toFixed(2),
          askLiquidity: askLiquidity.toFixed(2),
          size: sizeUsdc,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: order.id,
            marketId: market.conditionId,
            side: 'buy',
            fillPrice: String(entryPrice),
            fillSize: String(sizeUsdc),
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

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function liquidityVacuumTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(20);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: liquidityHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
