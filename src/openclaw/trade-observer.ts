// Trade Observer: real-time aggregation of trade events via EventBus
// Watches 'trade.executed', 'strategy.started/stopped' and builds live snapshots
import type { TradeResult, StrategyName } from '../core/types.js';
import type { EventBus } from '../events/event-bus.js';
import type { SystemEventMap } from '../events/event-types.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TradeSnapshot {
  timestamp: number;
  recentTrades: TradeResult[];
  winRate: number;        // 0-1
  avgReturn: number;      // average fill price delta (simplified as avg fee ratio)
  drawdown: number;       // estimated from fee accumulation vs total volume
  activeStrategies: StrategyName[];
}

export interface StrategyStats {
  name: StrategyName;
  tradeCount: number;
  winCount: number;
  winRate: number;
  totalPnl: number;       // net of fees (numeric approximation)
}

export interface AlertThresholds {
  minWinRate: number;     // default 0.40 — alert if win rate falls below
  maxDrawdown: number;    // default 0.15 — alert if drawdown exceeds
  maxTradesPerMinute: number; // default 30 — alert if volume spikes
}

export interface TradeObserverConfig {
  observationWindowMs: number;      // default 3_600_000 (1h)
  alertThresholds: AlertThresholds;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_THRESHOLDS: AlertThresholds = {
  minWinRate: 0.4,
  maxDrawdown: 0.15,
  maxTradesPerMinute: 30,
};

const DEFAULT_CONFIG: TradeObserverConfig = {
  observationWindowMs: 3_600_000,
  alertThresholds: DEFAULT_THRESHOLDS,
};

const MAX_TRADE_BUFFER = 100;

// ---------------------------------------------------------------------------
// TradeObserver
// ---------------------------------------------------------------------------

export class TradeObserver {
  private readonly config: TradeObserverConfig;

  // circular trade buffer — keeps last MAX_TRADE_BUFFER trades in window
  private trades: TradeResult[] = [];
  private activeStrategies: Set<StrategyName> = new Set();
  private bus: EventBus | null = null;

  // Bound handlers stored so we can unsubscribe cleanly
  private readonly onTradeExecuted: (data: SystemEventMap['trade.executed']) => void;
  private readonly onStrategyStarted: (data: SystemEventMap['strategy.started']) => void;
  private readonly onStrategyStopped: (data: SystemEventMap['strategy.stopped']) => void;

  constructor(config: Partial<TradeObserverConfig> = {}) {
    this.config = {
      observationWindowMs: config.observationWindowMs ?? DEFAULT_CONFIG.observationWindowMs,
      alertThresholds: { ...DEFAULT_THRESHOLDS, ...config.alertThresholds },
    };

    this.onTradeExecuted = ({ trade }) => this.handleTrade(trade);
    this.onStrategyStarted = ({ name }) => this.activeStrategies.add(name as StrategyName);
    this.onStrategyStopped = ({ name }) => this.activeStrategies.delete(name as StrategyName);
  }

  /** Attach to event bus and begin collecting data */
  startObserving(bus: EventBus): void {
    this.bus = bus;
    bus.on('trade.executed', this.onTradeExecuted);
    bus.on('strategy.started', this.onStrategyStarted);
    bus.on('strategy.stopped', this.onStrategyStopped);
  }

  /** Detach all listeners */
  stopObserving(): void {
    if (!this.bus) return;
    this.bus.off('trade.executed', this.onTradeExecuted);
    this.bus.off('strategy.started', this.onStrategyStarted);
    this.bus.off('strategy.stopped', this.onStrategyStopped);
    this.bus = null;
  }

  /** Current aggregated snapshot over observation window */
  getSnapshot(): TradeSnapshot {
    const now = Date.now();
    const windowStart = now - this.config.observationWindowMs;
    const recentTrades = this.trades.filter((t) => t.timestamp >= windowStart);

    const winRate = this.calcWinRate(recentTrades);
    const avgReturn = this.calcAvgReturn(recentTrades);
    const drawdown = this.calcDrawdown(recentTrades);

    return {
      timestamp: now,
      recentTrades,
      winRate,
      avgReturn,
      drawdown,
      activeStrategies: [...this.activeStrategies],
    };
  }

  /** Per-strategy win rate and P&L breakdown */
  getStrategyBreakdown(): StrategyStats[] {
    const map = new Map<StrategyName, { trades: TradeResult[] }>();

    for (const trade of this.trades) {
      const bucket = map.get(trade.strategy) ?? { trades: [] };
      bucket.trades.push(trade);
      map.set(trade.strategy, bucket);
    }

    return [...map.entries()].map(([name, { trades }]) => {
      const wins = trades.filter((t) => parseFloat(t.fillPrice) > 0).length;
      const totalPnl = trades.reduce((acc, t) => acc - parseFloat(t.fees), 0);
      return {
        name,
        tradeCount: trades.length,
        winCount: wins,
        winRate: trades.length > 0 ? wins / trades.length : 0,
        totalPnl,
      };
    });
  }

  /** Returns true if snapshot has anomalies warranting an alert */
  shouldAlert(snapshot: TradeSnapshot): boolean {
    const { minWinRate, maxDrawdown, maxTradesPerMinute } = this.config.alertThresholds;

    if (snapshot.recentTrades.length >= 10 && snapshot.winRate < minWinRate) return true;
    if (snapshot.drawdown > maxDrawdown) return true;

    // Volume spike: count trades in the last minute
    const oneMinAgo = Date.now() - 60_000;
    const tradesLastMinute = snapshot.recentTrades.filter((t) => t.timestamp >= oneMinAgo).length;
    if (tradesLastMinute > maxTradesPerMinute) return true;

    return false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private handleTrade(trade: TradeResult): void {
    this.trades.push(trade);
    // Evict oldest entries beyond buffer cap
    if (this.trades.length > MAX_TRADE_BUFFER) {
      this.trades = this.trades.slice(this.trades.length - MAX_TRADE_BUFFER);
    }
  }

  private calcWinRate(trades: TradeResult[]): number {
    if (trades.length === 0) return 0;
    // A "win" is defined as a buy trade (positive side) or sell above zero price
    const wins = trades.filter((t) => t.side === 'buy' || parseFloat(t.fillPrice) > 0).length;
    return wins / trades.length;
  }

  private calcAvgReturn(trades: TradeResult[]): number {
    if (trades.length === 0) return 0;
    const totalFeeRatio = trades.reduce((acc, t) => {
      const price = parseFloat(t.fillPrice);
      const fee = parseFloat(t.fees);
      return acc + (price > 0 ? fee / price : 0);
    }, 0);
    return -(totalFeeRatio / trades.length);
  }

  private calcDrawdown(trades: TradeResult[]): number {
    if (trades.length === 0) return 0;
    let cumPnl = 0;
    let peak = 0;
    let maxDd = 0;
    for (const t of trades) {
      cumPnl -= parseFloat(t.fees);
      if (cumPnl > peak) peak = cumPnl;
      const dd = peak > 0 ? (peak - cumPnl) / peak : 0;
      if (dd > maxDd) maxDd = dd;
    }
    return maxDd;
  }
}
