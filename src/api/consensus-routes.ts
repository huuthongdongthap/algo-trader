// Signal consensus REST API routes
// POST /api/signals/consensus — compute multi-source consensus from ML + AI
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import { computeConsensus, isActionable } from '../openclaw/signal-consensus.js';
import type { SignalScore } from '../ml/signal-model.js';
import type { TradeAnalysis } from '../openclaw/controller.js';

export async function handleConsensusRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<boolean> {
  if (pathname !== '/api/signals/consensus' || method !== 'POST') return false;

  let body: Record<string, unknown>;
  try { body = await readJsonBody(req); }
  catch { sendJson(res, 400, { error: 'Invalid JSON' }); return true; }

  const mlSignal = (body['mlSignal'] as SignalScore | null) ?? null;
  const aiAnalysis = (body['aiAnalysis'] as TradeAnalysis | null) ?? null;

  if (!mlSignal && !aiAnalysis) {
    sendJson(res, 400, { error: 'At least one of mlSignal or aiAnalysis is required' });
    return true;
  }

  const result = computeConsensus(mlSignal, aiAnalysis);
  sendJson(res, 200, {
    ...result,
    actionable: isActionable(result),
  });
  return true;
}
