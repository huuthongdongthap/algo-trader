// GET /api/analytics/performance — returns Sharpe, Sortino, Calmar, drawdown, equity curve
// Pulls trades from TradingEngine and runs generatePerformanceReport

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TradingEngine } from '../engine/engine.js';
import { generatePerformanceReport } from '../analytics/performance-metrics.js';

const DEFAULT_START_EQUITY = 10_000;

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

let _engine: TradingEngine | null = null;

/** Wire engine ref from app.ts */
export function setAnalyticsEngine(engine: TradingEngine): void {
  _engine = engine;
}

/**
 * Handle analytics routes: GET /api/analytics/performance
 * Returns full PerformanceReport with risk-adjusted ratios, drawdown, equity curve.
 */
export function handleAnalyticsRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): boolean {
  if (!pathname.startsWith('/api/analytics/')) return false;

  if (pathname === '/api/analytics/performance') {
    if (method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed' });
      return true;
    }

    if (!_engine) {
      sendJson(res, 503, { error: 'Trading engine not available' });
      return true;
    }

    const trades = _engine.getExecutor().getTradeLog();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const startEquity = Number(url.searchParams.get('startEquity')) || DEFAULT_START_EQUITY;

    const report = generatePerformanceReport(trades, startEquity);

    // Strip dailyReturns for compact response unless ?detail=full
    const detail = url.searchParams.get('detail');
    if (detail !== 'full') {
      sendJson(res, 200, {
        sharpeRatio: report.sharpeRatio,
        sortinoRatio: report.sortinoRatio,
        calmarRatio: report.calmarRatio,
        maxDrawdown: report.maxDrawdown,
        avgDrawdown: report.avgDrawdown,
        annualReturn: report.annualReturn,
        startEquity: report.startEquity,
        endEquity: report.endEquity,
        bestDay: report.bestDay,
        worstDay: report.worstDay,
        consecutiveWins: report.consecutiveWins,
        consecutiveLosses: report.consecutiveLosses,
        weeklyReturns: report.weeklyReturns,
        monthlyReturns: report.monthlyReturns,
        tradeCount: trades.length,
      });
    } else {
      sendJson(res, 200, { ...report, tradeCount: trades.length });
    }
    return true;
  }

  return false;
}
