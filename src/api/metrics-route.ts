// Prometheus metrics endpoint handler - GET /api/metrics
// Exposes algo_* metrics in Prometheus text format 0.0.4
// Registers required gauges/counters on first call if not already present
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { formatPrometheus } from '../metrics/prometheus-exporter.js';

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/**
 * Ensure all required algo_* metrics are registered in the collector.
 * Idempotent - safe to call multiple times.
 */
function ensureAlgoMetrics(collector: MetricsCollector): void {
  // Counters
  collector.counter('algo_trades_total', 'Total trades executed by strategy and outcome');
  collector.counter('algo_api_requests_total', 'Total API requests by method, path, and status');

  // Gauges
  collector.gauge('algo_pnl_total', 'Total realized PnL in USD', 0);
  collector.gauge('algo_win_rate', 'Win rate as a decimal (0-1)', 0);
  collector.gauge('algo_active_positions', 'Number of currently active positions', 0);

  // Histograms
  collector.histogram('algo_api_request_duration_seconds', 'API request duration in seconds');
}

/**
 * GET /api/metrics
 * Returns all registered metrics in Prometheus text exposition format.
 * Also ensures required algo_* metrics exist before export.
 */
export function handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  const collector = MetricsCollector.getInstance();
  ensureAlgoMetrics(collector);

  const body = formatPrometheus(collector.getAll());
  const bodyBytes = Buffer.from(body, 'utf-8');

  res.writeHead(200, {
    'Content-Type': CONTENT_TYPE,
    'Content-Length': bodyBytes.length,
  });
  res.end(bodyBytes);
}

/** Re-export for use by middleware to increment algo_* counters/histograms */
export { ensureAlgoMetrics };
