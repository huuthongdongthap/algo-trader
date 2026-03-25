/**
 * Smart Money Divergence strategy for Polymarket binary markets.
 *
 * Detects when large orders (smart money) diverge from the overall order flow
 * direction. When smart money goes one way but retail-sized orders pile on the
 * other, trade with smart money.
 *
 * Signal logic:
 *   1. Classify orders by size: orders > sizeThreshold USDC are "smart", rest "retail"
 *   2. Track smart money net flow: sum of (smart bid sizes - smart ask sizes) over flowWindowMs
 *   3. Track retail net flow: sum of (retail bid sizes - retail ask sizes) over flowWindowMs
 *   4. Divergence = smart and retail flows point in opposite directions
 *   5. When divergence AND |smartFlow| > minSmartFlowUsdc -> trade with smart money
 *   6. Confirmation: divergence must persist for minDivergenceTicks
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// -- Config -------------------------------------------------------------------

export interface SmartMoneyDivergenceConfig {
  /** USDC size threshold to classify an order as smart money */
  sizeThreshold: number;
  /** Window in ms to accumulate flow data */
  flowWindowMs: number;
  /** Minimum absolute smart money net flow (USDC) to act */
  minSmartFlowUsdc: number;
  /** Number of consecutive ticks divergence must persist */
  minDivergenceTicks: number;
  /** Take-profit as fraction (0.04 = 4%) */
  takeProfitPct: number;
  /** Stop-loss as fraction (0.025 = 2.5%) */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Trade size in USDC */
  positionSize: string;
}

const DEFAULT_CONFIG: SmartMoneyDivergenceConfig = {
  sizeThreshold: 200,
  flowWindowMs: 120_000,
  minSmartFlowUsdc: 500,
  minDivergenceTicks: 3,
  takeProfitPct: 0.04,
  stopLossPct: 0.025,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '15',
};

const STRATEGY_NAME = 'smart-money-divergence' as StrategyName;

// -- Internal types -----------------------------------------------------------

export interface FlowSnapshot {
  timestamp: number;
  smartBidSize: number;
  smartAskSize: number;
  retailBidSize: number;
  retailAskSize: number;
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

// -- Pure helpers (exported for testing) --------------------------------------

/**
 * Classify orderbook levels into smart-money and retail buckets.
 * Returns aggregate sizes for each bucket and side.
 */
export function classifyOrders(
  book: { bids: { price: string; size: string }[]; asks: { price: string; size: string }[] },
  sizeThreshold: number,
): { smartBidSize: number; smartAskSize: number; retailBidSize: number; retailAskSize: number } {
  let smartBidSize = 0;
  let smartAskSize = 0;
  let retailBidSize = 0;
  let retailAskSize = 0;

  for (const level of book.bids) {
    const size = parseFloat(level.size);
    if (size > sizeThreshold) {
      smartBidSize += size;
    } else {
      retailBidSize += size;
    }
  }

  for (const level of book.asks) {
    const size = parseFloat(level.size);
    if (size > sizeThreshold) {
      smartAskSize += size;
    } else {
      retailAskSize += size;
    }
  }

  return { smartBidSize, smartAskSize, retailBidSize, retailAskSize };
}

/**
 * Compute net flow from a list of flow snapshots.
 * Net flow = sum(bidSize) - sum(askSize).
 */
export function computeNetFlow(
  snapshots: FlowSnapshot[],
  kind: 'smart' | 'retail',
): number {
  let net = 0;
  for (const s of snapshots) {
    if (kind === 'smart') {
      net += s.smartBidSize - s.smartAskSize;
    } else {
      net += s.retailBidSize - s.retailAskSize;
    }
  }
  return net;
}

/**
 * Detect divergence: smart and retail net flows point in opposite directions.
 */
export function hasDivergence(smartFlow: number, retailFlow: number): boolean {
  if (smartFlow === 0 || retailFlow === 0) return false;
  return (smartFlow > 0 && retailFlow < 0) || (smartFlow < 0 && retailFlow > 0);
}

/**
 * Determine entry signal based on divergence state.
 * Returns the direction to trade (with smart money) or null.
 */
export function shouldEnter(
  smartFlow: number,
  retailFlow: number,
  divergenceTickCount: number,
  config: SmartMoneyDivergenceConfig,
): 'buy-yes' | 'buy-no' | null {
  if (!hasDivergence(smartFlow, retailFlow)) return null;
  if (Math.abs(smartFlow) < config.minSmartFlowUsdc) return null;
  if (divergenceTickCount < config.minDivergenceTicks) return null;

  // Trade with smart money direction
  if (smartFlow > 0) return 'buy-yes';
  return 'buy-no';
}

/**
 * Prune snapshots outside the time window. Returns a new filtered array.
 */
export function pruneSnapshots(snapshots: FlowSnapshot[], windowMs: number, now?: number): FlowSnapshot[] {
  const cutoff = (now ?? Date.now()) - windowMs;
  return snapshots.filter(s => s.timestamp >= cutoff);
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// -- Dependencies -------------------------------------------------------------

export interface SmartMoneyDivergenceDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<SmartMoneyDivergenceConfig>;
}

// -- Tick factory -------------------------------------------------------------

export function createSmartMoneyDivergenceTick(deps: SmartMoneyDivergenceDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: SmartMoneyDivergenceConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const smartFlowHistory = new Map<string, FlowSnapshot[]>();
  const retailFlowHistory = new Map<string, FlowSnapshot[]>();
  const divergenceCounter = new Map<string, number>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // -- Helpers ----------------------------------------------------------------

  function recordSnapshot(tokenId: string, snapshot: FlowSnapshot): void {
    let smartHistory = smartFlowHistory.get(tokenId);
    if (!smartHistory) {
      smartHistory = [];
      smartFlowHistory.set(tokenId, smartHistory);
    }
    smartHistory.push(snapshot);

    let retailHistory = retailFlowHistory.get(tokenId);
    if (!retailHistory) {
      retailHistory = [];
      retailFlowHistory.set(tokenId, retailHistory);
    }
    retailHistory.push(snapshot);

    // Prune old snapshots
    const cutoff = Date.now() - cfg.flowWindowMs;
    const smartFirstValid = smartHistory.findIndex(s => s.timestamp >= cutoff);
    if (smartFirstValid > 0) {
      smartHistory.splice(0, smartFirstValid);
    } else if (smartFirstValid === -1) {
      smartHistory.length = 0;
    }

    const retailFirstValid = retailHistory.findIndex(s => s.timestamp >= cutoff);
    if (retailFirstValid > 0) {
      retailHistory.splice(0, retailFirstValid);
    } else if (retailFirstValid === -1) {
      retailHistory.length = 0;
    }
  }

  function getRecentSnapshots(tokenId: string): FlowSnapshot[] {
    const history = smartFlowHistory.get(tokenId);
    if (!history) return [];
    const cutoff = Date.now() - cfg.flowWindowMs;
    return history.filter(s => s.timestamp >= cutoff);
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(tokenId: string): boolean {
    return positions.some(p => p.tokenId === tokenId);
  }

  // -- Exit logic -------------------------------------------------------------

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

  // -- Entry logic ------------------------------------------------------------

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

        // Classify orders and record snapshot
        const classified = classifyOrders(book, cfg.sizeThreshold);
        const snapshot: FlowSnapshot = {
          timestamp: Date.now(),
          ...classified,
        };
        recordSnapshot(market.yesTokenId, snapshot);

        // Compute flows
        const recentSnapshots = getRecentSnapshots(market.yesTokenId);
        const smartFlow = computeNetFlow(recentSnapshots, 'smart');
        const retailFlow = computeNetFlow(recentSnapshots, 'retail');

        // Update divergence counter
        if (hasDivergence(smartFlow, retailFlow)) {
          const current = divergenceCounter.get(market.yesTokenId) ?? 0;
          divergenceCounter.set(market.yesTokenId, current + 1);
        } else {
          divergenceCounter.set(market.yesTokenId, 0);
        }

        const tickCount = divergenceCounter.get(market.yesTokenId) ?? 0;
        const signal = shouldEnter(smartFlow, retailFlow, tickCount, cfg);
        if (!signal) continue;

        // Determine token and price
        const side: 'yes' | 'no' = signal === 'buy-yes' ? 'yes' : 'no';
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
          smartFlow: smartFlow.toFixed(2),
          retailFlow: retailFlow.toFixed(2),
          divergenceTicks: tickCount,
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

  // -- Main tick --------------------------------------------------------------

  return async function smartMoneyDivergenceTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: smartFlowHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
