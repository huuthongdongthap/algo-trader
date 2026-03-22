// Marketplace API route handlers
// Endpoints: browse, strategy detail, publish, purchase, my-published, my-purchased
// Tier gate: only Pro and Enterprise can publish strategies

import type { IncomingMessage, ServerResponse } from 'node:http';
import { parse } from 'node:url';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import { getMarketplaceService, type MarketplaceCategory } from '../marketplace/marketplace-service.js';
import type { Tier } from '../users/subscription-tier.js';

const PUBLISH_TIERS: Set<Tier> = new Set(['pro', 'enterprise']);

// ─── Route dispatcher ─────────────────────────────────────────────────────────

/**
 * Handle all /api/marketplace/* requests.
 * Returns false if the path was not matched (caller should send 404).
 */
export async function handleMarketplaceRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  userId: string,
  userTier: Tier,
): Promise<boolean> {
  const parsed = parse(req.url ?? '/', true);
  const pathname = parsed.pathname ?? '/';
  const method = req.method ?? 'GET';
  const svc = getMarketplaceService();

  // GET /api/marketplace/browse
  if (pathname === '/api/marketplace/browse' && method === 'GET') {
    const page = Math.max(1, parseInt(String(parsed.query['page'] ?? '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(parsed.query['limit'] ?? '20'), 10)));
    const category = parsed.query['category'] as MarketplaceCategory | undefined;
    const result = svc.browseStrategies(page, limit, category);
    sendJson(res, 200, { ...result, page, limit });
    return true;
  }

  // GET /api/marketplace/my-published
  if (pathname === '/api/marketplace/my-published' && method === 'GET') {
    const items = svc.getMyPublished(userId);
    sendJson(res, 200, { items, count: items.length });
    return true;
  }

  // GET /api/marketplace/my-purchased
  if (pathname === '/api/marketplace/my-purchased' && method === 'GET') {
    const items = svc.getMyPurchased(userId);
    sendJson(res, 200, { items, count: items.length });
    return true;
  }

  // POST /api/marketplace/publish
  if (pathname === '/api/marketplace/publish' && method === 'POST') {
    if (!PUBLISH_TIERS.has(userTier)) {
      sendJson(res, 403, { error: 'Forbidden', message: 'Pro or Enterprise tier required to publish strategies' });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Bad Request', message: 'Invalid JSON body' });
      return true;
    }
    const { name, description, config, priceCents, category } = body;
    if (!name || !description || !config || priceCents === undefined || !category) {
      sendJson(res, 400, { error: 'Bad Request', message: 'Missing required fields: name, description, config, priceCents, category' });
      return true;
    }
    if (typeof priceCents !== 'number' || priceCents < 0) {
      sendJson(res, 400, { error: 'Bad Request', message: 'priceCents must be a non-negative number' });
      return true;
    }
    try {
      const listing = svc.publishStrategy(
        userId,
        String(name),
        String(description),
        config as Record<string, unknown>,
        priceCents,
        category as MarketplaceCategory,
      );
      sendJson(res, 201, { listing });
    } catch (err) {
      sendJson(res, 500, { error: 'Internal Server Error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
    return true;
  }

  // GET /api/marketplace/strategy/:id
  const strategyDetailMatch = pathname.match(/^\/api\/marketplace\/strategy\/([^/]+)$/);
  if (strategyDetailMatch && method === 'GET') {
    const id = strategyDetailMatch[1]!;
    const listing = svc.getStrategy(id);
    if (!listing) {
      sendJson(res, 404, { error: 'Not Found', message: 'Strategy not found' });
      return true;
    }
    // Omit configJson from public detail unless the requester purchased it
    const { configJson: _c, ...publicData } = listing;
    void _c;
    sendJson(res, 200, { strategy: publicData });
    return true;
  }

  // POST /api/marketplace/purchase/:id
  const purchaseMatch = pathname.match(/^\/api\/marketplace\/purchase\/([^/]+)$/);
  if (purchaseMatch && method === 'POST') {
    const strategyId = purchaseMatch[1]!;
    try {
      const { purchase, config } = svc.purchaseStrategy(userId, strategyId);
      sendJson(res, 200, { purchase, config });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      const status = msg === 'Already purchased' || msg === 'Strategy not found or inactive' ? 400 : 500;
      sendJson(res, status, { error: status === 400 ? 'Bad Request' : 'Internal Server Error', message: msg });
    }
    return true;
  }

  // GET /api/marketplace/export/:id — export strategy config as JSON (author or purchaser only)
  const exportMatch = pathname.match(/^\/api\/marketplace\/export\/([^/]+)$/);
  if (exportMatch && method === 'GET') {
    const id = exportMatch[1]!;
    const listing = svc.getStrategy(id);
    if (!listing) {
      sendJson(res, 404, { error: 'Not Found', message: 'Strategy not found' });
      return true;
    }
    // Only author or purchaser can export
    const isPurchaser = svc.getMyPurchased(userId).some(p => p.purchase.strategyId === id);
    if (listing.authorId !== userId && !isPurchaser) {
      sendJson(res, 403, { error: 'Forbidden', message: 'You must be the author or have purchased this strategy to export' });
      return true;
    }
    const config = JSON.parse(listing.configJson) as Record<string, unknown>;
    sendJson(res, 200, {
      exportVersion: 1,
      name: listing.name,
      description: listing.description,
      category: listing.category,
      config,
      exportedAt: Date.now(),
    });
    return true;
  }

  // POST /api/marketplace/import — import strategy config and publish as new listing
  if (pathname === '/api/marketplace/import' && method === 'POST') {
    if (!PUBLISH_TIERS.has(userTier)) {
      sendJson(res, 403, { error: 'Forbidden', message: 'Pro or Enterprise tier required to import strategies' });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: 'Bad Request', message: 'Invalid JSON body' });
      return true;
    }
    const { name, description, category, config, priceCents } = body;
    if (!name || !config) {
      sendJson(res, 400, { error: 'Bad Request', message: 'Missing required fields: name, config' });
      return true;
    }
    try {
      const listing = svc.publishStrategy(
        userId,
        String(name),
        String(description ?? 'Imported strategy'),
        config as Record<string, unknown>,
        typeof priceCents === 'number' ? priceCents : 0,
        (category as MarketplaceCategory) ?? 'other',
      );
      sendJson(res, 201, { listing, imported: true });
    } catch (err) {
      sendJson(res, 500, { error: 'Internal Server Error', message: err instanceof Error ? err.message : 'Unknown error' });
    }
    return true;
  }

  return false;
}
