// DEX swap API routes for algo-trade RaaS platform
// GET /api/dex/chains — list configured chains
// POST /api/dex/quote — get swap quote (calcMinOutput)
// POST /api/dex/swap — execute a swap (Pro tier minimum)

import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson, readJsonBody } from './http-response-helpers.js';
import type { AuthenticatedRequest } from './auth-middleware.js';
import type { SwapRouter } from '../dex/swap-router.js';
import type { SupportedChain } from '../dex/swap-router.js';

let _swapRouter: SwapRouter | null = null;
export function setSwapRouter(router: SwapRouter): void { _swapRouter = router; }

export function handleDexRoutes(
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

  if (!_swapRouter) {
    sendJson(res, 503, { error: 'DEX not configured' });
    return true;
  }

  // GET /api/dex/chains
  if (pathname === '/api/dex/chains' && method === 'GET') {
    const chains = _swapRouter.getConfiguredChains();
    sendJson(res, 200, { chains, count: chains.length });
    return true;
  }

  // POST /api/dex/quote
  if (pathname === '/api/dex/quote' && method === 'POST') {
    void (async () => {
      try {
        const body = await readJsonBody<{ amountIn: string; slippageBps?: number }>(req);
        if (!body.amountIn) {
          sendJson(res, 400, { error: 'Required: amountIn' });
          return;
        }
        const amountIn = BigInt(body.amountIn);
        const slippageBps = body.slippageBps ?? 50; // default 0.5%
        const { SwapRouter: SR } = await import('../dex/swap-router.js');
        const minOutput = SR.calcMinOutput(amountIn, slippageBps);
        sendJson(res, 200, { amountIn: amountIn.toString(), slippageBps, minOutput: minOutput.toString() });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
    })();
    return true;
  }

  // POST /api/dex/swap (Pro tier minimum)
  if (pathname === '/api/dex/swap' && method === 'POST') {
    if (authReq.user.tier === 'free') {
      sendJson(res, 403, { error: 'Pro tier required for DEX swaps' });
      return true;
    }
    void (async () => {
      try {
        const body = await readJsonBody<{
          chain: string; tokenIn: string; tokenOut: string;
          amountIn: string; slippageBps?: number; recipient?: string;
        }>(req);
        if (!body.chain || !body.tokenIn || !body.tokenOut || !body.amountIn) {
          sendJson(res, 400, { error: 'Required: chain, tokenIn, tokenOut, amountIn' });
          return;
        }
        if (!_swapRouter!.isChainReady(body.chain as SupportedChain)) {
          sendJson(res, 400, { error: `Chain not configured: ${body.chain}` });
          return;
        }
        const result = await _swapRouter!.swap({
          chain: body.chain as SupportedChain,
          tokenIn: body.tokenIn,
          tokenOut: body.tokenOut,
          amountIn: BigInt(body.amountIn),
          slippageBps: body.slippageBps ?? 50,
          recipient: body.recipient,
        });
        sendJson(res, 200, {
          chain: result.chain,
          txHash: result.txHash,
          amountIn: result.amountIn.toString(),
          amountOutMin: result.amountOutMin.toString(),
          success: result.success,
        });
      } catch (err) {
        sendJson(res, 400, { error: String(err) });
      }
    })();
    return true;
  }

  return false;
}
