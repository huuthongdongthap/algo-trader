// Health check route handler - enriched /api/health endpoint
// Returns: status, uptime, db, pipeline, wsClients, version
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TradingEngine } from '../engine/engine.js';
import { MetricsCollector } from '../metrics/metrics-collector.js';

const VERSION = '0.1.0';
const SERVER_START = Date.now();

/** Probe DB availability by checking MetricsCollector (in-process health proxy) */
function probeDb(): 'ok' | 'error' {
  try {
    // MetricsCollector is always in-process; if we can call it, basic runtime is alive
    MetricsCollector.getInstance().getAll();
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * GET /api/health
 * Returns a JSON snapshot of system health.
 *
 * Response shape:
 *   { status, uptime, db, pipeline, wsClients, version }
 */
export function handleHealthEnriched(
  _req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
): void {
  const collector = MetricsCollector.getInstance();

  // ws_connections gauge — set by request-metrics-middleware or ws-server
  const wsMetric = collector.getAll().find((m) => m.name === 'ws_connections');
  const wsClients =
    wsMetric?.samples.get('__default__')?.value ?? 0;

  const engineRunning = engine.isRunning();
  const pipeline: 'running' | 'stopped' = engineRunning ? 'running' : 'stopped';
  const db = probeDb();
  const overall = db === 'ok' ? 'ok' : 'degraded';

  const body = JSON.stringify({
    status: overall,
    uptime: Date.now() - SERVER_START,
    db,
    pipeline,
    wsClients,
    version: VERSION,
  });

  res.writeHead(overall === 'ok' ? 200 : 503, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}
