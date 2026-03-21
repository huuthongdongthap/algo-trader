// Metrics collector - singleton registry for Prometheus-compatible metrics
// Supports counter, gauge, histogram types with optional label dimensions

export type MetricType = 'counter' | 'gauge' | 'histogram';

export interface MetricLabels {
  [key: string]: string;
}

export interface MetricSample {
  value: number;
  labels?: MetricLabels;
  /** For histograms: array of observed values */
  observations?: number[];
}

export interface Metric {
  name: string;
  type: MetricType;
  help: string;
  /** Samples keyed by serialized label string */
  samples: Map<string, MetricSample>;
}

/** Serialize labels to a stable string key */
function labelsKey(labels?: MetricLabels): string {
  if (!labels || Object.keys(labels).length === 0) return '__default__';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

export class MetricsCollector {
  private static instance: MetricsCollector;
  private registry: Map<string, Metric> = new Map();

  private constructor() {
    this.initBuiltins();
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /** Register built-in application metrics */
  private initBuiltins(): void {
    this.counter('trades_total', 'Total trades executed');
    this.counter('trades_failed', 'Total failed trade attempts');
    this.gauge('active_strategies', 'Number of active trading strategies', 0);
    this.gauge('portfolio_equity', 'Current portfolio equity in USD', 0);
    this.counter('api_requests_total', 'Total HTTP API requests received');
    this.histogram('api_latency_ms', 'API request latency in milliseconds');
    this.gauge('ws_connections', 'Current active WebSocket connections', 0);
  }

  /** Register or retrieve a counter metric */
  counter(name: string, help: string): Metric {
    if (!this.registry.has(name)) {
      this.registry.set(name, { name, type: 'counter', help, samples: new Map() });
    }
    return this.registry.get(name)!;
  }

  /** Register or set a gauge metric */
  gauge(name: string, help: string, value = 0): Metric {
    if (!this.registry.has(name)) {
      const metric: Metric = { name, type: 'gauge', help, samples: new Map() };
      metric.samples.set('__default__', { value });
      this.registry.set(name, metric);
    }
    return this.registry.get(name)!;
  }

  /** Register a histogram metric and record an initial observation */
  histogram(name: string, help: string, value?: number): Metric {
    if (!this.registry.has(name)) {
      this.registry.set(name, { name, type: 'histogram', help, samples: new Map() });
    }
    if (value !== undefined) this.observe(name, value);
    return this.registry.get(name)!;
  }

  /** Increment a counter by 1 */
  increment(name: string, labels?: MetricLabels): void {
    const metric = this.registry.get(name);
    if (!metric || metric.type !== 'counter') return;
    const key = labelsKey(labels);
    const existing = metric.samples.get(key);
    metric.samples.set(key, { value: (existing?.value ?? 0) + 1, labels });
  }

  /** Set an absolute value on a gauge */
  set(name: string, value: number, labels?: MetricLabels): void {
    const metric = this.registry.get(name);
    if (!metric || metric.type !== 'gauge') return;
    metric.samples.set(labelsKey(labels), { value, labels });
  }

  /** Record a histogram observation */
  observe(name: string, value: number, labels?: MetricLabels): void {
    const metric = this.registry.get(name);
    if (!metric || metric.type !== 'histogram') return;
    const key = labelsKey(labels);
    const existing = metric.samples.get(key);
    const observations = [...(existing?.observations ?? []), value];
    metric.samples.set(key, { value, labels, observations });
  }

  /** Return all registered metrics */
  getAll(): Metric[] {
    return Array.from(this.registry.values());
  }
}
