// Strategy start/stop route handlers - POST /api/strategy/start|stop
// Extracted from routes.ts to keep main router under 200 lines
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { TradingEngine } from '../engine/engine.js';
import type { StrategyName } from '../core/types.js';

const VALID_STRATEGIES = new Set<string>([
  'cross-market-arb',
  'market-maker',
  'grid-trading',
  'dca-bot',
  'funding-rate-arb',
]);

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

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

async function parseAndValidateStrategy(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<string | null> {
  let body: { name?: string };
  try {
    body = await readJsonBody<{ name?: string }>(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON body' });
    return null;
  }
  const { name } = body;
  if (!name || !VALID_STRATEGIES.has(name)) {
    sendJson(res, 400, { error: 'Invalid strategy name', valid: [...VALID_STRATEGIES] });
    return null;
  }
  return name;
}

/** POST /api/strategy/start */
export async function handleStrategyStart(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
): Promise<void> {
  const name = await parseAndValidateStrategy(req, res);
  if (!name) return;
  try {
    await engine.getRunner().startStrategy(name as StrategyName);
    sendJson(res, 200, { ok: true, strategy: name, action: 'started' });
  } catch (err) {
    sendJson(res, 500, { error: 'Failed to start strategy', message: err instanceof Error ? err.message : String(err) });
  }
}

/** POST /api/strategy/stop */
export async function handleStrategyStop(
  req: IncomingMessage,
  res: ServerResponse,
  engine: TradingEngine,
): Promise<void> {
  const name = await parseAndValidateStrategy(req, res);
  if (!name) return;
  try {
    await engine.getRunner().stopStrategy(name as StrategyName);
    sendJson(res, 200, { ok: true, strategy: name, action: 'stopped' });
  } catch (err) {
    sendJson(res, 500, { error: 'Failed to stop strategy', message: err instanceof Error ? err.message : String(err) });
  }
}
