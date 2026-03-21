// Grafana dashboard JSON template generator for algo-trade platform
// Produces a ready-to-import dashboard with 5 panels backed by Prometheus datasource

/** Grafana panel definition (minimal subset needed for dashboard JSON) */
interface GrafanaPanel {
  id: number;
  title: string;
  type: string;
  gridPos: { h: number; w: number; x: number; y: number };
  targets: GrafanaTarget[];
  fieldConfig?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

interface GrafanaTarget {
  expr: string;
  legendFormat: string;
  refId: string;
}

interface GrafanaDashboard {
  title: string;
  uid: string;
  schemaVersion: number;
  version: number;
  refresh: string;
  time: { from: string; to: string };
  panels: GrafanaPanel[];
  templating: { list: unknown[] };
  annotations: { list: unknown[] };
}

/** Helper: build a minimal stat/timeseries panel */
function panel(
  id: number,
  title: string,
  type: 'timeseries' | 'stat' | 'gauge',
  expr: string,
  legendFormat: string,
  pos: { x: number; y: number; w?: number; h?: number },
): GrafanaPanel {
  return {
    id,
    title,
    type,
    gridPos: { h: pos.h ?? 8, w: pos.w ?? 12, x: pos.x, y: pos.y },
    targets: [{ expr, legendFormat, refId: 'A' }],
    fieldConfig: {
      defaults: {
        color: { mode: 'palette-classic' },
        custom: { lineWidth: 1, fillOpacity: 10 },
      },
      overrides: [],
    },
    options:
      type === 'timeseries'
        ? { tooltip: { mode: 'single' }, legend: { displayMode: 'list', placement: 'bottom' } }
        : { reduceOptions: { calcs: ['lastNotNull'] }, orientation: 'auto', textMode: 'auto', colorMode: 'background' },
  };
}

/**
 * Generate a Grafana dashboard JSON for the algo-trade platform.
 *
 * Import via: Grafana UI → Dashboards → Import → paste JSON
 * Datasource must be named "Prometheus" or update datasource uid below.
 *
 * @returns Grafana dashboard configuration object (JSON-serializable)
 */
export function generateGrafanaDashboard(): GrafanaDashboard {
  const panels: GrafanaPanel[] = [
    // Row 1: trades/sec and portfolio equity
    panel(
      1,
      'Trades / Second',
      'timeseries',
      'rate(trades_total[1m])',
      '{{strategy}}',
      { x: 0, y: 0, w: 12, h: 8 },
    ),
    panel(
      2,
      'Portfolio Equity (USD)',
      'timeseries',
      'portfolio_equity',
      'Equity',
      { x: 12, y: 0, w: 12, h: 8 },
    ),

    // Row 2: active strategies and API latency
    panel(
      3,
      'Active Strategies',
      'stat',
      'active_strategies',
      'Strategies',
      { x: 0, y: 8, w: 6, h: 8 },
    ),
    panel(
      4,
      'API Latency p99 (ms)',
      'timeseries',
      'histogram_quantile(0.99, rate(api_latency_ms_bucket[5m]))',
      'p99',
      { x: 6, y: 8, w: 12, h: 8 },
    ),

    // Row 3: error rate
    panel(
      5,
      'Trade Error Rate',
      'timeseries',
      'rate(trades_failed[5m]) / (rate(trades_total[5m]) + rate(trades_failed[5m]))',
      'Error Rate',
      { x: 18, y: 8, w: 6, h: 8 },
    ),
  ];

  return {
    title: 'Algo-Trade Platform',
    uid: 'algo-trade-main',
    schemaVersion: 38,
    version: 1,
    refresh: '30s',
    time: { from: 'now-24h', to: 'now' },
    panels,
    templating: { list: [] },
    annotations: { list: [] },
  };
}

/**
 * Serialize the dashboard to a formatted JSON string.
 * Useful for writing to disk or serving as a downloadable file.
 */
export function exportGrafanaDashboardJson(): string {
  return JSON.stringify(generateGrafanaDashboard(), null, 2);
}
