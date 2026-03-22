// API routes for user webhook registration management
// POST /api/webhooks/register, GET /api/webhooks/my, DELETE /api/webhooks/:id

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import type { UserWebhookRegistry } from '../webhooks/user-webhook-registry.js';
import type { AuthenticatedRequest } from './auth-middleware.js';

let _registry: UserWebhookRegistry | null = null;
export function setUserWebhookRegistry(registry: UserWebhookRegistry): void {
  _registry = registry;
}

export function handleUserWebhookRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): boolean {
  if (!pathname.startsWith('/api/webhooks/')) return false;
  if (!_registry) { sendJson(res, 503, { error: 'Webhook registry not configured' }); return true; }

  const authReq = req as AuthenticatedRequest;
  const userId = authReq.user?.id;
  if (!userId) { sendJson(res, 401, { error: 'Unauthorized' }); return true; }

  // POST /api/webhooks/register
  if (pathname === '/api/webhooks/register' && method === 'POST') {
    readJsonBody(req).then(body => {
      const url = body['url'] as string | undefined;
      if (!url || typeof url !== 'string') {
        sendJson(res, 400, { error: 'Missing required field: url' });
        return;
      }
      const events = Array.isArray(body['events']) ? (body['events'] as string[]) : ['trade'];
      const reg = _registry!.register(userId, url, events);
      sendJson(res, 201, { webhook: reg });
    }).catch(() => {
      sendJson(res, 400, { error: 'Invalid JSON body' });
    });
    return true;
  }

  // GET /api/webhooks/my
  if (pathname === '/api/webhooks/my' && method === 'GET') {
    const webhooks = _registry.getByUser(userId);
    sendJson(res, 200, { webhooks, count: webhooks.length });
    return true;
  }

  // DELETE /api/webhooks/:id
  const deleteMatch = pathname.match(/^\/api\/webhooks\/([0-9a-f-]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = deleteMatch[1]!;
    const removed = _registry.remove(id, userId);
    if (!removed) {
      sendJson(res, 404, { error: 'Webhook not found or not owned by you' });
      return true;
    }
    sendJson(res, 200, { ok: true, id });
    return true;
  }

  // GET /api/webhooks/stats
  if (pathname === '/api/webhooks/stats' && method === 'GET') {
    sendJson(res, 200, _registry.getStats());
    return true;
  }

  return false;
}
