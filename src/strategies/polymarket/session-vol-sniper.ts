/**
 * Session-Biased Volatility Sniper for Polymarket binary markets.
 *
 * Exploits predictable intra-day volatility patterns: session opens (London,
 * US, Asia) and resolution windows produce short-lived volatility spikes that
 * tend to mean-revert. The strategy detects when 5-minute realized volatility
 * exceeds the 1-hour baseline by a configurable multiplier, then enters a
 * mean-reversion trade opposite to the dominant short-term momentum.
 *
 * Signal logic:
 *   vol5m       = realized volatility over last 5 minutes of ticks
 *   volBaseline = realized volatility over last 1 hour of ticks
 *   momentum5m  = price change direction over last 5 minutes
 *
 *   vol5m > volBaseline × spikeMultiplier AND isActiveSession()
 *     → enter OPPOSITE to momentum (mean reversion during vol spike)
 *
 * Sessions (UTC):
 *   London Open:       08:00–09:00
 *   US Market Open:    13:30–14:30
 *   Asia Open:         00:00–02:00
 *   Resolution Window: last 30 min before market endDate
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { KellyPositionSizer } from '../../polymarket/kelly-position-sizer.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface SessionVolSniperConfig {
  /** Multiplier: trigger when vol5m > baseline × this */
  spikeMultiplier: number;
  /** Min ticks needed for 5-min vol calculation */
  minShortTicks: number;
  /** Min ticks needed for 1-hour baseline calculation */
  minBaselineTicks: number;
  /** Short window duration in ms (5 minutes) */
  shortWindowMs: number;
  /** Baseline window duration in ms (1 hour) */
  baselineWindowMs: number;
  /** Trade size in USDC */
  sizeUsdc: number;
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
  /** Max markets to scan per tick */
  scanLimit: number;
  /** Resolution window: minutes before market end to consider active */
  resolutionWindowMinutes: number;
}

const DEFAULT_CONFIG: SessionVolSniperConfig = {
  spikeMultiplier: 2.0,
  minShortTicks: 5,
  minBaselineTicks: 20,
  shortWindowMs: 5 * 60_000,
  baselineWindowMs: 60 * 60_000,
  sizeUsdc: 25,
  maxPositions: 4,
  takeProfitPct: 0.02,
  stopLossPct: 0.015,
  maxHoldMs: 15 * 60_000,
  cooldownMs: 90_000,
  scanLimit: 15,
  resolutionWindowMinutes: 30,
};

const STRATEGY_NAME: StrategyName = 'session-vol-sniper';

// ── Session definitions (UTC hours) ─────────────────────────────────────────

export type SessionName = 'london-open' | 'us-open' | 'asia-open' | 'resolution-window' | 'off-session';

interface SessionWindow {
  name: SessionName;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

const SESSIONS: SessionWindow[] = [
  { name: 'asia-open', startHour: 0, startMinute: 0, endHour: 2, endMinute: 0 },
  { name: 'london-open', startHour: 8, startMinute: 0, endHour: 9, endMinute: 0 },
  { name: 'us-open', startHour: 13, startMinute: 30, endHour: 14, endMinute: 30 },
];

// ── Internal types ───────────────────────────────────────────────────────────

interface PriceTick {
  price: number;
  timestamp: number;
}

interface OpenPosition {
  tokenId: string;
  conditionId: string;
  side: 'yes' | 'no';
  entryPrice: number;
  session: SessionName;
  sizeUsdc: number;
  orderId: string;
  openedAt: number;
}

// ── Pure helpers (exported for testing) ──────────────────────────────────────

/** Determine current active session based on UTC time. */
export function detectSession(now: Date, marketEndDate?: string, resolutionWindowMinutes = 30): SessionName {
  // Check resolution window first
  if (marketEndDate) {
    const endTime = new Date(marketEndDate).getTime();
    const windowStart = endTime - resolutionWindowMinutes * 60_000;
    if (now.getTime() >= windowStart && now.getTime() < endTime) {
      return 'resolution-window';
    }
  }

  const totalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

  for (const session of SESSIONS) {
    const start = session.startHour * 60 + session.startMinute;
    const end = session.endHour * 60 + session.endMinute;
    if (totalMinutes >= start && totalMinutes < end) {
      return session.name;
    }
  }

  return 'off-session';
}

/** Compute realized volatility (standard deviation of returns) from price ticks. */
export function calcRealizedVol(ticks: PriceTick[]): number {
  if (ticks.length < 2) return 0;

  const returns: number[] = [];
  for (let i = 1; i < ticks.length; i++) {
    if (ticks[i - 1].price > 0) {
      returns.push((ticks[i].price - ticks[i - 1].price) / ticks[i - 1].price);
    }
  }

  if (returns.length === 0) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  return Math.sqrt(variance);
}

/** Detect if a volatility spike is present. */
export function detectVolSpike(vol5m: number, volBaseline: number, multiplier: number): boolean {
  if (volBaseline <= 0) return false;
  return vol5m > volBaseline * multiplier;
}

/** Determine short-term momentum direction from price ticks. */
export function detectMomentum(ticks: PriceTick[]): 'up' | 'down' | 'flat' {
  if (ticks.length < 2) return 'flat';
  const first = ticks[0].price;
  const last = ticks[ticks.length - 1].price;
  const change = (last - first) / first;
  if (change > 0.002) return 'up';
  if (change < -0.002) return 'down';
  return 'flat';
}

/** Filter ticks within a time window. */
export function filterTicksByWindow(ticks: PriceTick[], windowMs: number, now: number): PriceTick[] {
  const cutoff = now - windowMs;
  return ticks.filter(t => t.timestamp >= cutoff);
}

/** Extract mid price from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface SessionVolSniperDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  kellySizer?: KellyPositionSizer;
  config?: Partial<SessionVolSniperConfig>;
  /** Injectable clock for testing (defaults to () => new Date()) */
  clock?: () => Date;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createSessionVolSniperTick(deps: SessionVolSniperDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma, kellySizer } = deps;
  const cfg: SessionVolSniperConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const clock = deps.clock ?? (() => new Date());

  // Per-market state
  const tickHistory = new Map<string, PriceTick[]>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordTick(tokenId: string, price: number): void {
    let history = tickHistory.get(tokenId);
    if (!history) {
      history = [];
      tickHistory.set(tokenId, history);
    }
    history.push({ price, timestamp: Date.now() });
    // Keep 2 hours of data max
    const cutoff = Date.now() - cfg.baselineWindowMs * 2;
    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
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
        recordTick(pos.tokenId, currentPrice);
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
            session: pos.session,
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
    const now = Date.now();

    for (const market of markets) {
      if (positions.length >= cfg.maxPositions) break;
      if (!market.yesTokenId || market.closed || market.resolved) continue;
      if (hasPosition(market.yesTokenId)) continue;
      if (market.noTokenId && hasPosition(market.noTokenId)) continue;
      if (isOnCooldown(market.yesTokenId)) continue;

      // Detect session
      const session = detectSession(clock(), market.endDate, cfg.resolutionWindowMinutes);
      if (session === 'off-session') continue;

      try {
        const book = await clob.getOrderBook(market.yesTokenId);
        const ba = bestBidAsk(book);
        if (ba.mid <= 0 || ba.mid >= 1) continue;

        recordTick(market.yesTokenId, ba.mid);

        // Get tick windows
        const allTicks = tickHistory.get(market.yesTokenId) ?? [];
        const shortTicks = filterTicksByWindow(allTicks, cfg.shortWindowMs, now);
        const baselineTicks = filterTicksByWindow(allTicks, cfg.baselineWindowMs, now);

        if (shortTicks.length < cfg.minShortTicks) continue;
        if (baselineTicks.length < cfg.minBaselineTicks) continue;

        // Calculate volatility
        const vol5m = calcRealizedVol(shortTicks);
        const volBaseline = calcRealizedVol(baselineTicks);

        if (!detectVolSpike(vol5m, volBaseline, cfg.spikeMultiplier)) continue;

        // Detect momentum → enter opposite direction (mean reversion)
        const momentum = detectMomentum(shortTicks);
        if (momentum === 'flat') continue;

        // Mean reversion: if price went up → buy NO, if price went down → buy YES
        const side: 'yes' | 'no' = momentum === 'up' ? 'no' : 'yes';
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
          session,
          sizeUsdc: posSize,
          orderId: order.id,
          openedAt: Date.now(),
        });

        logger.info('Entry position', STRATEGY_NAME, {
          conditionId: market.conditionId,
          side,
          session,
          entryPrice: entryPrice.toFixed(4),
          vol5m: vol5m.toFixed(6),
          volBaseline: volBaseline.toFixed(6),
          momentum,
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

  return async function sessionVolSniperTick(): Promise<void> {
    try {
      await checkExits();

      const markets = await gamma.getTrending(cfg.scanLimit);

      await scanEntries(markets);

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: tickHistory.size,
        currentSession: detectSession(clock()),
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
