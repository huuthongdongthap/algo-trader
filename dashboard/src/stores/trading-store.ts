/**
 * Zustand store for real-time trading data.
 * WebSocket updates flush here via buffered batches.
 */
import { create } from 'zustand';

export interface PriceTick {
  exchange: string;
  symbol: string;
  bid: number;
  ask: number;
  timestamp: number;
}

export interface Position {
  id: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  amount: number;
  pnl: number;
  status: 'open' | 'closed';
}

export interface SpreadOpportunity {
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  spreadPct: number;
  netProfitUsd: number;
  timestamp: number;
}

/** Strategy status from bot engine */
export interface StrategyStatus {
  name: string;
  enabled: boolean;
  signalCount: number;
  lastSignalAt: string | null;
  mode: 'live' | 'dry-run' | 'stopped';
}

/** Executed trade record */
export interface TradeRecord {
  id: string;
  timestamp: number;
  strategy: string;
  side: 'BUY' | 'SELL';
  symbol: string;
  price: number;
  size: number;
  pnl: number;
  dryRun: boolean;
}

/** Bot engine status */
export interface BotStatus {
  running: boolean;
  mode: 'live' | 'dry-run' | 'stopped';
  uptime: number;
  totalSignals: number;
  executedTrades: number;
  rejectedTrades: number;
  dailyPnl: number;
}

interface TradingState {
  prices: Record<string, PriceTick>;
  positions: Position[];
  spreads: SpreadOpportunity[];
  connected: boolean;
  strategies: StrategyStatus[];
  trades: TradeRecord[];
  botStatus: BotStatus | null;
  updatePrices: (ticks: PriceTick[]) => void;
  setPositions: (positions: Position[]) => void;
  setSpreads: (spreads: SpreadOpportunity[]) => void;
  setConnected: (connected: boolean) => void;
  setStrategies: (strategies: StrategyStatus[]) => void;
  addTrade: (trade: TradeRecord) => void;
  setTrades: (trades: TradeRecord[]) => void;
  setBotStatus: (status: BotStatus) => void;
}

const MAX_TRADES = 100;

export const useTradingStore = create<TradingState>()((set) => ({
  prices: {},
  positions: [],
  spreads: [],
  connected: false,
  strategies: [],
  trades: [],
  botStatus: null,
  updatePrices: (ticks) =>
    set((state) => {
      const prices = { ...state.prices };
      for (const tick of ticks) {
        prices[`${tick.exchange}:${tick.symbol}`] = tick;
      }
      return { prices };
    }),
  setPositions: (positions) => set({ positions }),
  setSpreads: (spreads) => set({ spreads }),
  setConnected: (connected) => set({ connected }),
  setStrategies: (strategies) => set({ strategies }),
  addTrade: (trade) =>
    set((state) => ({
      trades: [trade, ...state.trades].slice(0, MAX_TRADES),
    })),
  setTrades: (trades) => set({ trades: trades.slice(0, MAX_TRADES) }),
  setBotStatus: (botStatus) => set({ botStatus }),
}));
