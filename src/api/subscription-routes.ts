// Subscription lifecycle REST API routes
// GET  /api/subscription/status — get current subscription state
// GET  /api/subscription/usage  — get usage history
// POST /api/subscription/trial  — start a 14-day Pro trial
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import { SubscriptionLifecycle } from '../billing/subscription-lifecycle.js';

// Module-level singleton
let _lifecycle: SubscriptionLifecycle | null = null;

export function setSubscriptionLifecycle(lifecycle: SubscriptionLifecycle): void {
  _lifecycle = lifecycle;
}

function getLifecycle(): SubscriptionLifecycle {
  if (!_lifecycle) _lifecycle = new SubscriptionLifecycle();
  return _lifecycle;
}

export async function handleSubscriptionRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<boolean> {
  const lifecycle = getLifecycle();

  // GET /api/subscription/status?userId=xxx
  if (pathname === '/api/subscription/status' && method === 'GET') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (!userId) { sendJson(res, 400, { error: 'Missing userId query param' }); return true; }

    const record = lifecycle.getSubscription(userId);
    if (!record) { sendJson(res, 404, { error: 'No subscription found' }); return true; }

    sendJson(res, 200, {
      ...record,
      isTrialExpired: lifecycle.isTrialExpired(userId),
      isPeriodExpired: lifecycle.isPeriodExpired(userId),
    });
    return true;
  }

  // GET /api/subscription/usage?userId=xxx
  if (pathname === '/api/subscription/usage' && method === 'GET') {
    const url = new URL(req.url ?? '', 'http://localhost');
    const userId = url.searchParams.get('userId');
    if (!userId) { sendJson(res, 400, { error: 'Missing userId query param' }); return true; }

    const history = lifecycle.getUsageHistory(userId);
    sendJson(res, 200, { userId, history });
    return true;
  }

  // POST /api/subscription/trial — body: { userId }
  if (pathname === '/api/subscription/trial' && method === 'POST') {
    let body: Record<string, unknown>;
    try { body = await readJsonBody(req); }
    catch { sendJson(res, 400, { error: 'Invalid JSON' }); return true; }

    const userId = body['userId'] as string | undefined;
    if (!userId) { sendJson(res, 400, { error: 'Missing userId' }); return true; }

    // Check if already has subscription
    const existing = lifecycle.getSubscription(userId);
    if (existing) {
      sendJson(res, 409, { error: 'User already has a subscription', state: existing.state });
      return true;
    }

    const record = lifecycle.startTrial(userId);
    sendJson(res, 201, record);
    return true;
  }

  return false;
}
