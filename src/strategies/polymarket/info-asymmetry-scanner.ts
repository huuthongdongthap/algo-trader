/**
 * Information Asymmetry Scanner strategy for Polymarket binary markets.
 *
 * Detects information asymmetry by comparing the aggressiveness of market
 * orders (taker flow) on each side of the book. When one side is absorbing
 * liquidity much faster than the other, it suggests informed traders have
 * private information. Trades in the direction of the aggressive side.
 *
 * Signal logic:
 *   1. Track bid-side and ask-side book depth changes over time
 *   2. Calculate depletion rate = how fast each side's depth is shrinking
 *   3. Asymmetry score = (bidDepletion - askDepletion) / (bidDepletion + askDepletion)
 *   4. When |asymmetry| > threshold -> informed flow detected
 *   5. Positive asymmetry (asks depleting faster) -> buyers are aggressive -> BUY YES
 *   6. Negative asymmetry (bids depleting faster) -> sellers are aggressive -> BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// -- Config -------------------------------------------------------------------

export interface InfoAsymmetryScannerConfig {
  /** Minimum |asymmetry| to trigger a signal */
  asymmetryThreshold: number;
  /** Number of depth snapshots to retain for depletion calculation */
  depthWindow: number;
  /** Minimum depletion rate to consider as meaningful */
  minDepletionRate: number;
  /** Minimum market volume (USDC) to consider */
  minVolume: number;
  /** Take-profit as fraction (0.025 = 2.5%) */
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

export const DEFAULT_CONFIG: InfoAsymmetryScannerConfig = {
  asymmetryThreshold: 0.3,
  depthWindow: 10,
  minDepletionRate: 0.01,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 12 * 60_000,
  maxPositions: 5,
  cooldownMs: 90_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'info-asymmetry-scanner' as StrategyName;

// -- Internal types -----------------------------------------------------------

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
 * Sum all sizes in a list of order book levels.
 */
export function calcTotalDepth(levels: { price: string; size: string }[]): number {
  let total = 0;
  for (const level of levels) {
    total += parseFloat(level.size);
  }
  return total;
}

/**
 * Calculate depletion rate from a history of depth snapshots.
 * depletionRate = (first - last) / first
 * Returns 0 if fewer than 2 snapshots or first is 0.
 */
export function calcDepletionRate(depthHistory: number[]): number {
  if (depthHistory.length < 2) return 0;
  const first = depthHistory[0];
  if (first === 0) return 0;
  const last = depthHistory[depthHistory.length - 1];
  return (first - last) / first;
}

/**
 * Calculate asymmetry score between bid and ask depletion.
 * asymmetry = (bidDepletion - askDepletion) / (bidDepletion + askDepletion)
 * Returns 0 if both are 0.
 */
export function calcAsymmetryScore(bidDepletion: number, askDepletion: number): number {
  const sum = bidDepletion + askDepletion;
  if (sum === 0) return 0;
  return (bidDepletion - askDepletion) / sum;
}

/**
 * Determine whether the flow signals informed trading.
 * Requires |asymmetry| > threshold AND totalDepletion > minDepletionRate.
 */
export function isInformedFlow(
  asymmetry: number,
  totalDepletion: number,
  config: Pick<InfoAsymmetryScannerConfig, 'asymmetryThreshold' | 'minDepletionRate'>,
): boolean {
  return Math.abs(asymmetry) > config.asymmetryThreshold && totalDepletion > config.minDepletionRate;
}

// -- Dependencies -------------------------------------------------------------

export interface InfoAsymmetryScannerDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<InfoAsymmetryScannerConfig>;
}

// -- Tick factory -------------------------------------------------------------

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

export function createInfoAsymmetryScannerTick(deps: InfoAsymmetryScannerDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: InfoAsymmetryScannerConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const bidDepthHistory = new Map<string, number[]>();
  const askDepthHistory = new Map<string, number[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // -- Helpers ----------------------------------------------------------------

  function recordDepth(tokenId: string, bidDepth: number, askDepth: number): void {
    let bidHist = bidDepthHistory.get(tokenId);
    if (!bidHist) {
      bidHist = [];
      bidDepthHistory.set(tokenId, bidHist);
    }
    bidHist.push(bidDepth);
    if (bidHist.length > cfg.depthWindow) {
      bidHist.splice(0, bidHist.length - cfg.depthWindow);
    }

    let askHist = askDepthHistory.get(tokenId);
    if (!askHist) {
      askHist = [];
      askDepthHistory.set(tokenId, askHist);
    }
    askHist.push(askDepth);
    if (askHist.length > cfg.depthWindow) {
      askHist.splice(0, askHist.length - cfg.depthWindow);
    }
  }

  function getBidHistory(tokenId: string): number[] {
    return bidDepthHistory.get(tokenId) ?? [];
  }

  function getAskHistory(tokenId: string): number[] {
    return askDepthHistory.get(tokenId) ?? [];
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

  // -- Entry logic ------------------------------------------------------------

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

        // Calculate depth on each side
        const bidDepth = calcTotalDepth(book.bids);
        const askDepth = calcTotalDepth(book.asks);

        // Record depth snapshot
        recordDepth(market.yesTokenId, bidDepth, askDepth);

        const bidHist = getBidHistory(market.yesTokenId);
        const askHist = getAskHistory(market.yesTokenId);

        // Need at least 2 snapshots for depletion calc
        if (bidHist.length < 2) continue;

        // Calculate depletion rates
        const bidDepletion = calcDepletionRate(bidHist);
        const askDepletion = calcDepletionRate(askHist);

        // Calculate asymmetry score
        const asymmetry = calcAsymmetryScore(bidDepletion, askDepletion);

        // Check for informed flow
        const totalDepletion = Math.abs(bidDepletion) + Math.abs(askDepletion);
        if (!isInformedFlow(asymmetry, totalDepletion, cfg)) continue;

        // Determine signal:
        // Positive asymmetry (asks depleting faster) -> buyers aggressive -> BUY YES
        // Negative asymmetry (bids depleting faster) -> sellers aggressive -> BUY NO
        const side: 'yes' | 'no' = asymmetry > 0 ? 'yes' : 'no';
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
          asymmetry: asymmetry.toFixed(4),
          bidDepletion: bidDepletion.toFixed(4),
          askDepletion: askDepletion.toFixed(4),
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

  // -- Main tick --------------------------------------------------------------

  return async function infoAsymmetryScannerTick(): Promise<void> {
    try {
      // 1. Check exits first
      await checkExits();

      // 2. Discover trending markets
      const markets = await gamma.getTrending(15);

      // 3. Scan for entries
      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: bidDepthHistory.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
