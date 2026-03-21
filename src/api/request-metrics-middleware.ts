// Request metrics middleware - tracks API requests via MetricsCollector
// Instruments: algo_api_requests_total counter + algo_api_request_duration_seconds histogram
// Also checks alert rules for high error rate and pipeline crash
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { AlertManager } from '../notifications/alert-rules.js';
import { logger } from '../core/logger.js';

// Sliding window for error-rate alert: track last N request outcomes
const REQUEST_WINDOW: boolean[] = []; // true = success, false = error
const WINDOW_SIZE = 100;

/** Shared AlertManager singleton for API-level alerts */
let alertManager: AlertManager | null = null;

function getAlertManager(): AlertManager {
  if (!alertManager) {
    alertManager = new AlertManager(true);

    // Register production alert rules
    alertManager.register({
      name: 'highErrorRate',
      condition: (rate: number) => rate > 0.1,
      message: (rate: number) =>
        `High API error rate: ${(rate * 100).toFixed(1)}% (threshold: 10%)`,
      cooldownMs: 5 * 60 * 1000, // 5 min cooldown
    });

    alertManager.register({
      name: 'pipelineCrash',
      condition: (running: boolean) => !running,
      message: (_: boolean) => 'Trading pipeline is down — engine not running',
      cooldownMs: 2 * 60 * 1000, // 2 min cooldown
    });
  }
  return alertManager;
}

/** Normalize pathname for metric labels — strip dynamic segments */
function normalizePath(pathname: string): string {
  // Replace UUIDs and numeric IDs in path segments
  return pathname
    .replace(/\/[0-9a-f-]{8,}/gi, '/:id')
    .replace(/\/\d+/g, '/:id')
    .slice(0, 80); // cap label length
}

/**
 * Wraps a route handler to collect Prometheus metrics per request.
 * Increments algo_api_requests_total and records algo_api_request_duration_seconds.
 *
 * Usage in server.ts middleware chain:
 *   withRequestMetrics(req, res, pathname, () => handleRequest(...))
 */
export async function withRequestMetrics(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  handler: () => Promise<void>,
  engineRunning?: boolean,
): Promise<void> {
  const collector = MetricsCollector.getInstance();
  const manager = getAlertManager();
  const method = req.method ?? 'GET';
  const path = normalizePath(pathname);
  const startNs = process.hrtime.bigint();

  try {
    await handler();
  } finally {
    const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
    const status = String(res.statusCode ?? 200);
    const isError = res.statusCode >= 400;

    // Increment request counter with labels
    collector.counter('algo_api_requests_total', 'Total API requests by method, path, and status');
    collector.increment('algo_api_requests_total', { method, path, status });

    // Record duration histogram
    collector.histogram(
      'algo_api_request_duration_seconds',
      'API request duration in seconds',
      durationSec,
    );

    // Update sliding error window
    REQUEST_WINDOW.push(!isError);
    if (REQUEST_WINDOW.length > WINDOW_SIZE) REQUEST_WINDOW.shift();

    // Check high error rate alert
    const errorCount = REQUEST_WINDOW.filter((s) => !s).length;
    const errorRate = REQUEST_WINDOW.length > 0 ? errorCount / REQUEST_WINDOW.length : 0;

    if (manager.shouldAlert('highErrorRate', errorRate)) {
      const msg = manager.getMessage('highErrorRate', errorRate);
      if (msg) logger.warn(msg, 'AlertManager');
    }

    // Check pipeline crash alert
    if (engineRunning !== undefined && manager.shouldAlert('pipelineCrash', engineRunning)) {
      const msg = manager.getMessage('pipelineCrash', engineRunning);
      if (msg) logger.error(msg, 'AlertManager');
    }
  }
}

/**
 * Record a trade result for alert evaluation.
 * Call this from trade execution paths to track trade failure rate.
 */
const TRADE_FAILURES: number[] = []; // timestamps of failed trades
const FAILURE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export function recordTradeOutcome(
  strategy: string,
  outcome: 'success' | 'failure',
  pnlDelta = 0,
): void {
  const collector = MetricsCollector.getInstance();
  const manager = getAlertManager();
  const now = Date.now();

  // Ensure metric exists
  collector.counter('algo_trades_total', 'Total trades executed by strategy and outcome');
  collector.increment('algo_trades_total', { strategy, outcome });

  if (outcome === 'failure') {
    TRADE_FAILURES.push(now);
  }

  // Update PnL gauge
  const pnlMetric = collector.getAll().find((m) => m.name === 'algo_pnl_total');
  const currentPnl = pnlMetric?.samples.get('__default__')?.value ?? 0;
  collector.gauge('algo_pnl_total', 'Total realized PnL in USD', currentPnl + pnlDelta);
  collector.set('algo_pnl_total', currentPnl + pnlDelta);

  // Purge old failures outside window
  const cutoff = now - FAILURE_WINDOW_MS;
  while (TRADE_FAILURES.length > 0 && TRADE_FAILURES[0]! < cutoff) {
    TRADE_FAILURES.shift();
  }

  // Alert: >5 trade failures in 10 minutes
  if (!manager.getRuleNames().includes('tradeFailureSpike')) {
    manager.register({
      name: 'tradeFailureSpike',
      condition: (count: number) => count > 5,
      message: (count: number) =>
        `Trade failure spike: ${count} failures in the last 10 minutes (threshold: 5)`,
      cooldownMs: 10 * 60 * 1000,
    });
  }

  if (manager.shouldAlert('tradeFailureSpike', TRADE_FAILURES.length)) {
    const msg = manager.getMessage('tradeFailureSpike', TRADE_FAILURES.length);
    if (msg) logger.warn(msg, 'AlertManager');
  }
}
