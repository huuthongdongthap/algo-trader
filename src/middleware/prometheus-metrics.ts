/**
 * Prometheus Metrics Middleware
 * Exposes Prometheus-format metrics for monitoring and alerting
 */

import client from 'prom-client';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ─────────────────────────────────────────────────────────────────────────────
// Create Registry
// ─────────────────────────────────────────────────────────────────────────────
const register = new client.Registry();

// Add default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register });

// ─────────────────────────────────────────────────────────────────────────────
// Custom Metrics - Trading Specific
// ─────────────────────────────────────────────────────────────────────────────

// Counter for total trades executed
export const tradesTotal = new client.Counter({
  name: 'trades_total',
  help: 'Total number of trades executed',
  labelNames: ['symbol', 'exchange', 'side'] as const,
  registers: [register],
});

// Gauge for current P&L in USD
export const dailyPnlUsd = new client.Gauge({
  name: 'daily_pnl_usd',
  help: 'Daily profit and loss in USD',
  labelNames: ['strategy'] as const,
  registers: [register],
});

// Gauge for win rate percentage
export const winRatePercent = new client.Gauge({
  name: 'win_rate_percent',
  help: 'Win rate percentage (winning trades / total trades)',
  labelNames: ['strategy'] as const,
  registers: [register],
});

// Gauge for circuit breaker state (0 = closed/active, 1 = open/halted)
export const circuitBreakerState = new client.Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0 = active, 1 = halted)',
  registers: [register],
});

// Gauge for number of open positions
export const openPositionsTotal = new client.Gauge({
  name: 'open_positions_total',
  help: 'Total number of open positions',
  labelNames: ['symbol', 'exchange'] as const,
  registers: [register],
});

// Histogram for exchange API latency
export const exchangeApiLatency = new client.Histogram({
  name: 'exchange_api_latency_seconds',
  help: 'Exchange API request latency in seconds',
  labelNames: ['exchange', 'operation'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Counter for trading signals generated
export const signalsTotal = new client.Counter({
  name: 'signals_total',
  help: 'Total number of trading signals generated',
  labelNames: ['symbol', 'signal_type'] as const,
  registers: [register],
});

// Gauge for strategy active state
export const strategyActive = new client.Gauge({
  name: 'strategy_active',
  help: 'Whether a trading strategy is active (1 = active, 0 = inactive)',
  labelNames: ['strategy'] as const,
  registers: [register],
});

// Histogram for trade execution time
export const tradeExecutionTime = new client.Histogram({
  name: 'trade_execution_time_seconds',
  help: 'Time to execute a trade order',
  labelNames: ['exchange', 'symbol'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Request Metrics Middleware
// ─────────────────────────────────────────────────────────────────────────────

// HTTP request counter
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [register],
});

// HTTP request duration histogram
const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

/**
 * Express middleware to track HTTP requests
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const path = req.route?.path || req.path;

  res.on('finish', () => {
    const duration = (Date.now() - start) / 1000;
    const status = res.statusCode.toString();

    httpRequestsTotal.inc({
      method: req.method,
      path,
      status,
    });

    httpRequestDuration.observe(
      {
        method: req.method,
        path,
      },
      duration
    );
  });

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Metrics Endpoint Handler
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Express handler for /metrics endpoint
 * Returns all metrics in Prometheus format
 */
export async function getMetrics(req: Request, res: Response): Promise<void> {
  try {
    res.set('Content-Type', register.contentType);
    const metrics = await register.metrics();
    res.send(metrics);
  } catch (error) {
    logger.error('Error generating metrics:', { error });
    res.status(500).send('Error generating metrics');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions for Recording Trading Events
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a completed trade
 */
export function recordTrade(symbol: string, exchange: string, side: 'buy' | 'sell', pnlUsd?: number): void {
  tradesTotal.inc({ symbol, exchange, side });

  if (pnlUsd !== undefined) {
    // Update daily P&L
    dailyPnlUsd.inc({ strategy: 'default' }, pnlUsd);
  }
}

/**
 * Record a trading signal
 */
export function recordSignal(symbol: string, signalType: 'buy' | 'sell' | 'hold'): void {
  signalsTotal.inc({ symbol, signal_type: signalType });
}

/**
 * Record exchange API latency
 */
export function recordExchangeLatency(exchange: string, operation: string, latencySeconds: number): void {
  exchangeApiLatency.observe({ exchange, operation }, latencySeconds);
}

/**
 * Record trade execution time
 */
export function recordTradeExecutionTime(exchange: string, symbol: string, durationSeconds: number): void {
  tradeExecutionTime.observe({ exchange, symbol }, durationSeconds);
}

/**
 * Update circuit breaker state
 */
export function setCircuitBreakerState(isOpen: boolean): void {
  circuitBreakerState.set(isOpen ? 1 : 0);
}

/**
 * Update win rate
 */
export function setWinRate(winRate: number): void {
  winRatePercent.set({ strategy: 'default' }, winRate);
}

/**
 * Update open positions count
 */
export function setOpenPositions(symbol: string, exchange: string, count: number): void {
  openPositionsTotal.set({ symbol, exchange }, count);
}

/**
 * Set strategy active/inactive
 */
export function setStrategyActive(strategy: string, active: boolean): void {
  strategyActive.set({ strategy }, active ? 1 : 0);
}

// Export registry for custom metrics
export { register };
