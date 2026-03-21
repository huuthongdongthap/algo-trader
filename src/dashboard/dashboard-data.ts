// Aggregate data from TradingEngine + PortfolioTracker for dashboard API
import type { TradingEngine } from '../engine/engine.js';
import type { PortfolioTracker } from '../portfolio/portfolio-tracker.js';

/** KPI summary for dashboard header */
export interface DashboardSummary {
  totalEquity: number;
  dailyPnl: number;
  drawdown: number;
  activeStrategies: number;
  tradeCount: number;
  uptime: number;
  winRate: number;
  engineRunning: boolean;
}

/** Single equity curve data point */
export interface EquityCurvePoint {
  timestamp: number;
  equity: number;
}

/** Per-strategy breakdown for strategy table */
export interface StrategyBreakdownItem {
  name: string;
  equity: number;
  realizedPnl: number;
  tradeCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
}

/**
 * Aggregates data from engine + portfolio tracker for dashboard.
 * Portfolio tracker is optional — engine-only metrics still work.
 */
export class DashboardDataProvider {
  private engine: TradingEngine;
  private portfolio: PortfolioTracker | null;
  private startedAt: number;

  constructor(engine: TradingEngine, portfolio?: PortfolioTracker) {
    this.engine = engine;
    this.portfolio = portfolio ?? null;
    this.startedAt = Date.now();
  }

  /** Top-level KPI summary */
  getSummary(): DashboardSummary {
    const status = this.engine.getStatus();
    const now = Date.now();

    // Count running strategies from engine status
    const activeStrategies = status.strategies.filter(
      (s: { state: string }) => s.state === 'running'
    ).length;

    if (this.portfolio) {
      const ps = this.portfolio.getPortfolioSummary();
      // Daily PnL: approximate as total realized PnL (no day-boundary tracking in prototype)
      return {
        totalEquity: ps.totalEquity,
        dailyPnl: ps.totalRealizedPnl,
        drawdown: ps.drawdown,
        activeStrategies,
        tradeCount: ps.totalTradeCount,
        uptime: Math.floor((now - this.startedAt) / 1000),
        winRate: ps.winRate,
        engineRunning: status.running,
      };
    }

    // Fallback: engine-only data when portfolio tracker not available
    return {
      totalEquity: 0,
      dailyPnl: 0,
      drawdown: 0,
      activeStrategies,
      tradeCount: status.tradeCount,
      uptime: Math.floor((now - this.startedAt) / 1000),
      winRate: 0,
      engineRunning: status.running,
    };
  }

  /** Equity curve for chart rendering */
  getEquityCurve(): EquityCurvePoint[] {
    if (!this.portfolio) return [];
    return this.portfolio.getEquityCurve().map((p) => ({
      timestamp: p.timestamp,
      equity: p.equity,
    }));
  }

  /** Per-strategy performance breakdown */
  getStrategyBreakdown(): StrategyBreakdownItem[] {
    if (!this.portfolio) {
      // Return engine-level strategy states only
      return this.engine.getStatus().strategies.map((s: { name: string; state: string }) => ({
        name: s.name,
        equity: 0,
        realizedPnl: 0,
        tradeCount: 0,
        winRate: 0,
        avgWin: 0,
        avgLoss: 0,
      }));
    }

    return this.portfolio.getPortfolioSummary().strategies.map((s) => ({
      name: s.name,
      equity: s.equity,
      realizedPnl: s.realizedPnl,
      tradeCount: s.tradeCount,
      winRate: s.winRate,
      avgWin: s.avgWin,
      avgLoss: s.avgLoss,
    }));
  }
}
