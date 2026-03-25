/**
 * News Catalyst Fade strategy for Polymarket binary markets.
 *
 * Detects sudden price spikes caused by news events and fades the overreaction.
 * After a large, fast move, prices often partially revert as the initial
 * panic/euphoria subsides.
 *
 * Signal logic:
 *   Track price snapshots per market with timestamps.
 *   Detect "spike": |price_change| > spikeThreshold within spikeWindowMs.
 *   After spike detected, wait for reversion setup: price starts pulling back
 *   toward pre-spike level.
 *   Reversion signal = price has reverted reversionPct of the spike already
 *   AND is still moving back.
 *   Entry: fade the spike direction (spike up → BUY NO, spike down → BUY YES).
 *   Track spike events with decay — only trade within fadeWindowMs after spike.
 *   Anti-chase: don't enter if price already reverted > maxReversionPct (move is done).
 *
 * Exit conditions:
 *   - Take-profit: price moved takeProfitPct in our favour
 *   - Stop-loss:   price moved stopLossPct against us
 *   - Max hold:    position older than maxHoldMs
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface NewsCatalystFadeConfig {
  /** Minimum |price_change| to qualify as a spike */
  spikeThreshold: number;
  /** Time window in ms to detect a spike */
  spikeWindowMs: number;
  /** Minimum fraction of spike that must have reverted before entry */
  reversionPct: number;
  /** Maximum reversion fraction — beyond this the move is done (anti-chase) */
  maxReversionPct: number;
  /** Window in ms after spike detection during which we can trade the fade */
  fadeWindowMs: number;
  /** Minimum tick volume to consider a market */
  minVolume: number;
  /** Take-profit as fraction of entry price */
  takeProfitPct: number;
  /** Stop-loss as fraction of entry price */
  stopLossPct: number;
  /** Max hold time in ms before forced exit */
  maxHoldMs: number;
  /** Max concurrent positions */
  maxPositions: number;
  /** Per-market cooldown after exit (ms) */
  cooldownMs: number;
  /** Trade size in USDC */
  positionSize: string;
  /** Max price snapshots to keep per market */
  maxSnapshots: number;
}

export const DEFAULT_CONFIG: NewsCatalystFadeConfig = {
  spikeThreshold: 0.08,
  spikeWindowMs: 60_000,
  reversionPct: 0.20,
  maxReversionPct: 0.70,
  fadeWindowMs: 300_000,
  minVolume: 8000,
  takeProfitPct: 0.035,
  stopLossPct: 0.025,
  maxHoldMs: 20 * 60_000,
  maxPositions: 3,
  cooldownMs: 180_000,
  positionSize: '12',
  maxSnapshots: 200,
};

const STRATEGY_NAME: StrategyName = 'news-catalyst-fade' as StrategyName;

// ── Internal types ───────────────────────────────────────────────────────────

export interface PriceSnapshot {
  price: number;
  timestamp: number;
  volume: number;
}

export interface SpikeEvent {
  /** Price just before the spike started */
  preSpike: number;
  /** Peak (or trough) price of the spike */
  peak: number;
  /** 'up' if price spiked up, 'down' if price spiked down */
  direction: 'up' | 'down';
  /** Timestamp when spike was detected */
  detectedAt: number;
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

/**
 * Detect a spike in the price snapshots.
 * A spike is a move of |price_change| > threshold within the given time window.
 * Returns the spike event or null if no spike detected.
 */
export function detectSpike(
  snapshots: PriceSnapshot[],
  threshold: number,
  windowMs: number,
): SpikeEvent | null {
  if (snapshots.length < 2) return null;

  const now = snapshots[snapshots.length - 1];
  const cutoff = now.timestamp - windowMs;

  // Find the earliest snapshot within the window
  let earliest: PriceSnapshot | null = null;
  for (const s of snapshots) {
    if (s.timestamp >= cutoff) {
      earliest = s;
      break;
    }
  }

  if (!earliest || earliest === now) return null;

  const priceChange = now.price - earliest.price;
  const absChange = Math.abs(priceChange);

  if (absChange < threshold) return null;

  // Find the peak/trough within the window
  let peak = now.price;
  for (const s of snapshots) {
    if (s.timestamp < cutoff) continue;
    if (priceChange > 0 && s.price > peak) peak = s.price;
    if (priceChange < 0 && s.price < peak) peak = s.price;
  }

  return {
    preSpike: earliest.price,
    peak,
    direction: priceChange > 0 ? 'up' : 'down',
    detectedAt: now.timestamp,
  };
}

/**
 * Calculate how much of the spike has reverted.
 * Returns a value between 0 (no reversion) and 1 (fully reverted).
 * Returns 0 if spike magnitude is 0.
 */
export function calcReversion(spike: SpikeEvent, currentPrice: number): number {
  const spikeMagnitude = spike.peak - spike.preSpike;
  if (spikeMagnitude === 0) return 0;

  const revertedAmount = spike.peak - currentPrice;
  // For an up-spike, reversion is positive when price comes back down
  // For a down-spike, spikeMagnitude is negative and revertedAmount is negative when price comes back up
  const reversion = revertedAmount / spikeMagnitude;

  return Math.max(0, Math.min(1, reversion));
}

/**
 * Determine if we should fade the spike.
 * Requirements:
 *   - Spike still within fadeWindowMs
 *   - Reversion between reversionPct and maxReversionPct (anti-chase)
 */
export function shouldFade(
  spike: SpikeEvent,
  currentPrice: number,
  now: number,
  reversionPct: number,
  maxReversionPct: number,
  fadeWindowMs: number,
): boolean {
  // Check if spike has expired
  if (now - spike.detectedAt > fadeWindowMs) return false;

  const reversion = calcReversion(spike, currentPrice);

  // Must have reverted at least reversionPct
  if (reversion < reversionPct) return false;

  // Anti-chase: don't enter if too much reversion already happened
  if (reversion > maxReversionPct) return false;

  return true;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Extract mid price from raw order book. */
function bestMid(book: RawOrderBook): number {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return (bid + ask) / 2;
}

/** Extract best ask from raw order book. */
function bestAsk(book: RawOrderBook): number {
  return book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
}

/** Estimate tick volume from order book depth. */
function estimateVolume(book: RawOrderBook): number {
  let vol = 0;
  for (const b of book.bids) vol += parseFloat(b.size);
  for (const a of book.asks) vol += parseFloat(a.size);
  return vol;
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface NewsCatalystFadeDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<NewsCatalystFadeConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createNewsCatalystFadeTick(deps: NewsCatalystFadeDeps): () => Promise<void> {
  const { clob, orderManager, eventBus, gamma } = deps;
  const cfg: NewsCatalystFadeConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Internal state
  const priceSnapshots = new Map<string, PriceSnapshot[]>();
  const detectedSpikes = new Map<string, SpikeEvent>();
  const positions: OpenPosition[] = [];
  const cooldowns = new Map<string, number>();

  // ── Helpers ──────────────────────────────────────────────────────────────

  function recordSnapshot(tokenId: string, price: number, volume: number): void {
    let arr = priceSnapshots.get(tokenId);
    if (!arr) {
      arr = [];
      priceSnapshots.set(tokenId, arr);
    }
    arr.push({ price, timestamp: Date.now(), volume });
    if (arr.length > cfg.maxSnapshots) {
      arr.splice(0, arr.length - cfg.maxSnapshots);
    }
  }

  function isOnCooldown(tokenId: string): boolean {
    const until = cooldowns.get(tokenId) ?? 0;
    return Date.now() < until;
  }

  function hasPositionFor(tokenId: string): boolean {
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

      let currentMid: number;
      try {
        const book = await clob.getOrderBook(pos.tokenId);
        currentMid = bestMid(book);
        const vol = estimateVolume(book);
        recordSnapshot(pos.tokenId, currentMid, vol);
      } catch {
        continue;
      }

      // Compute current PnL relative to entry
      const priceDelta = pos.side === 'yes'
        ? currentMid - pos.entryPrice
        : pos.entryPrice - currentMid;
      const pnlPct = priceDelta / pos.entryPrice;

      // Take-profit
      if (pnlPct >= cfg.takeProfitPct) {
        shouldExit = true;
        reason = `take-profit (pnl=${(pnlPct * 100).toFixed(2)}%)`;
      }

      // Stop-loss
      if (!shouldExit && pnlPct <= -cfg.stopLossPct) {
        shouldExit = true;
        reason = `stop-loss (pnl=${(pnlPct * 100).toFixed(2)}%)`;
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
            price: currentMid.toFixed(4),
            size: String(Math.round(pos.sizeUsdc / currentMid)),
            orderType: 'IOC',
          });

          const totalPnl = priceDelta * (pos.sizeUsdc / pos.entryPrice);

          logger.info('Exit position', STRATEGY_NAME, {
            tokenId: pos.tokenId,
            pnl: totalPnl.toFixed(4),
            reason,
          });

          eventBus.emit('trade.executed', {
            trade: {
              orderId: pos.orderId,
              marketId: pos.tokenId,
              side: 'sell',
              fillPrice: String(currentMid),
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

  async function scanEntries(): Promise<void> {
    if (positions.length >= cfg.maxPositions) return;

    const events = await gamma.getEvents(10);

    for (const event of events) {
      if (positions.length >= cfg.maxPositions) break;

      const activeMarkets = event.markets.filter(
        (m: GammaMarket) => m.yesTokenId && !m.closed && !m.resolved && m.active,
      );

      for (const market of activeMarkets) {
        if (positions.length >= cfg.maxPositions) break;

        const yesTokenId = market.yesTokenId;
        if (!yesTokenId) continue;
        if (hasPositionFor(yesTokenId)) continue;
        if (market.noTokenId && hasPositionFor(market.noTokenId)) continue;
        if (isOnCooldown(yesTokenId)) continue;
        if (market.noTokenId && isOnCooldown(market.noTokenId)) continue;

        // Fetch order book
        let mid: number;
        let volume: number;
        try {
          const book = await clob.getOrderBook(yesTokenId);
          mid = bestMid(book);
          volume = estimateVolume(book);
          if (mid <= 0 || mid >= 1) continue;
          recordSnapshot(yesTokenId, mid, volume);
        } catch {
          continue;
        }

        // Check minimum volume
        if (volume < cfg.minVolume) continue;

        // Get snapshots
        const snapshots = priceSnapshots.get(yesTokenId);
        if (!snapshots || snapshots.length < 3) continue;

        // Try to detect a new spike
        const spike = detectSpike(snapshots, cfg.spikeThreshold, cfg.spikeWindowMs);
        if (spike) {
          // Record or update detected spike for this token
          const existing = detectedSpikes.get(yesTokenId);
          if (!existing || spike.detectedAt > existing.detectedAt) {
            detectedSpikes.set(yesTokenId, spike);
          }
        }

        // Check if we have a spike to fade
        const activeSpike = detectedSpikes.get(yesTokenId);
        if (!activeSpike) continue;

        // Check if spike has expired
        const now = Date.now();
        if (now - activeSpike.detectedAt > cfg.fadeWindowMs) {
          detectedSpikes.delete(yesTokenId);
          continue;
        }

        // Check fade conditions
        if (!shouldFade(activeSpike, mid, now, cfg.reversionPct, cfg.maxReversionPct, cfg.fadeWindowMs)) {
          continue;
        }

        // Determine direction: fade the spike
        // Spike up → BUY NO (expect price to come back down)
        // Spike down → BUY YES (expect price to come back up)
        const side: 'yes' | 'no' = activeSpike.direction === 'up' ? 'no' : 'yes';
        const entryTokenId = side === 'yes' ? yesTokenId : (market.noTokenId ?? yesTokenId);

        let entryPrice: number;
        try {
          const book = await clob.getOrderBook(entryTokenId);
          entryPrice = bestAsk(book);
        } catch {
          continue;
        }

        const posSize = parseFloat(cfg.positionSize);

        try {
          const order = await orderManager.placeOrder({
            tokenId: entryTokenId,
            side: 'buy',
            price: entryPrice.toFixed(4),
            size: String(Math.round(posSize / entryPrice)),
            orderType: 'GTC',
          });

          positions.push({
            tokenId: entryTokenId,
            conditionId: market.conditionId,
            side,
            entryPrice,
            sizeUsdc: posSize,
            orderId: order.id,
            openedAt: Date.now(),
          });

          logger.info('Entry news-catalyst-fade', STRATEGY_NAME, {
            tokenId: entryTokenId,
            side,
            entryPrice: entryPrice.toFixed(4),
            spikeDirection: activeSpike.direction,
            preSpike: activeSpike.preSpike.toFixed(4),
            peak: activeSpike.peak.toFixed(4),
            reversion: calcReversion(activeSpike, mid).toFixed(4),
            size: posSize,
          });

          eventBus.emit('trade.executed', {
            trade: {
              orderId: order.id,
              marketId: entryTokenId,
              side: 'buy',
              fillPrice: String(entryPrice),
              fillSize: String(posSize),
              fees: '0',
              timestamp: Date.now(),
              strategy: STRATEGY_NAME,
            },
          });

          // Clear spike after entry
          detectedSpikes.delete(yesTokenId);
        } catch (err) {
          logger.debug('Entry failed', STRATEGY_NAME, {
            tokenId: entryTokenId,
            err: String(err),
          });
        }
      }
    }
  }

  // ── Main tick ──────────────────────────────────────────────────────────

  return async function newsCatalystFadeTick(): Promise<void> {
    try {
      await checkExits();
      await scanEntries();

      logger.debug('Tick complete', STRATEGY_NAME, {
        openPositions: positions.length,
        trackedMarkets: priceSnapshots.size,
        activeSpikes: detectedSpikes.size,
      });
    } catch (err) {
      logger.error('Tick failed', STRATEGY_NAME, { err: String(err) });
    }
  };
}
