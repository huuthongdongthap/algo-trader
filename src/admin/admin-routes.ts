// Admin REST API router for algo-trade platform
// All endpoints require X-Admin-Key header — no public routes here
import type { IncomingMessage, ServerResponse } from 'node:http';
import { TradingEngine } from '../engine/engine.js';
import { UserStore } from '../users/user-store.js';
import type { StrategyName } from '../core/types.js';
import { validateAdminKey } from './admin-auth.js';
import { getSystemStats } from './system-stats.js';
import {
  handleListUsers,
  handleGetUser,
  handleBanUser,
  handleUpgradeUser,
} from './admin-user-handlers.js';

// ─── Maintenance mode state ───────────────────────────────────────────────────

let maintenanceMode = false;

export function isMaintenanceMode(): boolean {
  return maintenanceMode;
}

// ─── Response helpers ─────────────────────────────────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendNotFound(res: ServerResponse): void {
  sendJson(res, 404, { error: 'Not Found' });
}

function sendMethodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { error: 'Method Not Allowed' });
}

// ─── Body parser ──────────────────────────────────────────────────────────────

async function readJsonBody<T = Record<string, unknown>>(req: IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? (JSON.parse(raw) as T) : ({} as T));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ─── System & strategy handlers ───────────────────────────────────────────────

/** GET /admin/system — system overview stats */
function handleSystemOverview(
  res: ServerResponse,
  engine: TradingEngine,
  userStore: UserStore,
): void {
  const stats = getSystemStats(engine, userStore);
  sendJson(res, 200, stats);
}

/** POST /admin/strategy/:name/stop — force-stop a running strategy */
async function handleForceStopStrategy(
  res: ServerResponse,
  strategyName: string,
  engine: TradingEngine,
): Promise<void> {
  try {
    await engine.getRunner().stopStrategy(strategyName as StrategyName);
    sendJson(res, 200, { ok: true, strategy: strategyName, action: 'force-stopped' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to stop strategy', message });
  }
}

/** POST /admin/maintenance — set or toggle maintenance mode */
async function handleToggleMaintenance(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: { enabled?: boolean };
  try {
    body = await readJsonBody<{ enabled?: boolean }>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }
  maintenanceMode = typeof body.enabled === 'boolean' ? body.enabled : !maintenanceMode;
  sendJson(res, 200, { ok: true, maintenanceMode });
}

// ─── Main admin router ────────────────────────────────────────────────────────

/**
 * Route admin requests. Validates X-Admin-Key before dispatching.
 * pathname must be pre-extracted (no query string).
 */
export async function handleAdminRequest(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
  userStore: UserStore,
  pathname: string,
): Promise<void> {
  if (!validateAdminKey(req, res)) return;

  const method = req.method ?? 'GET';

  // GET /admin/users
  if (pathname === '/admin/users') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleListUsers(res, userStore);
    return;
  }

  // GET /admin/users/:id
  const userDetailMatch = pathname.match(/^\/admin\/users\/([^/]+)$/);
  if (userDetailMatch) {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleGetUser(res, userDetailMatch[1]!, userStore);
    return;
  }

  // POST /admin/users/:id/ban
  const banMatch = pathname.match(/^\/admin\/users\/([^/]+)\/ban$/);
  if (banMatch) {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    handleBanUser(res, banMatch[1]!, userStore);
    return;
  }

  // POST /admin/users/:id/upgrade
  const upgradeMatch = pathname.match(/^\/admin\/users\/([^/]+)\/upgrade$/);
  if (upgradeMatch) {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    await handleUpgradeUser(req, res, upgradeMatch[1]!, userStore);
    return;
  }

  // GET /admin/system
  if (pathname === '/admin/system') {
    if (method !== 'GET') { sendMethodNotAllowed(res); return; }
    handleSystemOverview(res, engine, userStore);
    return;
  }

  // POST /admin/strategy/:name/stop
  const strategyStopMatch = pathname.match(/^\/admin\/strategy\/([^/]+)\/stop$/);
  if (strategyStopMatch) {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    await handleForceStopStrategy(res, strategyStopMatch[1]!, engine);
    return;
  }

  // POST /admin/maintenance
  if (pathname === '/admin/maintenance') {
    if (method !== 'POST') { sendMethodNotAllowed(res); return; }
    await handleToggleMaintenance(req, res);
    return;
  }

  sendNotFound(res);
}
