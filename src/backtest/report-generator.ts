// Backtest performance analytics: Sharpe ratio, drawdown, win rate, P&L metrics

import type { TradeResult } from '../core/types.js';

/** Complete performance report for a backtest run */
export interface BacktestReport {
  /** Total return as decimal (0.15 = 15%) */
  totalReturn: number;
  /** Annualized Sharpe ratio */
  sharpeRatio: number;
  /** Maximum drawdown as decimal (0.20 = 20%) */
  maxDrawdown: number;
  /** Win rate as decimal (0.55 = 55% of trades profitable) */
  winRate: number;
  tradeCount: number;
  /** Average profit on winning trades (absolute) */
  avgWin: number;
  /** Average loss on losing trades (absolute, positive number) */
  avgLoss: number;
  /** Profit factor: gross profit / gross loss */
  profitFactor: number;
  initialCapital: number;
  finalEquity: number;
  totalFees: number;
}

/**
 * Calculate annualized Sharpe ratio from a series of period returns.
 * Assumes daily returns; annualizes by sqrt(252).
 */
export function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.02): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize: daily risk-free rate
  const dailyRiskFree = riskFreeRate / 252;
  const annualizationFactor = Math.sqrt(252);

  return ((mean - dailyRiskFree) / stdDev) * annualizationFactor;
}

/**
 * Calculate maximum drawdown from an equity curve.
 * Returns value as decimal (0.20 = 20% drawdown).
 */
export function calculateMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;

  let peak = equityCurve[0];
  let maxDD = 0;

  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const drawdown = peak > 0 ? (peak - equity) / peak : 0;
    if (drawdown > maxDD) maxDD = drawdown;
  }

  return maxDD;
}

/** Compute per-trade P&L from fill prices and sides */
function computeTradePnl(trades: TradeResult[]): number[] {
  const pnls: number[] = [];
  // Match buys to sells in order (simplified FIFO)
  const buyStack: { price: number; size: number }[] = [];

  for (const trade of trades) {
    const price = parseFloat(trade.fillPrice);
    const size = parseFloat(trade.fillSize);

    if (trade.side === 'buy') {
      buyStack.push({ price, size });
    } else if (trade.side === 'sell' && buyStack.length > 0) {
      const entry = buyStack.shift()!;
      const matchSize = Math.min(entry.size, size);
      pnls.push((price - entry.price) * matchSize);
    }
  }

  return pnls;
}

/** Derive daily returns from equity curve for Sharpe calculation */
function equityToDailyReturns(equityCurve: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1];
    if (prev > 0) returns.push((equityCurve[i] - prev) / prev);
  }
  return returns;
}

/**
 * Generate a full performance report from trade results and equity curve.
 */
export function generateReport(
  trades: TradeResult[],
  equityCurve: number[],
  initialCapital: number,
): BacktestReport {
  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : initialCapital;
  const totalReturn = initialCapital > 0 ? (finalEquity - initialCapital) / initialCapital : 0;
  const totalFees = trades.reduce((s, t) => s + parseFloat(t.fees), 0);

  const pnls = computeTradePnl(trades);
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p <= 0);

  const winRate = pnls.length > 0 ? wins.length / pnls.length : 0;
  const avgWin = wins.length > 0 ? wins.reduce((s, p) => s + p, 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, p) => s + p, 0) / losses.length) : 0;

  const grossProfit = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  const dailyReturns = equityToDailyReturns(equityCurve);
  const sharpeRatio = calculateSharpeRatio(dailyReturns);
  const maxDrawdown = calculateMaxDrawdown(equityCurve);

  return {
    totalReturn,
    sharpeRatio,
    maxDrawdown,
    winRate,
    tradeCount: trades.length,
    avgWin,
    avgLoss,
    profitFactor,
    initialCapital,
    finalEquity,
    totalFees,
  };
}

/** Format a BacktestReport into a human-readable string */
export function formatReport(report: BacktestReport): string {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const usd = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (v: number, d = 4) => isFinite(v) ? v.toFixed(d) : v > 0 ? '+Inf' : '-Inf';

  return [
    '═══════════════════════════════════════',
    '         BACKTEST PERFORMANCE REPORT    ',
    '═══════════════════════════════════════',
    `  Initial Capital  : ${usd(report.initialCapital)}`,
    `  Final Equity     : ${usd(report.finalEquity)}`,
    `  Total Return     : ${pct(report.totalReturn)}`,
    `  Total Fees       : ${usd(report.totalFees)}`,
    '───────────────────────────────────────',
    `  Trade Count      : ${report.tradeCount}`,
    `  Win Rate         : ${pct(report.winRate)}`,
    `  Avg Win          : ${usd(report.avgWin)}`,
    `  Avg Loss         : ${usd(report.avgLoss)}`,
    `  Profit Factor    : ${num(report.profitFactor, 2)}`,
    '───────────────────────────────────────',
    `  Sharpe Ratio     : ${num(report.sharpeRatio, 2)}`,
    `  Max Drawdown     : ${pct(report.maxDrawdown)}`,
    '═══════════════════════════════════════',
  ].join('\n');
}
