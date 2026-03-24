import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StrategyOrchestrator } from '../strategies/strategy-orchestrator.js';
import { rateLimiterRegistry } from '../resilience/rate-limiter.js';

export interface StrategyHealthDeps {
  orchestrator: StrategyOrchestrator;
}

interface StrategyHealthReport {
  strategyId: string;
  name: string;
  status: 'running' | 'stopped' | 'error';
  tickCount: number;
  errorCount: number;
  lastTick: string | null;
  lastError: string | null;
  healthy: boolean;
}

interface SystemHealthReport {
  overall: boolean;
  strategies: StrategyHealthReport[];
  rateLimiter: {
    polymarket: number; // available tokens
  };
  timestamp: string;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

export function handleStrategyHealthRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  deps: StrategyHealthDeps,
): boolean {
  // GET /api/strategies/health — all strategies health
  if (pathname === '/api/strategies/health' && method === 'GET') {
    const statuses = deps.orchestrator.getStatus();
    const strategies: StrategyHealthReport[] = statuses.map(s => ({
      strategyId: s.id,
      name: s.name,
      status: s.status,
      tickCount: s.tickCount,
      errorCount: s.errorCount,
      lastTick: s.lastTick,
      lastError: s.lastError,
      healthy: s.status !== 'error',
    }));

    const polyTokens = rateLimiterRegistry.getAvailable('polymarket');

    const report: SystemHealthReport = {
      overall: deps.orchestrator.isHealthy() && polyTokens > 0,
      strategies,
      rateLimiter: { polymarket: polyTokens },
      timestamp: new Date().toISOString(),
    };

    sendJson(res, report.overall ? 200 : 503, report);
    return true;
  }

  // GET /api/strategies/:id/health — single strategy health
  const match = pathname.match(/^\/api\/strategies\/([^/]+)\/health$/);
  if (match && method === 'GET') {
    const strategyId = match[1]!;
    const status = deps.orchestrator.getStrategyStatus(strategyId);
    if (!status) {
      sendJson(res, 404, { error: `Strategy '${strategyId}' not found` });
      return true;
    }

    const report: StrategyHealthReport = {
      strategyId: status.id,
      name: status.name,
      status: status.status,
      tickCount: status.tickCount,
      errorCount: status.errorCount,
      lastTick: status.lastTick,
      lastError: status.lastError,
      healthy: status.status !== 'error',
    };

    sendJson(res, report.healthy ? 200 : 503, report);
    return true;
  }

  return false;
}
