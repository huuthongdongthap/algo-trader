// Prometheus metrics endpoint handler - GET /api/metrics
// Exposes algo_* + business metrics in Prometheus text format 0.0.4
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MetricsCollector } from '../metrics/metrics-collector.js';
import { formatPrometheus } from '../metrics/prometheus-exporter.js';
import type { UserStore } from '../users/user-store.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Module-level UserStore ref — set once at server init */
let _userStore: UserStore | null = null;

/** Wire UserStore so business metrics can be scraped live */
export function setMetricsUserStore(store: UserStore): void {
  _userStore = store;
}

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

  // Business gauges
  collector.gauge('algo_mrr_dollars', 'Monthly recurring revenue in USD');
  collector.gauge('algo_arr_dollars', 'Annual recurring revenue in USD');
  collector.gauge('algo_users_total', 'Total registered users');
  collector.gauge('algo_users_free', 'Free tier users');
  collector.gauge('algo_users_pro', 'Pro tier users');
  collector.gauge('algo_users_enterprise', 'Enterprise tier users');
  collector.gauge('algo_uptime_seconds', 'Process uptime in seconds');

  // Histograms
  collector.histogram('algo_api_request_duration_seconds', 'API request duration in seconds');
}

/** Refresh business gauges from UserStore before each scrape */
function refreshBusinessMetrics(collector: MetricsCollector): void {
  collector.set('algo_uptime_seconds', Math.floor(process.uptime()));

  if (!_userStore) return;
  const analytics = new AdminAnalytics(_userStore);
  const mrr = analytics.getMRR();
  const stats = analytics.getUserStats();

  collector.set('algo_mrr_dollars', mrr);
  collector.set('algo_arr_dollars', mrr * 12);
  collector.set('algo_users_total', stats.totalUsers);
  collector.set('algo_users_free', stats.byTier.free);
  collector.set('algo_users_pro', stats.byTier.pro);
  collector.set('algo_users_enterprise', stats.byTier.enterprise);
}

/**
 * GET /api/metrics
 * Returns all registered metrics in Prometheus text exposition format.
 */
export function handleMetrics(_req: IncomingMessage, res: ServerResponse): void {
  const collector = MetricsCollector.getInstance();
  ensureAlgoMetrics(collector);
  refreshBusinessMetrics(collector);

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
