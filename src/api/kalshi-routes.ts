// Kalshi prediction market API routes for algo-trade RaaS platform
// GET /api/kalshi/markets — list active markets
// GET /api/kalshi/balance — get account balance
// GET /api/kalshi/positions — get open positions
// POST /api/kalshi/order — place an order
// GET /api/kalshi/scan — scan for arbitrage opportunities
// POST /api/kalshi/cross-scan — scan cross-platform arb (Kalshi vs Polymarket)
// DELETE /api/kalshi/order/:id — cancel an open order
// GET /api/kalshi/orders — list tracked open orders

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import type { AuthenticatedRequest } from './auth-middleware.js';
import type { KalshiClient } from '../kalshi/kalshi-client.js';
import type { KalshiMarketScanner, PolymarketPriceMap } from '../kalshi/kalshi-market-scanner.js';
import type { KalshiOrderManager } from '../kalshi/kalshi-order-manager.js';

export interface KalshiDeps {
  client: KalshiClient;
  scanner: KalshiMarketScanner;
  orderManager: KalshiOrderManager;
}

let _deps: KalshiDeps | null = null;
export function setKalshiDeps(deps: KalshiDeps): void { _deps = deps; }

export function handleKalshiRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): boolean {
  const authReq = req as AuthenticatedRequest;
  if (!authReq.user) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return true;
  }

  if (!_deps) {
    sendJson(res, 503, { error: 'Kalshi not configured' });
    return true;
  }

  // Pro tier minimum for all Kalshi endpoints
  if (authReq.user.tier === 'free') {
    sendJson(res, 403, { error: 'Pro tier required for Kalshi access' });
    return true;
  }

  // GET /api/kalshi/markets
  if (pathname === '/api/kalshi/markets' && method === 'GET') {
    void (async () => {
      try {
        const markets = await _deps!.client.getMarkets();
        sendJson(res, 200, { markets, count: markets.length });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/kalshi/balance
  if (pathname === '/api/kalshi/balance' && method === 'GET') {
    void (async () => {
      try {
        const balance = await _deps!.client.getBalance();
        sendJson(res, 200, { balance });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/kalshi/positions
  if (pathname === '/api/kalshi/positions' && method === 'GET') {
    void (async () => {
      try {
        const positions = await _deps!.client.getPositions();
        sendJson(res, 200, { positions, count: positions.length });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/kalshi/order
  if (pathname === '/api/kalshi/order' && method === 'POST') {
    void (async () => {
      try {
        const body = await readJsonBody<{
          ticker: string; side: string; type?: string; price: number; count: number;
        }>(req);
        if (!body.ticker || !body.side || !body.price || !body.count) {
          sendJson(res, 400, { error: 'Required: ticker, side, price, count' });
          return;
        }
        const order = await _deps!.client.placeOrder(
          body.ticker,
          body.side as 'yes' | 'no',
          (body.type ?? 'limit') as 'limit' | 'market',
          body.price,
          body.count,
        );
        sendJson(res, 200, { order });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/kalshi/scan
  if (pathname === '/api/kalshi/scan' && method === 'GET') {
    void (async () => {
      try {
        const opportunities = await _deps!.scanner.scanOpportunities();
        sendJson(res, 200, { opportunities, count: opportunities.length });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  // GET /api/kalshi/orders — list tracked open orders
  if (pathname === '/api/kalshi/orders' && method === 'GET') {
    const orders = _deps!.orderManager.getOpenOrders();
    sendJson(res, 200, { orders, count: orders.length });
    return true;
  }

  // DELETE /api/kalshi/order/:id — cancel an open order
  const cancelMatch = pathname.match(/^\/api\/kalshi\/order\/([^/]+)$/);
  if (cancelMatch && method === 'DELETE') {
    void (async () => {
      try {
        const orderId = cancelMatch[1]!;
        const success = await _deps!.client.cancelOrder(orderId);
        sendJson(res, 200, { ok: success, orderId });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/kalshi/cross-scan
  if (pathname === '/api/kalshi/cross-scan' && method === 'POST') {
    void (async () => {
      try {
        const body = await readJsonBody<{
          prices: Array<{ conditionId: string; title: string; midPrice: number }>;
        }>(req);
        if (!body.prices || body.prices.length === 0) {
          sendJson(res, 400, { error: 'Required: non-empty prices array' });
          return;
        }
        const priceMap: PolymarketPriceMap = new Map(
          body.prices.map((p) => [p.conditionId, p]),
        );
        const opportunities = await _deps!.scanner.findArbOpportunities(priceMap);
        sendJson(res, 200, { opportunities, count: opportunities.length });
      } catch (err) {
        sendJson(res, 500, { error: String(err) });
      }
    })();
    return true;
  }

  return false;
}
