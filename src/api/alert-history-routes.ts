// GET /api/alerts/history — query past alerts, trade notifications, errors
// Supports filtering by type and since-timestamp

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AlertHistory } from '../notifications/alert-history.js';

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

let _alertHistory: AlertHistory | null = null;

/** Wire alert history ref from app.ts */
export function setAlertHistory(history: AlertHistory): void {
  _alertHistory = history;
}

/**
 * Handle alert routes:
 * - GET /api/alerts/history — recent alerts (query: ?limit=50&type=alert&since=<ts>)
 * - GET /api/alerts/types — available alert types
 */
export function handleAlertHistoryRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): boolean {
  if (!pathname.startsWith('/api/alerts/')) return false;

  if (method !== 'GET') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return true;
  }

  if (!_alertHistory) {
    sendJson(res, 503, { error: 'Alert history not available' });
    return true;
  }

  if (pathname === '/api/alerts/history') {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const type = url.searchParams.get('type');
    const since = Number(url.searchParams.get('since')) || 0;

    let alerts;
    if (since > 0) {
      alerts = _alertHistory.getSince(since, limit);
    } else if (type) {
      alerts = _alertHistory.getByType(type, limit);
    } else {
      alerts = _alertHistory.getRecent(limit);
    }

    sendJson(res, 200, { alerts, total: _alertHistory.count });
    return true;
  }

  if (pathname === '/api/alerts/types') {
    sendJson(res, 200, { types: _alertHistory.getTypes() });
    return true;
  }

  return false;
}
