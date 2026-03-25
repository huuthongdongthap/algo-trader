/**
 * Order Flow Toxicity (VPIN) strategy for Polymarket binary markets.
 *
 * Implements a Volume-synchronized Probability of Informed Trading (VPIN)
 * approximation. Detects toxic order flow (informed traders) vs normal flow,
 * then trades with the informed flow direction.
 *
 * Signal logic:
 *   Track price changes and volume proxies (orderbook depth) per tick.
 *   Classify each tick as buy-initiated or sell-initiated based on price direction.
 *   VPIN = |buyVolume - sellVolume| / (buyVolume + sellVolume) over rolling window.
 *   High VPIN (> 0.7) = informed traders dominating one side.
 *
 *   If buyVolume > sellVolume -> informed flow is bullish -> BUY YES
 *   If sellVolume > buyVolume -> informed flow is bearish -> BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface OrderFlowToxicityConfig {
  /** Rolling window size in ticks for VPIN calculation */
  vpinWindow: number;
  /** VPIN threshold to trigger entry */
  vpinThreshold: number;
  /** VPIN level below which to exit (flow dissipated) */
  vpinExitThreshold: number;
  /** Minimum ticks of data before considering entry */
  minTicks: number;
  /** Number of consecutive ticks VPIN must stay above threshold */
  sustainedTicks: number;
  /** Maximum spread as fraction */
  maxSpreadPct: number;
  /** Trade size in USDC */
  baseSizeUsdc: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Take-profit as fraction */
  takeProfitPct: number;
  /** Stop-loss as fraction */
  stopLossPct: number;
  /** Max hold time in ms */
  maxHoldMs: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Max trending markets to scan per tick */
  scanLimit: number;
}

const DEFAULT_CONFIG: OrderFlowToxicityConfig = {
  vpinWindow: 20,
  vpinThreshold: 0.7,
  vpinExitThreshold: 0.3,
  minTicks: 15,
  sustainedTicks: 3,
  maxSpreadPct: 0.05,
  baseSizeUsdc: 20,
  maxPositions: 3,
  takeProfitPct: 0.03,
  stopLossPct: 0.02,
  maxHoldMs: 10 * 60_000,
  cooldownMs: 120_000,
  scanLimit: 15,
};

const STRATEGY_NAME: StrategyName = 'order-flow-toxicity';

// ── Exported types ──────────────────────────────────────────────────────────

export interface TickClassification {
  side: 'buy' | 'sell';
  volume: number;
}

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

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Classify a tick as buy-initiated or sell-initiated based on price direction.
 * Price up -> buyers dominant. Price flat or down -> sellers dominant (flat defaults to buy).
 */
export function classifyTick(prevPrice: number, currentPrice: number, volumeProxy: number): TickClassification {
  const side = currentPrice > prevPrice ? 'buy' : currentPrice < prevPrice ? 'sell' : 'buy';
  return { side, volume: volumeProxy };
}

/**
 * Calculate volume proxy from orderbook: sum of all bid + ask sizes.
 */
export function calcVolumeProxy(book: RawOrderBook): number {
  let total = 0;
  for (const bid of book.bids) {
    total += parseFloat(bid.size);
  }
  for (const ask of book.asks) {
    total += parseFloat(ask.size);
  }
  return total;
}

/**
 * Calculate VPIN over a rolling window of classified ticks.
 * VPIN = |buyVolume - sellVolume| / (buyVolume + sellVolume)
 * Returns 0 if no volume.
 */
export function calcVPIN(ticks: TickClassification[], window: number): number {
  const slice = ticks.slice(-window);
  if (slice.length === 0) return 0;

  let buyVolume = 0;
  let sellVolume = 0;

  for (const tick of slice) {
    if (tick.side === 'buy') {
      buyVolume += tick.volume;
    } else {
      sellVolume += tick.volume;
    }
  }

  const totalVolume = buyVolume + sellVolume;
  if (totalVolume <= 0) return 0;

  return Math.abs(buyVolume - sellVolume) / totalVolume;
}

/**
 * Determine the flow direction from classified ticks over a window.
 * Returns 'bullish' if buy volume dominates, 'bearish' otherwise.
 */
export function getFlowDirection(ticks: TickClassification[], window: number): 'bullish' | 'bearish' {
  const slice = ticks.slice(-window);

  let buyVolume = 0;
  let sellVolume = 0;

  for (const tick of slice) {
    if (tick.side === 'buy') {
      buyVolume += tick.volume;
    } else {
      sellVolume += tick.volume;
    }
  }

  return buyVolume > sellVolume ? 'bullish' : 'bearish';
}

/**
 * Check whether VPIN has been sustained above threshold for requiredTicks
 * consecutive entries at the end of the history.
 */
export function isVpinSustained(vpinHistory: number[], threshold: number, requiredTicks: number): boolean {
  if (vpinHistory.length < requiredTicks) return false;

  const tail = vpinHistory.slice(-requiredTicks);
  return tail.every(v => v > threshold);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface OrderFlowToxicityDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<OrderFlowToxicityConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createOrderFlowToxicityTick(deps: OrderFlowToxicityDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: OrderFlowToxicityConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const tickHistory = new Map<string, TickClassification[]>();
  const vpinHistoryMap = new Map<string, number[]>();
  const lastPrice = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number, volumeProxy: number): void {
    const prev = lastPrice.get(tokenId);
    lastPrice.set(tokenId, price);

    if (prev === undefined) return; // Need at least one previous price

    const tick = classifyTick(prev, price, volumeProxy);

    let history = tickHistory.get(tokenId);
    if (!history) {
      history = [];
      tickHistory.set(tokenId, history);
    }
    history.push(tick);

    // Keep at most vpinWindow * 3 ticks
    const maxTicks = cfg.vpinWindow * 3;
    if (history.length > maxTicks) {
      history.splice(0, history.length - maxTicks);
    }

    // Update VPIN history
    const vpin = calcVPIN(history, cfg.vpinWindow);
    let vpinHist = vpinHistoryMap.get(tokenId);
    if (!vpinHist) {
      vpinHist = [];
      vpinHistoryMap.set(tokenId, vpinHist);
    }
    vpinHist.push(vpin);
    if (vpinHist.length > maxTicks) {
      vpinHist.splice(0, vpinHist.length - maxTicks);
    }
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
        const volProxy = calcVolumeProxy(book);
        recordTick(pos.tokenId, currentPrice, volProxy);
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

      // VPIN dissipation exit
      if (!shouldExit) {
        const vpinHist = vpinHistoryMap.get(pos.tokenId);
        if (vpinHist && vpinHist.length > 0) {
          const currentVpin = vpinHist[vpinHist.length - 1];
          if (currentVpin < cfg.vpinExitThreshold) {
            shouldExit = true;
            reason = `vpin-dissipation (${currentVpin.toFixed(4)})`;
          }
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
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        // Check spread
        const spread = ba.ask - ba.bid;
        if (spread > cfg.maxSpreadPct) continue;

        const volProxy = calcVolumeProxy(book);
        recordTick(market.yesTokenId, ba.mid, volProxy);

        // Check minimum ticks
        const ticks = tickHistory.get(market.yesTokenId);
        if (!ticks || ticks.length < cfg.minTicks) continue;

        // Calculate VPIN
        const vpin = calcVPIN(ticks, cfg.vpinWindow);

        // Check VPIN threshold
        if (vpin <= cfg.vpinThreshold) continue;

        // Check VPIN is sustained
        const vpinHist = vpinHistoryMap.get(market.yesTokenId);
        if (!vpinHist || !isVpinSustained(vpinHist, cfg.vpinThreshold, cfg.sustainedTicks)) continue;

        // Determine flow direction
        const direction = getFlowDirection(ticks, cfg.vpinWindow);
        const side: 'yes' | 'no' = direction === 'bullish' ? 'yes' : 'no';
        const tokenId = side === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);

        const order = await orderManager.placeOrder({
          tokenId,
          side: 'buy',
          price: entryPrice.toFixed(4),
          size: String(Math.round(cfg.baseSizeUsdc / entryPrice)),
          orderType: 'GTC',
        });

        positions.push({
          tokenId,
          conditionId: market.conditionId,
          side,
          entryPrice,
          sizeUsdc: cfg.baseSizeUsdc,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          vpin: vpin.toFixed(4),
          direction,
          size: cfg.baseSizeUsdc,
        });

        eventBus.emit('trade.executed', {
          trade: {
            orderId: order.id,
            marketId: market.conditionId,
            side: 'buy',
            fillPrice: String(entryPrice),
            fillSize: String(cfg.baseSizeUsdc),
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

  return async function orderFlowToxicityTick(): Promise<void> {
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
