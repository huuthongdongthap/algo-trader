// API routes for P&L share card generation — viral growth loop
import type { IncomingMessage, ServerResponse } from 'node:http';
import { generateShareCard, buildShareCardData, type ShareCardData } from '../growth/pnl-share-card-generator.js';
import type { AuthenticatedRequest } from './auth-middleware.js';

/** GET /api/share/card?period=weekly — generate shareable P&L card */
export function handleShareCardRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  _getSnapshot: () => { equity: string; realizedPnl: string; tradeCount: number; winCount: number; drawdown: number },
  _getExtras: () => { sharpeRatio: number; tier: number; brierScore: number | null },
): boolean {
  if (pathname !== '/api/share/card') return false;
  if (req.method !== 'GET') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return true;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const period = (url.searchParams.get('period') ?? 'daily') as ShareCardData['period'];
  if (!['daily', 'weekly', 'monthly'].includes(period)) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid period. Use daily, weekly, or monthly.' }));
    return true;
  }

  const snapshot = _getSnapshot();
  const extras = _getExtras();
  const data = buildShareCardData(
    { ...snapshot, timestamp: Date.now(), peakEquity: snapshot.equity, unrealizedPnl: '0' },
    { ...extras, period },
  );
  const card = generateShareCard(data);

  const format = url.searchParams.get('format') ?? 'json';
  if (format === 'html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(card.html);
  } else {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: card.text, html: card.html, hashtags: card.hashtags }));
  }

  void (_getSnapshot as unknown as AuthenticatedRequest); // suppress unused import lint
  return true;
}
