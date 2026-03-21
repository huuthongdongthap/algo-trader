// Advanced performance analytics: daily returns, Sharpe/Sortino/Calmar ratios, drawdown stats

import type { TradeResult } from '../core/types.js';

export interface DailyReturn {
  date: string; // ISO date string YYYY-MM-DD
  return: number; // decimal return for the day
  equity: number;
}

export interface PerformanceReport {
  dailyReturns: DailyReturn[];
  weeklyReturns: number[];
  monthlyReturns: number[];
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  maxDrawdown: number;
  avgDrawdown: number;
  bestDay: DailyReturn;
  worstDay: DailyReturn;
  consecutiveWins: number;
  consecutiveLosses: number;
  annualReturn: number;
  startEquity: number;
  endEquity: number;
}

/** Group trades by ISO date string */
function groupByDate(trades: TradeResult[]): Map<string, TradeResult[]> {
  const map = new Map<string, TradeResult[]>();
  for (const trade of trades) {
    const date = new Date(trade.timestamp).toISOString().slice(0, 10);
    const bucket = map.get(date) ?? [];
    bucket.push(trade);
    map.set(date, bucket);
  }
  return map;
}

/** Compute net P&L for a set of trades (sell proceeds minus buy cost minus fees) */
function netPnl(trades: TradeResult[]): number {
  return trades.reduce((sum, t) => {
    const price = parseFloat(t.fillPrice);
    const size = parseFloat(t.fillSize);
    const fees = parseFloat(t.fees);
    const value = t.side === 'sell' ? price * size : -(price * size);
    return sum + value - fees;
  }, 0);
}

/**
 * Build daily returns series from trades.
 * Equity compounds each day based on realized P&L.
 */
export function calculateDailyReturns(trades: TradeResult[], startEquity: number): DailyReturn[] {
  if (trades.length === 0) return [];

  const byDate = groupByDate(trades);
  const sortedDates = [...byDate.keys()].sort();

  let equity = startEquity;
  const result: DailyReturn[] = [];

  for (const date of sortedDates) {
    const pnl = netPnl(byDate.get(date)!);
    const dailyReturn = equity > 0 ? pnl / equity : 0;
    equity += pnl;
    result.push({ date, return: dailyReturn, equity });
  }

  return result;
}

/**
 * Annualized Sharpe ratio from daily returns series.
 * Annualization factor: sqrt(252) trading days.
 */
export function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.02): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;

  const dailyRiskFree = riskFreeRate / 252;
  return ((mean - dailyRiskFree) / stdDev) * Math.sqrt(252);
}

/**
 * Sortino ratio: penalizes only downside deviation (negative returns).
 * Annualized same as Sharpe.
 */
export function calculateSortinoRatio(returns: number[], riskFreeRate: number = 0.02): number {
  if (returns.length < 2) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const downsideReturns = returns.filter(r => r < 0);
  if (downsideReturns.length === 0) return mean > 0 ? Infinity : 0;

  const downsideVariance =
    downsideReturns.reduce((s, r) => s + Math.pow(r, 2), 0) / downsideReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);
  if (downsideDev === 0) return 0;

  const dailyRiskFree = riskFreeRate / 252;
  return ((mean - dailyRiskFree) / downsideDev) * Math.sqrt(252);
}

/**
 * Calmar ratio: annualized return divided by max drawdown.
 * Higher is better; penalizes large drawdowns.
 */
export function calculateCalmarRatio(annualReturn: number, maxDrawdown: number): number {
  if (maxDrawdown === 0) return annualReturn > 0 ? Infinity : 0;
  return annualReturn / maxDrawdown;
}

/** Calculate max and average drawdown from equity curve */
function calculateDrawdownStats(equityCurve: number[]): { max: number; avg: number } {
  if (equityCurve.length < 2) return { max: 0, avg: 0 };

  let peak = equityCurve[0];
  let maxDD = 0;
  const drawdowns: number[] = [];

  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = peak > 0 ? (peak - equity) / peak : 0;
    drawdowns.push(dd);
    if (dd > maxDD) maxDD = dd;
  }

  const avg = drawdowns.reduce((s, d) => s + d, 0) / drawdowns.length;
  return { max: maxDD, avg };
}

/** Aggregate daily returns into weekly buckets (compounded) */
function toWeeklyReturns(daily: DailyReturn[]): number[] {
  const weeks: number[] = [];
  let weekReturn = 1;
  let count = 0;

  for (const d of daily) {
    weekReturn *= 1 + d.return;
    count++;
    if (count === 5) { // 5 trading days per week
      weeks.push(weekReturn - 1);
      weekReturn = 1;
      count = 0;
    }
  }
  if (count > 0) weeks.push(weekReturn - 1);
  return weeks;
}

/** Aggregate daily returns into monthly buckets by calendar month */
function toMonthlyReturns(daily: DailyReturn[]): number[] {
  const monthMap = new Map<string, number>();

  for (const d of daily) {
    const month = d.date.slice(0, 7); // YYYY-MM
    const current = monthMap.get(month) ?? 1;
    monthMap.set(month, current * (1 + d.return));
  }

  return [...monthMap.values()].map(v => v - 1);
}

/** Max consecutive wins and losses from daily returns */
function consecutiveStats(daily: DailyReturn[]): { wins: number; losses: number } {
  let maxWins = 0;
  let maxLosses = 0;
  let curWins = 0;
  let curLosses = 0;

  for (const d of daily) {
    if (d.return > 0) {
      curWins++;
      curLosses = 0;
    } else if (d.return < 0) {
      curLosses++;
      curWins = 0;
    } else {
      curWins = 0;
      curLosses = 0;
    }
    if (curWins > maxWins) maxWins = curWins;
    if (curLosses > maxLosses) maxLosses = curLosses;
  }

  return { wins: maxWins, losses: maxLosses };
}

/**
 * Generate full performance report from trade history.
 * Combines all metrics into a single PerformanceReport object.
 */
export function generatePerformanceReport(
  trades: TradeResult[],
  startEquity: number,
): PerformanceReport {
  const daily = calculateDailyReturns(trades, startEquity);
  const returns = daily.map(d => d.return);
  const equityCurve = daily.map(d => d.equity);

  const endEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1] : startEquity;
  const totalReturn = startEquity > 0 ? (endEquity - startEquity) / startEquity : 0;
  // Annualize assuming 252 trading days per year
  const tradingDays = daily.length || 1;
  const annualReturn = Math.pow(1 + totalReturn, 252 / tradingDays) - 1;

  const { max: maxDrawdown, avg: avgDrawdown } = calculateDrawdownStats([startEquity, ...equityCurve]);
  const sharpeRatio = calculateSharpeRatio(returns);
  const sortinoRatio = calculateSortinoRatio(returns);
  const calmarRatio = calculateCalmarRatio(annualReturn, maxDrawdown);

  const weeklyReturns = toWeeklyReturns(daily);
  const monthlyReturns = toMonthlyReturns(daily);

  const bestDay = daily.length > 0
    ? daily.reduce((best, d) => (d.return > best.return ? d : best), daily[0])
    : { date: '', return: 0, equity: startEquity };

  const worstDay = daily.length > 0
    ? daily.reduce((worst, d) => (d.return < worst.return ? d : worst), daily[0])
    : { date: '', return: 0, equity: startEquity };

  const { wins: consecutiveWins, losses: consecutiveLosses } = consecutiveStats(daily);

  return {
    dailyReturns: daily,
    weeklyReturns,
    monthlyReturns,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    avgDrawdown,
    bestDay,
    worstDay,
    consecutiveWins,
    consecutiveLosses,
    annualReturn,
    startEquity,
    endEquity,
  };
}
