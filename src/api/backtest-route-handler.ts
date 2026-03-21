// POST /api/backtest — run a strategy backtest over historical data and return BacktestResult JSON
// Body: { strategy, market, startDate, endDate, config? }

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StrategyName } from '../core/types.js';
import { loadHistoricalData } from '../backtest/data-loader.js';
import { runBacktest, type BacktestConfig, type BacktestStrategy, type SimulatorState } from '../backtest/simulator.js';
import type { HistoricalCandle } from '../backtest/data-loader.js';
import type { TradeRequest } from '../engine/trade-executor.js';

// ─── Body parsing ─────────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// ─── Request schema ───────────────────────────────────────────────────────────

interface BacktestRequestBody {
  strategy: StrategyName;
  market: string;
  startDate: string;
  endDate: string;
  config?: {
    initialCapital?: number;
    slippage?: number;
    feeRate?: number;
    maxPositionSize?: number;
    maxDrawdown?: number;
  };
}

function validate(body: unknown): BacktestRequestBody {
  const b = body as Record<string, unknown>;
  if (!b.strategy || typeof b.strategy !== 'string') throw new Error('strategy is required');
  if (!b.market || typeof b.market !== 'string') throw new Error('market is required');
  if (!b.startDate || typeof b.startDate !== 'string') throw new Error('startDate is required (ISO)');
  if (!b.endDate || typeof b.endDate !== 'string') throw new Error('endDate is required (ISO)');
  if (isNaN(new Date(b.startDate as string).getTime())) throw new Error('startDate is not a valid date');
  if (isNaN(new Date(b.endDate as string).getTime())) throw new Error('endDate is not a valid date');
  return b as unknown as BacktestRequestBody;
}

// ─── Simple momentum strategy adapter ────────────────────────────────────────
// Used when no strategy-specific backtestable implementation exists.
// Buys when close > previous close, sells when close < previous close.

function buildMomentumStrategy(strategyName: StrategyName, capital: number): BacktestStrategy {
  let prevClose: number | null = null;
  const tradeSize = (capital * 0.05).toFixed(2); // 5% of capital per trade

  return {
    onCandle(candle: HistoricalCandle, state: SimulatorState): TradeRequest | null {
      const prev = prevClose;
      prevClose = candle.close;
      if (prev === null) return null;

      const rising = candle.close > prev;
      const falling = candle.close < prev;

      if (rising && state.position <= 0 && state.balance > parseFloat(tradeSize)) {
        return {
          marketType: 'polymarket',
          exchange: 'polymarket',
          symbol: 'POLY_BACKTEST',
          side: 'buy',
          size: tradeSize,
          strategy: strategyName,
        };
      }

      if (falling && state.position > 0) {
        return {
          marketType: 'polymarket',
          exchange: 'polymarket',
          symbol: 'POLY_BACKTEST',
          side: 'sell',
          size: String(state.position.toFixed(2)),
          strategy: strategyName,
        };
      }

      return null;
    },
  };
}

// ─── Route handler ────────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * POST /api/backtest
 * Loads historical data, runs the requested strategy via momentum adapter,
 * and returns a BacktestResult JSON payload.
 */
export async function handleBacktest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const raw = await readBody(req);
    const body = validate(JSON.parse(raw));

    const cfg = body.config ?? {};
    const initialCapital = cfg.initialCapital ?? 10_000;

    const config: BacktestConfig = {
      initialCapital,
      slippage: cfg.slippage ?? 0.001,
      feeRate: cfg.feeRate ?? 0.001,
      strategy: body.strategy,
      maxPositionSize: cfg.maxPositionSize,
      maxDrawdown: cfg.maxDrawdown,
    };

    const candles = loadHistoricalData(body.market, body.startDate, body.endDate);
    if (candles.length === 0) {
      sendJson(res, 422, { error: `No candles found for market "${body.market}" in the given date range` });
      return;
    }

    const strategy = buildMomentumStrategy(body.strategy, initialCapital);
    const result = await runBacktest(strategy, candles, config);

    // Return full equity curve for charting; omit individual trades to keep payload reasonable
    const { trades, ...summary } = result;
    sendJson(res, 200, {
      ...summary,
      tradeCount: trades.length,
      // Last 5 trades for context
      recentTrades: trades.slice(-5).map(t => ({
        side: t.side,
        price: t.fillPrice,
        size: t.fillSize,
        fees: t.fees,
        time: t.timestamp,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('required') || message.includes('valid') ? 400 : 500;
    sendJson(res, status, { error: message });
  }
}
