/**
 * VWAP Deviation Sniper strategy for Polymarket binary markets.
 *
 * Detects when price deviates significantly from its Volume-Weighted Average
 * Price (VWAP) while a volume spike is present, then enters a mean-reversion
 * trade expecting a snap-back toward VWAP.
 *
 * Signal logic:
 *   VWAP      = Σ(price × volume) / Σ(volume)   over rolling window
 *   deviation = (price - VWAP) / VWAP
 *
 *   deviation < -threshold AND volumeSpike → BUY YES  (depressed, expect up)
 *   deviation > +threshold AND volumeSpike → BUY NO   (inflated, expect down)
 *
 * Volume is approximated from total visible orderbook liquidity (Σ bid + ask
 * sizes) since the Polymarket CLOB API does not expose a trade history endpoint.
 */
import type { ClobClient, RawOrderBook, OrderBookLevel } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface VwapDeviationConfig {
  /** Number of ticks for rolling VWAP calculation */
  vwapWindowSize: number;
  /** Min absolute deviation from VWAP to trigger (0.03 = 3%) */
  deviationThreshold: number;
  /** Current tick volume must exceed avgVolume × this multiplier */
  volumeSpikeMultiplier: number;
  /** Whether to scale threshold by recent volatility */
  volatilityAdaptive: boolean;
  /** Multiplier: effective threshold = base × (1 + stdDev × factor) */
  volatilityScaleFactor: number;
  /** Trade size in USDC */
  sizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction (0.025 = 2.5%) */
  takeProfitPct: number;
  /** Stop-loss as fraction (0.015 = 1.5%) */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: VwapDeviationConfig = {
  vwapWindowSize: 30,
  deviationThreshold: 0.03,
  volumeSpikeMultiplier: 2.0,
  volatilityAdaptive: true,
  volatilityScaleFactor: 1.5,
  sizeUsdc: 30,
  maxPositions: 5,
  takeProfitPct: 0.025,
  stopLossPct: 0.015,
  maxHoldMs: 8 * 60_000,
  cooldownMs: 60_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'vwap-deviation-sniper';

// ── Internal types ───────────────────────────────────────────────────────────

export interface VwapTick {
  price: number;
  volume: number;
  timestamp: number;
}

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  entryVwap: number;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Compute Volume-Weighted Average Price from tick history. */
export function calcVWAP(ticks: VwapTick[]): number {
  if (ticks.length === 0) return 0;
  let sumPV = 0;
  let sumV = 0;
  for (const t of ticks) {
    sumPV += t.price * t.volume;
    sumV += t.volume;
  }
  if (sumV === 0) return 0;
  return sumPV / sumV;
}

/** Compute price deviation from VWAP as a fraction. */
export function calcDeviation(currentPrice: number, vwap: number): number {
  if (vwap === 0) return 0;
  return (currentPrice - vwap) / vwap;
}

/** Detect whether current volume constitutes a spike relative to history. */
export function detectVolumeSpike(currentVolume: number, ticks: VwapTick[], multiplier: number): boolean {
  if (ticks.length === 0) return false;
  const avgVolume = ticks.reduce((s, t) => s + t.volume, 0) / ticks.length;
  return currentVolume > avgVolume * multiplier;
}

/** Compute adaptive threshold that widens in volatile markets. */
export function calcAdaptiveThreshold(ticks: VwapTick[], baseThreshold: number, scaleFactor: number): number {
  if (ticks.length < 2) return baseThreshold;
  const prices = ticks.map(t => t.price);
  const mean = prices.reduce((s, p) => s + p, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  return baseThreshold * (1 + stdDev * scaleFactor);
}

/** Sum all visible liquidity (bid + ask sizes) from raw orderbook. */
export function extractBookVolume(book: RawOrderBook): number {
  let total = 0;
  for (const level of book.bids) total += parseFloat(level.size);
  for (const level of book.asks) total += parseFloat(level.size);
  return total;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface VwapDeviationDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<VwapDeviationConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createVwapDeviationSniperTick(deps: VwapDeviationDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
    kellySizer,
  } = deps;
  const cfg: VwapDeviationConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const tickHistory = new Map<string, VwapTick[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number, volume: number): void {
    let history = tickHistory.get(tokenId);
    if (!history) {
      history = [];
      tickHistory.set(tokenId, history);
    }
    history.push({ price, volume, timestamp: Date.now() });
    if (history.length > cfg.vwapWindowSize * 2) {
      history.splice(0, history.length - cfg.vwapWindowSize * 2);
    }
  }

  function getWindow(tokenId: string): VwapTick[] {
    const history = tickHistory.get(tokenId);
    if (!history) return [];
    return history.slice(-cfg.vwapWindowSize);
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(tokenId: string): boolean {
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

      let currentPrice: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        const ba = bestBidAsk(book);
        currentPrice = ba.mid;
        const vol = extractBookVolume(book);
        recordTick(pos.tokenId, currentPrice, vol);
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

      // VWAP crossover: price returned to VWAP
      if (!shouldExit) {
        const window = getWindow(pos.tokenId);
        const vwap = calcVWAP(window);
        if (vwap > 0 && Math.abs(calcDeviation(currentPrice, vwap)) < 0.005) {
          shouldExit = true;
          reason = `vwap crossover (dev=${calcDeviation(currentPrice, vwap).toFixed(4)})`;
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
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        const vol = extractBookVolume(book);
        recordTick(market.yesTokenId, ba.mid, vol);

        // Need enough tick history
        const window = getWindow(market.yesTokenId);
        if (window.length < cfg.vwapWindowSize) continue;

        // Calculate signals
        const vwap = calcVWAP(window);
        const deviation = calcDeviation(ba.mid, vwap);
        const volumeSpike = detectVolumeSpike(vol, window, cfg.volumeSpikeMultiplier);
        const threshold = cfg.volatilityAdaptive
          ? calcAdaptiveThreshold(window, cfg.deviationThreshold, cfg.volatilityScaleFactor)
          : cfg.deviationThreshold;

        // Entry conditions
        let side: 'yes' | 'no' | null = null;

        if (deviation < -threshold && volumeSpike) {
          side = 'yes';
        } else if (deviation > threshold && volumeSpike) {
          side = 'no';
        }

        if (!side) continue;

        const tokenId = side === 'yes' ? market.yesTokenId : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

        const posSize = kellySizer
          ? kellySizer.getSize(STRATEGY_NAME).size
          : cfg.sizeUsdc;

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
          entryVwap: vwap,
          sizeUsdc: posSize,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          vwap: vwap.toFixed(4),
          deviation: deviation.toFixed(4),
          threshold: threshold.toFixed(4),
          size: posSize,
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

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function vwapDeviationSniperTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: tickHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
