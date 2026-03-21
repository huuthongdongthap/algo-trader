// Prometheus text format exporter - exposes /metrics HTTP endpoint
// Implements Prometheus exposition format 0.0.4 (plain text)
// No external dependencies - pure TypeScript implementation

import type { IncomingMessage, ServerResponse } from 'node:http';
import { MetricsCollector } from './metrics-collector.js';
import type { Metric, MetricSample } from './metrics-collector.js';

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Format a single label set as Prometheus label string: {k="v",...} */
function formatLabels(sample: MetricSample): string {
  if (!sample.labels || Object.keys(sample.labels).length === 0) return '';
  const parts = Object.entries(sample.labels)
    .map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`)
    .join(',');
  return `{${parts}}`;
}

/** Compute histogram summary stats for an observations array */
function histogramLines(name: string, sample: MetricSample): string {
  const obs = sample.observations ?? [];
  const labels = formatLabels(sample);
  const count = obs.length;
  const sum = obs.reduce((acc, v) => acc + v, 0);

  const lines: string[] = [];
  // Buckets: standard latency buckets in ms
  const buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, Infinity];
  for (const le of buckets) {
    const leLabel = le === Infinity ? '+Inf' : String(le);
    const bucketCount = obs.filter((v) => v <= le).length;
    const bucketLabels = sample.labels
      ? `{${Object.entries(sample.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')},le="${leLabel}"}`
      : `{le="${leLabel}"}`;
    lines.push(`${name}_bucket${bucketLabels} ${bucketCount}`);
  }
  lines.push(`${name}_sum${labels} ${sum}`);
  lines.push(`${name}_count${labels} ${count}`);
  return lines.join('\n');
}

/** Convert a single Metric to Prometheus text format lines */
function formatMetric(metric: Metric): string {
  const lines: string[] = [];
  lines.push(`# HELP ${metric.name} ${metric.help}`);
  lines.push(`# TYPE ${metric.name} ${metric.type}`);

  for (const sample of metric.samples.values()) {
    if (metric.type === 'histogram') {
      lines.push(histogramLines(metric.name, sample));
    } else {
      const labels = formatLabels(sample);
      lines.push(`${metric.name}${labels} ${sample.value}`);
    }
  }

  // Emit default 0 for counters/gauges with no samples yet
  if (metric.samples.size === 0 && metric.type !== 'histogram') {
    lines.push(`${metric.name} 0`);
  }

  return lines.join('\n');
}

/**
 * Convert all registered metrics to Prometheus text exposition format.
 * @param metrics - Array of Metric objects from MetricsCollector
 * @returns Multi-line string in Prometheus text format 0.0.4
 */
export function formatPrometheus(metrics: Metric[]): string {
  return metrics.map(formatMetric).join('\n\n') + '\n';
}

/**
 * Create an HTTP request handler for the GET /metrics endpoint.
 * Integrates with the existing pure Node.js http handler pattern from server.ts.
 *
 * Usage in routes.ts:
 *   if (pathname === '/metrics') return metricsHandler(req, res);
 */
export function createMetricsHandler(): (req: IncomingMessage, res: ServerResponse) => void {
  const collector = MetricsCollector.getInstance();

  return (_req: IncomingMessage, res: ServerResponse): void => {
    const body = formatPrometheus(collector.getAll());
    const bodyBytes = Buffer.from(body, 'utf-8');
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPE,
      'Content-Length': bodyBytes.length,
    });
    res.end(bodyBytes);
  };
}
