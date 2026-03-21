// REST route handlers for the Strategy Marketplace
// Pattern mirrors src/api/routes.ts — pure Node.js, no framework
// Endpoints: GET /api/marketplace, GET /api/marketplace/:id,
//            POST /api/marketplace, POST /api/marketplace/:id/purchase

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StrategyCategory } from './strategy-registry.js';
import { validateListing, StrategyRegistry } from './strategy-registry.js';
import { getStrategyStore } from './strategy-store.js';
import type { SortBy } from './strategy-store.js';

// ─── Response helpers (same pattern as routes.ts) ────────────────────────────

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

/** Read and parse JSON body — returns empty object on empty body */
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

/** Shared in-memory registry — populated from DB on first search */
const registry = new StrategyRegistry();

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * GET /api/marketplace
 * Query params: q (keyword), category, sortBy
 */
export function handleListStrategies(req: IncomingMessage, res: ServerResponse): void {
  try {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const query = url.searchParams.get('q') ?? '';
    const category = url.searchParams.get('category') as StrategyCategory | null;
    const sortBy = (url.searchParams.get('sortBy') ?? 'downloads') as SortBy;

    const store = getStrategyStore();
    const listings = store.searchListings(query, category ?? undefined, sortBy);

    sendJson(res, 200, { listings, count: listings.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to list strategies', message });
  }
}

/**
 * GET /api/marketplace/:id
 */
export function handleGetStrategy(
  _req: IncomingMessage,
  res: ServerResponse,
  id: string,
): void {
  try {
    const store = getStrategyStore();
    const listing = store.getListingById(id);

    if (!listing) {
      sendJson(res, 404, { error: 'Strategy not found', id });
      return;
    }

    sendJson(res, 200, { listing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to fetch strategy', message });
  }
}

/**
 * POST /api/marketplace
 * Body: StrategyListing (without downloads/rating — those default to 0)
 */
export async function handlePublishStrategy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let body: Record<string, unknown>;
  try {
    body = await readJsonBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const now = Date.now();
  const listing = {
    downloads: 0,
    rating: 0,
    createdAt: now,
    updatedAt: now,
    ...body,
  } as Parameters<typeof validateListing>[0];

  const validation = validateListing(listing);
  if (!validation.valid) {
    sendJson(res, 400, { error: 'Validation failed', errors: validation.errors });
    return;
  }

  try {
    const store = getStrategyStore();
    // Cast is safe — validateListing confirmed all required fields are present
    store.saveListing(listing as Parameters<typeof registry.register>[0]);
    registry.register(listing as Parameters<typeof registry.register>[0]);

    sendJson(res, 201, { ok: true, id: listing.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to publish strategy', message });
  }
}

/**
 * POST /api/marketplace/:id/purchase
 * Body: { userId: string }
 */
export async function handlePurchaseStrategy(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
): Promise<void> {
  let body: { userId?: string };
  try {
    body = await readJsonBody<{ userId?: string }>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return;
  }

  const { userId } = body;
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    sendJson(res, 400, { error: 'userId is required' });
    return;
  }

  try {
    const store = getStrategyStore();
    const listing = store.getListingById(id);

    if (!listing) {
      sendJson(res, 404, { error: 'Strategy not found', id });
      return;
    }

    const purchaseId = store.recordPurchase(userId.trim(), id, listing.priceUsdc);

    sendJson(res, 200, {
      ok: true,
      purchaseId,
      strategyId: id,
      userId: userId.trim(),
      priceUsdc: listing.priceUsdc,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 500, { error: 'Failed to process purchase', message });
  }
}
