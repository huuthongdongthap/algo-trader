/**
 * P&L Service
 * Calculates profit/loss metrics and daily summaries
 */

import { TradeRepository } from './trade-repository';
import { query } from './postgres-client';

export interface PnLSummary {
  date: string;
  totalProfit: number;
  totalLoss: number;
  netPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

export interface PerformanceMetrics {
  totalPnl: number;
  dailyPnl: number;
  weeklyPnl: number;
  monthlyPnl: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  avgTrade: number;
  bestTrade: number;
  worstTrade: number;
}

export class PnLService {
  private tradeRepository: TradeRepository;

  constructor(tradeRepository?: TradeRepository) {
    this.tradeRepository = tradeRepository || new TradeRepository();
  }

  /**
   * Calculate daily P&L summary
   */
  async getDailySummary(date: Date): Promise<PnLSummary> {
    const start = date.setHours(0, 0, 0, 0);
    const end = date.setHours(23, 59, 59, 999);

    const sql = `
      SELECT
        COUNT(*) as trade_count,
        SUM(CASE WHEN profit > 0 THEN profit ELSE 0 END) as total_profit,
        SUM(CASE WHEN profit < 0 THEN -profit ELSE 0 END) as total_loss,
        SUM(profit) as net_pnl,
        COUNT(CASE WHEN profit > 0 THEN 1 END) as win_count,
        COUNT(CASE WHEN profit < 0 THEN 1 END) as loss_count,
        AVG(CASE WHEN profit > 0 THEN profit END) as avg_win,
        AVG(CASE WHEN profit < 0 THEN -profit END) as avg_loss
      FROM trades
      WHERE created_at BETWEEN $1 AND $2
        AND status = 'FILLED'
    `;

    const result = await query(sql, [start, end]);
    const row = result.rows[0];

    const totalProfit = parseFloat(row?.total_profit as string || '0');
    const totalLoss = parseFloat(row?.total_loss as string || '0');
    const winCount = parseInt(row?.win_count as string || '0');
    const lossCount = parseInt(row?.loss_count as string || '0');
    const tradeCount = parseInt(row?.trade_count as string || '0');

    return {
      date: date.toISOString().split('T')[0],
      totalProfit,
      totalLoss,
      netPnl: totalProfit - totalLoss,
      tradeCount,
      winCount,
      lossCount,
      winRate: tradeCount > 0 ? winCount / tradeCount : 0,
      avgWin: parseFloat(row?.avg_win as string || '0'),
      avgLoss: parseFloat(row?.avg_loss as string || '0'),
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : Infinity,
    };
  }

  /**
   * Get performance metrics
   */
  async getPerformanceMetrics(): Promise<PerformanceMetrics> {
    const now = Date.now();
    const dayMs = 86400000;

    const [totalPnl, daily, weekly, monthly, stats] = await Promise.all([
      this.tradeRepository.getTotalPnl(),
      this.tradeRepository.getPnlByDateRange(now - dayMs, now),
      this.tradeRepository.getPnlByDateRange(now - dayMs * 7, now),
      this.tradeRepository.getPnlByDateRange(now - dayMs * 30, now),
      this.getTradeStats(),
    ]);

    const dailyPnl = daily.reduce((sum, d) => sum + d.profit, 0);
    const weeklyPnl = weekly.reduce((sum, d) => sum + d.profit, 0);
    const monthlyPnl = monthly.reduce((sum, d) => sum + d.profit, 0);

    return {
      totalPnl,
      dailyPnl,
      weeklyPnl,
      monthlyPnl,
      sharpeRatio: this.calculateSharpeRatio(monthly),
      maxDrawdown: this.calculateMaxDrawdown(monthly),
      winRate: stats.winRate,
      avgTrade: stats.avgTrade,
      bestTrade: stats.bestTrade,
      worstTrade: stats.worstTrade,
    };
  }

  /**
   * Get trade statistics
   */
  private async getTradeStats(): Promise<{
    winRate: number;
    avgTrade: number;
    bestTrade: number;
    worstTrade: number;
  }> {
    const sql = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN profit > 0 THEN 1 END) as wins,
        AVG(profit) as avg_trade,
        MAX(profit) as best_trade,
        MIN(profit) as worst_trade
      FROM trades
      WHERE status = 'FILLED'
    `;

    const result = await query(sql);
    const row = result.rows[0];

    const total = parseInt(row?.total as string || '0');
    const wins = parseInt(row?.wins as string || '0');

    return {
      winRate: total > 0 ? wins / total : 0,
      avgTrade: parseFloat(row?.avg_trade as string || '0'),
      bestTrade: parseFloat(row?.best_trade as string || '0'),
      worstTrade: parseFloat(row?.worst_trade as string || '0'),
    };
  }

  /**
   * Calculate Sharpe Ratio (annualized)
   */
  private calculateSharpeRatio(dailyPnl: { profit: number }[]): number {
    if (dailyPnl.length < 2) return 0;

    const returns = dailyPnl.map((d) => d.profit);
    const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;

    // Annualize: * sqrt(252) for trading days
    const riskFreeRate = 0.05 / 252; // Assume 5% annual
    const sharpe = ((avg - riskFreeRate) / stdDev) * Math.sqrt(252);

    return sharpe;
  }

  /**
   * Calculate maximum drawdown
   */
  private calculateMaxDrawdown(dailyPnl: { profit: number }[]): number {
    if (dailyPnl.length === 0) return 0;

    let peak = 0;
    let maxDrawdown = 0;
    let cumulative = 0;

    for (const day of dailyPnl) {
      cumulative += day.profit;
      if (cumulative > peak) {
        peak = cumulative;
      }
      const drawdown = (peak - cumulative) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    return maxDrawdown;
  }

  /**
   * Save daily summary
   */
  async saveDailySummary(date: Date): Promise<void> {
    const summary = await this.getDailySummary(date);
    const timestamp = Date.now();

    const sql = `
      INSERT INTO pnl_daily (
        date, total_profit, total_loss, net_pnl,
        trade_count, win_count, loss_count,
        avg_win, avg_loss, max_drawdown, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (date) DO UPDATE SET
        total_profit = EXCLUDED.total_profit,
        total_loss = EXCLUDED.total_loss,
        net_pnl = EXCLUDED.net_pnl,
        trade_count = EXCLUDED.trade_count,
        win_count = EXCLUDED.win_count,
        loss_count = EXCLUDED.loss_count,
        avg_win = EXCLUDED.avg_win,
        avg_loss = EXCLUDED.avg_loss,
        updated_at = EXCLUDED.updated_at
    `;

    await query(sql, [
      summary.date,
      summary.totalProfit,
      summary.totalLoss,
      summary.netPnl,
      summary.tradeCount,
      summary.winCount,
      summary.lossCount,
      summary.avgWin,
      summary.avgLoss,
      0,
      timestamp,
    ]);
  }
}
