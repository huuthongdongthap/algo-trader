/**
 * Strategy Backtest Harness for Polymarket tick-based strategies.
 *
 * Replays historical candle data through strategy tick functions by mocking
 * ClobClient, GammaClient, OrderManager, and EventBus. Tracks simulated
 * orders/fills and computes performance metrics.
 */

import type { Order } from '../core/types.js';
import type { RawOrderBook, OrderBookLevel, RawPrice, OrderArgs } from '../polymarket/clob-client.js';
import type { GammaMarket, GammaMarketGroup } from '../polymarket/gamma-client.js';

// ─── Public interfaces ──────────────────────────────────────────────────────

export interface BacktestConfig {
  strategyName: string;
  startDate: string;
  endDate: string;
  initialCapital: number;
  tickIntervalMs: number;
  /** Fee rate per trade as decimal (default 0.001 = 0.1%) */
  feeRate?: number;
}

export interface BacktestCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BacktestTrade {
  entryTime: number;
  exitTime: number;
  side: 'buy-yes' | 'buy-no';
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  fees: number;
}

export interface BacktestResult {
  strategyName: string;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  profitFactor: number;
  totalPnl: number;
  totalFees: number;
  startEquity: number;
  endEquity: number;
  equityCurve: { timestamp: number; equity: number }[];
  trades: BacktestTrade[];
}

// ─── Seeded PRNG (Linear Congruential Generator) ────────────────────────────

function createLCG(seed: number): () => number {
  let state = seed;
  return (): number => {
    // Numerical Recipes LCG parameters
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// ─── Synthetic data generation ──────────────────────────────────────────────

export function generateSyntheticData(config: {
  ticks: number;
  startPrice: number;
  volatility: number;
  trend: number;
  seed?: number;
}): BacktestCandle[] {
  const { ticks, startPrice, volatility, trend, seed = 42 } = config;
  const random = createLCG(seed);
  const candles: BacktestCandle[] = [];
  let price = startPrice;
  // Use fixed base when seed is provided for reproducibility; otherwise use current time
  const baseTimestamp = config.seed !== undefined ? 1_700_000_000_000 : Date.now();

  for (let i = 0; i < ticks; i++) {
    // Geometric Brownian Motion: dS/S = mu*dt + sigma*dW
    // Box-Muller transform for normal variate
    const u1 = random();
    const u2 = random();
    const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);

    const dt = 1; // one period
    const drift = trend * dt;
    const diffusion = volatility * Math.sqrt(dt) * z;
    const returnPct = drift + diffusion;

    const open = price;
    price = price * Math.exp(returnPct);
    const close = price;

    // Generate high/low within the candle
    const intraVol = volatility * 0.5;
    const high = Math.max(open, close) * (1 + Math.abs(random() * intraVol));
    const low = Math.min(open, close) * (1 - Math.abs(random() * intraVol));
    const volume = 1000 + random() * 9000;

    candles.push({
      timestamp: baseTimestamp + i * 60_000,
      open,
      high,
      low: Math.max(low, 1e-8), // keep prices > 0
      close: Math.max(close, 1e-8),
      volume,
    });
  }

  return candles;
}

// ─── Pure metric helpers ────────────────────────────────────────────────────

export function calcSharpeRatio(returns: number[], riskFreeRate = 0): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  const dailyRf = riskFreeRate / 252;
  return ((mean - dailyRf) / std) * Math.sqrt(252);
}

export function calcMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

export function calcProfitFactor(trades: BacktestTrade[]): number {
  let grossProfit = 0;
  let grossLoss = 0;
  for (const t of trades) {
    if (t.pnl > 0) grossProfit += t.pnl;
    else grossLoss += Math.abs(t.pnl);
  }
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

export function calcWinRate(trades: BacktestTrade[]): number {
  if (trades.length === 0) return 0;
  const wins = trades.filter(t => t.pnl > 0).length;
  return wins / trades.length;
}

// ─── Mock factories ─────────────────────────────────────────────────────────

function buildOrderBookFromCandle(candle: BacktestCandle): RawOrderBook {
  const mid = candle.close;
  const spread = Math.max(0.001, (candle.high - candle.low) * 0.1);
  const bidPrice = Math.max(0.001, mid - spread / 2);
  const askPrice = Math.min(0.999, mid + spread / 2);

  const levels = 5;
  const bids: OrderBookLevel[] = [];
  const asks: OrderBookLevel[] = [];

  for (let i = 0; i < levels; i++) {
    bids.push({
      price: (bidPrice - i * 0.005).toFixed(4),
      size: String(Math.round(candle.volume / levels)),
    });
    asks.push({
      price: (askPrice + i * 0.005).toFixed(4),
      size: String(Math.round(candle.volume / levels)),
    });
  }

  return {
    market: 'backtest-market',
    asset_id: 'backtest-token-yes',
    bids,
    asks,
    hash: '',
  };
}

function buildPriceFromCandle(candle: BacktestCandle): RawPrice {
  const book = buildOrderBookFromCandle(candle);
  return {
    mid: String(candle.close),
    bid: book.bids[0].price,
    ask: book.asks[0].price,
  };
}

/** Fixed set of test markets for mocked GammaClient */
function testMarkets(): GammaMarket[] {
  return [
    {
      id: 'test-market-1',
      question: 'Will test event happen?',
      slug: 'test-event',
      conditionId: 'cond-1',
      yesTokenId: 'backtest-token-yes',
      noTokenId: 'backtest-token-no',
      yesPrice: 0.5,
      noPrice: 0.5,
      volume: 100_000,
      volume24h: 10_000,
      liquidity: 50_000,
      endDate: '2030-01-01',
      active: true,
      closed: false,
      resolved: false,
      outcome: null,
    },
  ];
}

function testEvents(): GammaMarketGroup[] {
  return [
    {
      id: 'test-event-group-1',
      title: 'Test Event Group',
      slug: 'test-event-group',
      description: 'A group of test markets',
      markets: testMarkets(),
    },
  ];
}

interface MockOrderRecord {
  id: string;
  marketId: string;
  side: 'buy' | 'sell';
  price: string;
  size: string;
  status: 'open' | 'filled';
  type: 'limit';
  createdAt: number;
  filledSize: string;
  lastCheckedAt: number;
  tokenId: string;
  orderType: string;
}

// ─── Main backtest runner ───────────────────────────────────────────────────

export async function runStrategyBacktest(
  config: BacktestConfig,
  data: BacktestCandle[],
  createTickFn: (deps: any) => () => Promise<void>,
): Promise<BacktestResult> {
  const feeRate = config.feeRate ?? 0.001;

  // ── State ──────────────────────────────────────────────────────────────
  let currentCandleIdx = 0;
  const allOrders: MockOrderRecord[] = [];
  const events: Array<{ name: string; data: unknown }> = [];

  // Position tracking for PnL
  interface OpenPos {
    side: 'buy-yes' | 'buy-no';
    entryPrice: number;
    size: number;
    entryTime: number;
    entryFee: number;
  }
  const openPositions: OpenPos[] = [];
  const completedTrades: BacktestTrade[] = [];

  let equity = config.initialCapital;
  let totalFees = 0;
  const equityCurve: { timestamp: number; equity: number }[] = [];

  // ── Mock ClobClient ────────────────────────────────────────────────────
  const mockClob = {
    isPaperMode: true,
    getOrderBook: async (_tokenId: string): Promise<RawOrderBook> => {
      return buildOrderBookFromCandle(data[currentCandleIdx]);
    },
    getPrice: async (_tokenId: string): Promise<RawPrice> => {
      return buildPriceFromCandle(data[currentCandleIdx]);
    },
    getMarkets: async () => [],
    postOrder: async (args: OrderArgs): Promise<Order> => {
      const candle = data[currentCandleIdx];
      const orderId = `bt-order-${allOrders.length}`;
      const record: MockOrderRecord = {
        id: orderId,
        marketId: args.tokenId,
        side: args.side,
        price: args.price,
        size: args.size,
        status: 'filled',
        type: 'limit',
        createdAt: candle.timestamp,
        filledSize: args.size,
        lastCheckedAt: candle.timestamp,
        tokenId: args.tokenId,
        orderType: args.orderType ?? 'GTC',
      };
      allOrders.push(record);

      const price = parseFloat(args.price);
      const size = parseFloat(args.size);
      const fee = price * size * feeRate;
      totalFees += fee;

      // Determine if this is an entry or exit
      const isYesToken = args.tokenId.includes('yes');
      const isNoToken = args.tokenId.includes('no');

      if (args.side === 'buy') {
        // Opening a position
        const posSide: 'buy-yes' | 'buy-no' = isNoToken ? 'buy-no' : 'buy-yes';
        openPositions.push({
          side: posSide,
          entryPrice: price,
          size,
          entryTime: candle.timestamp,
          entryFee: fee,
        });
      } else {
        // Closing — match against oldest open position for this token direction
        const idx = openPositions.findIndex(p =>
          (isYesToken && p.side === 'buy-yes') ||
          (isNoToken && p.side === 'buy-no') ||
          // Fallback: match any
          (!isYesToken && !isNoToken),
        );
        if (idx >= 0) {
          const pos = openPositions[idx];
          openPositions.splice(idx, 1);

          let pnl: number;
          if (pos.side === 'buy-yes') {
            pnl = (price - pos.entryPrice) * pos.size;
          } else {
            pnl = (pos.entryPrice - price) * pos.size;
          }
          const totalTradeFees = pos.entryFee + fee;
          pnl -= totalTradeFees;

          completedTrades.push({
            entryTime: pos.entryTime,
            exitTime: candle.timestamp,
            side: pos.side,
            entryPrice: pos.entryPrice,
            exitPrice: price,
            size: pos.size,
            pnl,
            fees: totalTradeFees,
          });

          equity += pnl;
        }
      }

      return {
        id: orderId,
        marketId: args.tokenId,
        side: args.side,
        price: args.price,
        size: args.size,
        status: 'open',
        type: 'limit',
        createdAt: candle.timestamp,
      };
    },
    placeLimitOrder: async (args: OrderArgs): Promise<Order> => {
      return mockClob.postOrder(args);
    },
    cancelOrder: async (_orderId: string): Promise<boolean> => true,
  };

  // ── Mock OrderManager ──────────────────────────────────────────────────
  const mockOrderManager = {
    placeOrder: async (args: OrderArgs) => {
      const order = await mockClob.postOrder(args);
      return { ...order, filledSize: args.size, lastCheckedAt: Date.now() };
    },
    cancelOrder: async (orderId: string) => mockClob.cancelOrder(orderId),
    getOpenOrders: () => [],
    getOrder: (id: string) => allOrders.find(o => o.id === id) ?? null,
  };

  // ── Mock GammaClient ──────────────────────────────────────────────────
  const mockGamma = {
    getTrending: async (_limit?: number): Promise<GammaMarket[]> => testMarkets(),
    getEvents: async (_limit?: number): Promise<GammaMarketGroup[]> => testEvents(),
    search: async (_query: string, _limit?: number): Promise<GammaMarket[]> => testMarkets(),
    getMarket: async (_id: string): Promise<GammaMarket> => testMarkets()[0],
    getMarketBySlug: async (_slug: string): Promise<GammaMarket> => testMarkets()[0],
    getPrices: async (tokenIds: string[]): Promise<Record<string, number>> => {
      const candle = data[currentCandleIdx];
      const result: Record<string, number> = {};
      for (const id of tokenIds) result[id] = candle.close;
      return result;
    },
  };

  // ── Mock EventBus ─────────────────────────────────────────────────────
  const mockEventBus = {
    emit: (name: string, eventData: unknown): boolean => {
      events.push({ name, data: eventData });
      return true;
    },
    on: () => mockEventBus,
    once: () => mockEventBus,
    off: () => mockEventBus,
    removeAllListeners: () => mockEventBus,
  };

  // ── Create tick function ──────────────────────────────────────────────
  const deps = {
    clob: mockClob,
    orderManager: mockOrderManager,
    eventBus: mockEventBus,
    gamma: mockGamma,
  };

  const tick = createTickFn(deps);

  // ── Replay data ───────────────────────────────────────────────────────
  equityCurve.push({ timestamp: data[0]?.timestamp ?? 0, equity: config.initialCapital });

  for (let i = 0; i < data.length; i++) {
    currentCandleIdx = i;
    await tick();
    equityCurve.push({ timestamp: data[i].timestamp, equity });
  }

  // Close any remaining open positions at last candle price
  const lastCandle = data[data.length - 1];
  if (lastCandle) {
    for (const pos of openPositions) {
      const exitPrice = lastCandle.close;
      const fee = exitPrice * pos.size * feeRate;
      totalFees += fee;
      let pnl: number;
      if (pos.side === 'buy-yes') {
        pnl = (exitPrice - pos.entryPrice) * pos.size;
      } else {
        pnl = (pos.entryPrice - exitPrice) * pos.size;
      }
      pnl -= (pos.entryFee + fee);
      completedTrades.push({
        entryTime: pos.entryTime,
        exitTime: lastCandle.timestamp,
        side: pos.side,
        entryPrice: pos.entryPrice,
        exitPrice,
        size: pos.size,
        pnl,
        fees: pos.entryFee + fee,
      });
      equity += pnl;
    }
    openPositions.length = 0;
  }

  // ── Compute metrics ───────────────────────────────────────────────────
  const equityValues = equityCurve.map(e => e.equity);
  const returns: number[] = [];
  for (let i = 1; i < equityValues.length; i++) {
    if (equityValues[i - 1] > 0) {
      returns.push((equityValues[i] - equityValues[i - 1]) / equityValues[i - 1]);
    }
  }

  return {
    strategyName: config.strategyName,
    totalTrades: completedTrades.length,
    winRate: calcWinRate(completedTrades),
    sharpeRatio: calcSharpeRatio(returns),
    maxDrawdown: calcMaxDrawdown(equityValues),
    profitFactor: calcProfitFactor(completedTrades),
    totalPnl: equity - config.initialCapital,
    totalFees,
    startEquity: config.initialCapital,
    endEquity: equity,
    equityCurve,
    trades: completedTrades,
  };
}
