/**
 * Dashboard HTTP server
 * Serves static files and delegates API requests to route handlers
 * Pure node:http + node:fs — no Express
 */
import { createServer as createHttpServer } from 'node:http';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DashboardDataProvider } from './dashboard-data.js';
import { logger } from '../core/logger.js';
import type { UserStore } from '../users/user-store.js';
import { AdminAnalytics } from '../admin/admin-analytics.js';
import type { AiSignalGenerator } from '../openclaw/ai-signal-generator.js';
import type { TradeObserver } from '../openclaw/trade-observer.js';
import type { LeaderBoard } from '../copy-trading/leader-board.js';
import { applyCors } from './dashboard-middleware.js';
import { sendJson, serveStatic } from './dashboard-utils.js';
import {
  handleAuthRoutes,
  handleAdminPostRoutes,
  handleAdminGetRoutes,
  handleApiGetRoutes,
} from './dashboard-routes.js';

/** Optional AI + social deps injected from app.ts for live data */
export interface DashboardDeps {
  signalGenerator?: AiSignalGenerator;
  tradeObserver?: TradeObserver;
  leaderBoard?: LeaderBoard;
  /** Accessor for hedge scan results pushed by scheduler job */
  getHedgePortfolios?: () => { portfolios: HedgeResult[]; lastScanAt: number; count: number };
}

export interface HedgeResult {
  tier: number; coverage: number; profitPct: number;
  targetQuestion: string; coverQuestion: string;
  targetId: string; coverId: string;
}

const PUBLIC_DIR = join(fileURLToPath(import.meta.url), '..', 'public');
const UI_DIR = join(fileURLToPath(import.meta.url), '..', '..', 'ui');

// ── Hedge portfolio state (Sprint 239: PolyClaw dashboard integration) ────────

/** In-memory store for last hedge scan results (populated by scheduler job) */
let _lastHedgeResults: HedgeResult[] = [];
let _lastHedgeScanAt = 0;

/** Called by scheduler hedge job to push results to dashboard */
export function setHedgeResults(results: HedgeResult[]): void {
  _lastHedgeResults = results;
  _lastHedgeScanAt = Date.now();
}

function getHedgePortfolios() {
  return { portfolios: _lastHedgeResults, lastScanAt: _lastHedgeScanAt, count: _lastHedgeResults.length };
}

/**
 * Create and start the dashboard HTTP server.
 * @param port - TCP port to listen on
 * @param dataProvider - DashboardDataProvider instance for API responses
 * @param userStore - Optional UserStore for real revenue/user analytics
 * @param deps - Optional AI + social dependencies for live data
 * @returns running http.Server instance
 */
export function createDashboardServer(
  port: number,
  dataProvider: DashboardDataProvider,
  userStore?: UserStore,
  deps: DashboardDeps = {},
): Server {
  const analytics = userStore ? new AdminAnalytics(userStore) : null;
  const jwtSecret = process.env['JWT_SECRET'] ?? '';
  const depsWithHedge: DashboardDeps = { ...deps, getHedgePortfolios };

  const server = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    // CORS with strict origin allowlist
    applyCors(req, res);
    if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    const ctx = { url, method, req, res, dataProvider, analytics, userStore, jwtSecret, deps: depsWithHedge };

    try {
      // Auth endpoints (POST) on dashboard port
      if (await handleAuthRoutes(ctx)) return;

      // Admin POST routes
      if (await handleAdminPostRoutes(ctx)) return;

      // Only GET beyond this point
      if (method !== 'GET') { sendJson(res, 405, { error: 'Method Not Allowed' }); return; }

      // Admin GET routes
      if (handleAdminGetRoutes(ctx)) return;

      // Authenticated API GET routes
      if (handleApiGetRoutes(ctx)) return;

      // Static file serving
      const staticPath = url === '/' ? '/index.html' : url;

      // Serve design system files from src/ui/ for /ui/* paths
      if (staticPath.startsWith('/ui/')) {
        const uiPath = resolve(UI_DIR, staticPath.slice(4));
        if (!uiPath.startsWith(resolve(UI_DIR))) { sendJson(res, 403, { error: 'Forbidden' }); return; }
        await serveStatic(res, uiPath);
        return;
      }

      // Prevent directory traversal for public assets
      const safePath = resolve(PUBLIC_DIR, staticPath.slice(1));
      if (!safePath.startsWith(resolve(PUBLIC_DIR))) { sendJson(res, 403, { error: 'Forbidden' }); return; }
      await serveStatic(res, safePath);

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      sendJson(res, 500, { error: 'Internal Server Error', message });
    }
  });

  server.listen(port, () => {
    logger.info(`Server listening on http://localhost:${port}`, 'Dashboard');
  });

  return server;
}

/** Gracefully shut down the dashboard server */
export function stopDashboardServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => { if (err) reject(err); else resolve(); });
  });
}
