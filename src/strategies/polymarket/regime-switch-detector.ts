/**
 * Regime Switch Detector strategy for Polymarket binary markets.
 *
 * Detects statistical regime changes in price behavior using variance ratio
 * tests. When the variance of returns at different time scales changes
 * significantly, it indicates a regime switch (e.g., from mean-reverting to
 * trending). Trades the new regime direction.
 *
 * Signal logic:
 *   1. Calculate short-window variance and long-window variance of returns
 *   2. Variance ratio = short_var / long_var
 *   3. VR ≈ 1 → random walk, VR < 1 → mean reverting, VR > 1 → trending
 *   4. Track VR over time with EMA
 *   5. When VR transitions from <1 to >1 (switch to trending) → follow momentum direction
 *   6. When VR transitions from >1 to <1 (switch to mean-reverting) → fade last move
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface RegimeSwitchDetectorConfig {
  /** Number of recent returns for short-window variance */
  shortWindow: number;
  /** Number of recent returns for long-window variance */
  longWindow: number;
  /** Alpha for VR exponential moving average */
  vrEmaAlpha: number;
  /** VR above this = trending regime */
  trendingThreshold: number;
  /** VR below this = mean-reverting regime */
  meanRevertThreshold: number;
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

export const DEFAULT_CONFIG: RegimeSwitchDetectorConfig = {
  shortWindow: 5,
  longWindow: 20,
  vrEmaAlpha: 0.12,
  trendingThreshold: 1.2,
  meanRevertThreshold: 0.8,
  minVolume: 5000,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 20 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '12',
};

const STRATEGY_NAME = 'regime-switch-detector' as StrategyName;

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
 * Calculate consecutive returns from a price series.
 * Returns empty array if fewer than 2 prices.
 */
export function calcReturns(prices: number[]): number[] {
  if (prices.length < 2) return [];
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(prices[i] - prices[i - 1]);
  }
  return returns;
}

/**
 * Calculate population variance of a numeric array.
 * Returns 0 if the array is empty.
 */
export function calcVariance(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let sumSq = 0;
  for (const v of values) sumSq += (v - mean) ** 2;
  return sumSq / values.length;
}

/**
 * Calculate variance ratio = shortVar / longVar.
 * Returns 0 if longVar is 0.
 */
export function calcVarianceRatio(shortVar: number, longVar: number): number {
  if (longVar === 0) return 0;
  return shortVar / longVar;
}

/**
 * Classify the current regime based on variance ratio.
 */
export function classifyRegime(
  vr: number,
  trendThresh: number,
  meanRevertThresh: number,
): 'trending' | 'mean-reverting' | 'neutral' {
  if (vr >= trendThresh) return 'trending';
  if (vr <= meanRevertThresh) return 'mean-reverting';
  return 'neutral';
}

/**
 * Detect a regime switch between previous and current regime.
 * Returns null if no meaningful switch occurred.
 */
export function detectSwitch(
  prevRegime: string,
  currentRegime: string,
): 'to-trending' | 'to-mean-reverting' | null {
  if (prevRegime === currentRegime) return null;
  if (currentRegime === 'trending' && prevRegime !== 'trending') return 'to-trending';
  if (currentRegime === 'mean-reverting' && prevRegime !== 'mean-reverting') return 'to-mean-reverting';
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

/**
 * Update an exponential moving average.
 * Returns newValue when prevEma is null (initial case).
 */
function updateEma(prevEma: number | null, newValue: number, alpha: number): number {
  if (prevEma === null) return newValue;
  if (alpha <= 0) return prevEma;
  if (alpha >= 1) return newValue;
  return alpha * newValue + (1 - alpha) * prevEma;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface RegimeSwitchDetectorDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<RegimeSwitchDetectorConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createRegimeSwitchDetectorTick(deps: RegimeSwitchDetectorDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: RegimeSwitchDetectorConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
  const vrEmaState = new Map<string, number>();
  const regimeState = new Map<string, string>();
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

    // Keep only enough for longWindow + 1 prices (to get longWindow returns)
    const maxPrices = cfg.longWindow + 1;
    if (history.length > maxPrices) {
      history.splice(0, history.length - maxPrices);
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

  /**
   * Get momentum direction from recent returns.
   * Positive → prices going up, Negative → prices going down.
   */
  function momentumDirection(returns: number[]): 'up' | 'down' {
    if (returns.length === 0) return 'up';
    const recent = returns.slice(-cfg.shortWindow);
    let sum = 0;
    for (const r of recent) sum += r;
    return sum >= 0 ? 'up' : 'down';
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

        // Record price
        recordPrice(market.yesTokenId, ba.mid);
        const prices = getPrices(market.yesTokenId);

        // Need enough prices for long window returns
        if (prices.length < cfg.longWindow + 1) continue;

        // Calculate returns
        const allReturns = calcReturns(prices);
        const shortReturns = allReturns.slice(-cfg.shortWindow);
        const longReturns = allReturns.slice(-cfg.longWindow);

        // Calculate variances
        const shortVar = calcVariance(shortReturns);
        const longVar = calcVariance(longReturns);

        // Calculate variance ratio
        const vr = calcVarianceRatio(shortVar, longVar);

        // Update VR EMA
        const prevVrEma = vrEmaState.get(market.yesTokenId) ?? null;
        const vrEma = updateEma(prevVrEma, vr, cfg.vrEmaAlpha);
        vrEmaState.set(market.yesTokenId, vrEma);

        // Classify current regime
        const currentRegime = classifyRegime(vrEma, cfg.trendingThreshold, cfg.meanRevertThreshold);
        const prevRegime = regimeState.get(market.yesTokenId) ?? 'neutral';
        regimeState.set(market.yesTokenId, currentRegime);

        // Detect regime switch
        const switchType = detectSwitch(prevRegime, currentRegime);
        if (!switchType) continue;

        // Determine trade direction
        const momentum = momentumDirection(allReturns);
        let side: 'yes' | 'no';

        if (switchType === 'to-trending') {
          // Follow momentum direction
          side = momentum === 'up' ? 'yes' : 'no';
        } else {
          // Fade last move (mean-reverting)
          side = momentum === 'up' ? 'no' : 'yes';
        }

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
          vr: vr.toFixed(4),
          vrEma: vrEma.toFixed(4),
          regime: currentRegime,
          switchType,
          momentum,
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

  return async function regimeSwitchDetectorTick(): Promise<void> {
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
