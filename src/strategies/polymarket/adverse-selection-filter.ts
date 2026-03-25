/**
 * Adverse Selection Filter strategy for Polymarket binary markets.
 *
 * Detects and avoids toxic order flow by tracking markout P&L — how price
 * moves after our trades. Markets where we consistently lose after entry
 * exhibit adverse selection. This strategy only enters markets with
 * favorable markout scores.
 *
 * Signal logic:
 *   Track "markout" per market: after entry, measure price change at
 *   markoutWindowMs intervals.
 *   markoutScore = average markout P&L over last markoutHistory entries.
 *   Positive = favorable, negative = toxic.
 *   Only enter markets where markoutScore > minMarkoutScore OR no history
 *   yet (give benefit of the doubt).
 *   Entry signal: combine markout filter with simple momentum — price
 *   trending in one direction for trendTicks.
 *   Direction: if recent price trend is up → BUY YES, down → BUY NO.
 *   Anti-toxic: if a market's markoutScore < toxicThreshold, blacklist it
 *   for blacklistMs.
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface AdverseSelectionFilterConfig {
  /** Window in ms after entry to measure markout P&L */
  markoutWindowMs: number;
  /** Number of markout entries to average over */
  markoutHistory: number;
  /** Minimum markout score to allow entry (negative = some tolerance) */
  minMarkoutScore: number;
  /** Markout score below which to blacklist the market */
  toxicThreshold: number;
  /** Duration in ms to blacklist a toxic market */
  blacklistMs: number;
  /** Number of consecutive price ticks to detect a trend */
  trendTicks: number;
  /** Minimum price change over trendTicks to qualify as a trend */
  trendThreshold: number;
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
  /** Trade size in USDC (string for precision) */
  positionSize: string;
}

const DEFAULT_CONFIG: AdverseSelectionFilterConfig = {
  markoutWindowMs: 60_000,
  markoutHistory: 20,
  minMarkoutScore: -0.005,
  toxicThreshold: -0.02,
  blacklistMs: 600_000,
  trendTicks: 5,
  trendThreshold: 0.02,
  takeProfitPct: 0.04,
  stopLossPct: 0.025,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 90_000,
  positionSize: '15',
};

const STRATEGY_NAME: StrategyName = 'adverse-selection-filter';

// ── Exported types ──────────────────────────────────────────────────────────

export interface MarkoutEntry {
  entryPrice: number;
  markoutPrice: number;
  pnl: number;
  timestamp: number;
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

interface PendingMarkout {
  conditionId: string;
  tokenId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  entryTime: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/**
 * Calculate the average markout score from a list of markout entries.
 * Returns 0 if no entries.
 */
export function calcMarkoutScore(entries: MarkoutEntry[], historyLimit: number): number {
  if (entries.length === 0) return 0;

  const slice = entries.slice(-historyLimit);
  let total = 0;
  for (const entry of slice) {
    total += entry.pnl;
  }
  return total / slice.length;
}

/**
 * Determine if a market is toxic based on its markout score.
 */
export function isToxic(markoutScore: number, toxicThreshold: number): boolean {
  return markoutScore < toxicThreshold;
}

/**
 * Detect a price trend from recent price history.
 * Returns 'up' if prices have trended upward by at least trendThreshold,
 * 'down' if downward, or null if no clear trend.
 */
export function detectTrend(
  prices: number[],
  trendTicks: number,
  trendThreshold: number,
): 'up' | 'down' | null {
  if (prices.length < trendTicks) return null;

  const recent = prices.slice(-trendTicks);
  const first = recent[0];
  const last = recent[recent.length - 1];

  if (first <= 0) return null;

  const change = (last - first) / first;

  if (change >= trendThreshold) return 'up';
  if (change <= -trendThreshold) return 'down';
  return null;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface AdverseSelectionFilterDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<AdverseSelectionFilterConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createAdverseSelectionFilterTick(deps: AdverseSelectionFilterDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: AdverseSelectionFilterConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
  const markoutHistory = new Map<string, MarkoutEntry[]>();
  const blacklist = new Map<string, number>(); // conditionId → blacklisted until timestamp
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();
  const pendingMarkouts: PendingMarkout[] = [];

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordPrice(tokenId: string, price: number): void {
    let history = priceHistory.get(tokenId);
    if (!history) {
      history = [];
      priceHistory.set(tokenId, history);
    }
    history.push(price);

    // Keep at most trendTicks * 3 prices
    const maxPrices = cfg.trendTicks * 3;
    if (history.length > maxPrices) {
      history.splice(0, history.length - maxPrices);
    }
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function isBlacklisted(conditionId: string): boolean {
    const until = blacklist.get(conditionId) ?? 0;
    return Date.now() < until;
  }

  function hasPosition(tokenId: string): boolean {
    return positions.some(p => p.tokenId === tokenId);
  }

  function getMarketMarkoutScore(conditionId: string): number | null {
    const entries = markoutHistory.get(conditionId);
    if (!entries || entries.length === 0) return null;
    return calcMarkoutScore(entries, cfg.markoutHistory);
  }

  function recordMarkout(conditionId: string, entry: MarkoutEntry): void {
    let entries = markoutHistory.get(conditionId);
    if (!entries) {
      entries = [];
      markoutHistory.set(conditionId, entries);
    }
    entries.push(entry);

    // Keep at most markoutHistory * 2 entries
    const maxEntries = cfg.markoutHistory * 2;
    if (entries.length > maxEntries) {
      entries.splice(0, entries.length - maxEntries);
    }

    // Check if market should be blacklisted
    const score = calcMarkoutScore(entries, cfg.markoutHistory);
    if (isToxic(score, cfg.toxicThreshold)) {
      blacklist.set(conditionId, Date.now() + cfg.blacklistMs);
      logger.info('Market blacklisted (toxic)', STRATEGY_NAME, {
        conditionId,
        markoutScore: score.toFixed(6),
      });
    }
  }

  // ── Markout resolution ────────────────────────────────────────────────

  async function resolveMarkouts(): Promise<void> {
    const now = Date.now();
    const toRemove: number[] = [];

    for (let i = 0; i < pendingMarkouts.length; i++) {
      const pm = pendingMarkouts[i];
      if (now - pm.entryTime < cfg.markoutWindowMs) continue;

      try {
        const book = await clob.getOrderBook(pm.tokenId);
        const ba = bestBidAsk(book);
        const markoutPrice = ba.mid;

        const pnl = pm.side === 'yes'
          ? markoutPrice - pm.entryPrice
          : pm.entryPrice - markoutPrice;

        recordMarkout(pm.conditionId, {
          entryPrice: pm.entryPrice,
          markoutPrice,
          pnl,
          timestamp: now,
        });

        toRemove.push(i);
      } catch {
        // If we can't get the price, skip for now
        continue;
      }
    }

    for (let i = toRemove.length - 1; i >= 0; i--) {
      pendingMarkouts.splice(toRemove[i], 1);
    }
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
        recordPrice(pos.tokenId, currentPrice);
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
      if (isBlacklisted(market.conditionId)) continue;

      // Check markout score: allow entry if no history (benefit of doubt)
      // or if score exceeds minimum
      const score = getMarketMarkoutScore(market.conditionId);
      if (score !== null && score <= cfg.minMarkoutScore) continue;

      try {
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        recordPrice(market.yesTokenId, ba.mid);

        // Check trend
        const prices = priceHistory.get(market.yesTokenId);
        if (!prices) continue;

        const trend = detectTrend(prices, cfg.trendTicks, cfg.trendThreshold);
        if (trend === null) continue;

        const side: 'yes' | 'no' = trend === 'up' ? 'yes' : 'no';
        const tokenId = side === 'yes'
          ? market.yesTokenId
          : (market.noTokenId ?? market.yesTokenId);
        const entryPrice = side === 'yes' ? ba.ask : (1 - ba.bid);
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

        // Register pending markout for this trade
        pendingMarkouts.push({
          conditionId: market.conditionId,
          tokenId,
          side,
          entryPrice,
          entryTime: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          entryPrice: entryPrice.toFixed(4),
          trend,
          markoutScore: score?.toFixed(6) ?? 'no-history',
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

  return async function adverseSelectionFilterTick(): Promise<void> {
    try {
      await resolveMarkouts();
      await checkExits();

      const markets = await gamma.getTrending(15);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceHistory.size,
        pendingMarkouts: pendingMarkouts.length,
        blacklistedMarkets: blacklist.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
