/**
 * Markov Chain Predictor strategy for Polymarket binary markets.
 *
 * Models price movements as a discrete Markov chain with states (up/down/flat).
 * Estimates transition probabilities from recent history, then predicts the most
 * likely next state. Trades when the predicted state has high confidence.
 *
 * Signal logic:
 *   1. Discretize price changes into states: 'up' (>threshold), 'down' (<-threshold), 'flat'
 *   2. Build transition matrix from recent state history
 *   3. Given current state, find most probable next state
 *   4. When P(next=up|current) > confidence → BUY YES
 *   5. When P(next=down|current) > confidence → BUY NO
 */
import type { ClobClient, RawOrderBook } from '../../polymarket/clob-client.js';
import type { OrderManager } from '../../polymarket/order-manager.js';
import type { EventBus } from '../../events/event-bus.js';
import type { GammaClient, GammaMarket } from '../../polymarket/gamma-client.js';
import type { StrategyName } from '../../core/types.js';
import { logger } from '../../core/logger.js';

// ── Config ───────────────────────────────────────────────────────────────────

export interface MarkovChainPredictorConfig {
  /** Price change > this = up/down, otherwise flat */
  stateThreshold: number;
  /** Number of states to build transition matrix */
  historyWindow: number;
  /** Minimum probability to trade */
  confidenceThreshold: number;
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

export const DEFAULT_CONFIG: MarkovChainPredictorConfig = {
  stateThreshold: 0.005,
  historyWindow: 30,
  confidenceThreshold: 0.6,
  minVolume: 5000,
  takeProfitPct: 0.025,
  stopLossPct: 0.02,
  maxHoldMs: 15 * 60_000,
  maxPositions: 4,
  cooldownMs: 120_000,
  positionSize: '10',
};

const STRATEGY_NAME = 'markov-chain-predictor' as StrategyName;

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
 * Discretize a price change into a state label.
 * Returns 'up' if change > threshold, 'down' if change < -threshold, otherwise 'flat'.
 */
export function discretizeChange(change: number, threshold: number): 'up' | 'down' | 'flat' {
  if (change > threshold) return 'up';
  if (change < -threshold) return 'down';
  return 'flat';
}

/**
 * Build a transition matrix from a sequence of states.
 * Returns a Map where each key is a source state and the value is a Map
 * of destination states to transition probabilities (normalized).
 */
export function buildTransitionMatrix(states: string[]): Map<string, Map<string, number>> {
  const counts = new Map<string, Map<string, number>>();

  for (let i = 0; i < states.length - 1; i++) {
    const from = states[i];
    const to = states[i + 1];

    let row = counts.get(from);
    if (!row) {
      row = new Map<string, number>();
      counts.set(from, row);
    }
    row.set(to, (row.get(to) ?? 0) + 1);
  }

  // Normalize to probabilities
  const matrix = new Map<string, Map<string, number>>();
  for (const [from, row] of counts) {
    let total = 0;
    for (const count of row.values()) total += count;

    const probRow = new Map<string, number>();
    for (const [to, count] of row) {
      probRow.set(to, total > 0 ? count / total : 0);
    }
    matrix.set(from, probRow);
  }

  return matrix;
}

/**
 * Given a transition matrix and a current state, predict the most probable next state.
 * Returns null if the current state has no transitions.
 */
export function predictNextState(
  matrix: Map<string, Map<string, number>>,
  currentState: string,
): { state: string; probability: number } | null {
  const row = matrix.get(currentState);
  if (!row || row.size === 0) return null;

  let bestState = '';
  let bestProb = -1;

  for (const [state, prob] of row) {
    if (prob > bestProb) {
      bestProb = prob;
      bestState = state;
    }
  }

  if (bestProb < 0) return null;
  return { state: bestState, probability: bestProb };
}

/**
 * Convert a price series to a state series by discretizing consecutive changes.
 * Returns an array of states with length = prices.length - 1.
 */
export function pricesToStates(prices: number[], threshold: number): string[] {
  const states: string[] = [];
  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    states.push(discretizeChange(change, threshold));
  }
  return states;
}

/** Extract best bid/ask/mid from raw order book. */
function bestBidAsk(book: RawOrderBook): { bid: number; ask: number; mid: number } {
  const bid = book.bids.length > 0 ? parseFloat(book.bids[0].price) : 0;
  const ask = book.asks.length > 0 ? parseFloat(book.asks[0].price) : 1;
  return { bid, ask, mid: (bid + ask) / 2 };
}

// ── Dependencies ─────────────────────────────────────────────────────────────

export interface MarkovChainPredictorDeps {
  clob: ClobClient;
  orderManager: OrderManager;
  eventBus: EventBus;
  gamma: GammaClient;
  config?: Partial<MarkovChainPredictorConfig>;
}

// ── Tick factory ─────────────────────────────────────────────────────────────

export function createMarkovChainPredictorTick(deps: MarkovChainPredictorDeps): () => Promise<void> {
  const {
    clob,
    orderManager,
    eventBus,
    gamma,
  } = deps;
  const cfg: MarkovChainPredictorConfig = { ...DEFAULT_CONFIG, ...deps.config };

  // Per-market state
  const priceHistory = new Map<string, number[]>();
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

    // Keep only historyWindow + 1 prices (need +1 to produce historyWindow states)
    const maxLen = cfg.historyWindow + 1;
    if (history.length > maxLen) {
      history.splice(0, history.length - maxLen);
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

        // Need at least 3 prices to get 2 states (minimum for a transition)
        if (prices.length < 3) continue;

        // Convert to states
        const states = pricesToStates(prices, cfg.stateThreshold);
        if (states.length < 2) continue;

        // Build transition matrix
        const matrix = buildTransitionMatrix(states);

        // Current state is last in the sequence
        const currentState = states[states.length - 1];

        // Predict next state
        const prediction = predictNextState(matrix, currentState);
        if (!prediction) continue;

        // Check confidence
        if (prediction.probability < cfg.confidenceThreshold) continue;

        // Determine signal
        let side: 'yes' | 'no';
        if (prediction.state === 'up') {
          side = 'yes';
        } else if (prediction.state === 'down') {
          side = 'no';
        } else {
          // flat prediction → no trade
          continue;
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
          currentState,
          predictedState: prediction.state,
          confidence: prediction.probability.toFixed(4),
          stateCount: states.length,
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

  return async function markovChainPredictorTick(): Promise<void> {
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
