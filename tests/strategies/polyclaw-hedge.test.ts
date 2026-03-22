import { describe, it, expect, vi } from 'vitest';
import { PolyClawHedgeStrategy } from '../../src/strategies/polymarket/polyclaw-hedge.js';
import type { ClobClient } from '../../src/polymarket/clob-client.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';

function makeMockClient(): ClobClient {
  return {
    isPaperMode: true,
    postOrder: vi.fn().mockResolvedValue({ id: 'order-1', status: 'open', side: 'buy', price: '0.5', size: '100', marketId: 'm1', createdAt: Date.now() }),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getPrice: vi.fn().mockResolvedValue({ mid: '0.5', bid: '0.49', ask: '0.51' }),
    getOrderBook: vi.fn(),
    getMarkets: vi.fn(),
  } as unknown as ClobClient;
}

function makeMockRouter(): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({
      content: '{"implied_by":[],"implies":[]}',
      model: 'test',
      tokensUsed: 50,
      latencyMs: 100,
    }),
  } as unknown as AiRouter;
}

describe('PolyClawHedgeStrategy', () => {
  it('should create with default config', () => {
    const strategy = new PolyClawHedgeStrategy(
      makeMockClient(),
      makeMockRouter(),
      { name: 'polyclaw-hedge', enabled: true, capitalAllocation: '1000', params: {} },
      '1000',
    );
    expect(strategy.name).toBe('polyclaw-hedge');
  });

  it('should return status', () => {
    const strategy = new PolyClawHedgeStrategy(
      makeMockClient(),
      makeMockRouter(),
      { name: 'polyclaw-hedge', enabled: true, capitalAllocation: '1000', params: {} },
      '1000',
    );
    const status = strategy.getStatus();
    expect(status.running).toBe(false);
    expect(status.openHedges).toBe(0);
    expect(status.totalExecuted).toBe(0);
    expect(status.totalPnl).toBe(0);
  });

  it('should return PnL snapshot', () => {
    const strategy = new PolyClawHedgeStrategy(
      makeMockClient(),
      makeMockRouter(),
      { name: 'polyclaw-hedge', enabled: true, capitalAllocation: '500', params: {} },
      '500',
    );
    const pnl = strategy.getPnL();
    expect(pnl).toBeDefined();
    expect(pnl.equity).toBeDefined();
  });

  it('should accept custom config params', () => {
    const strategy = new PolyClawHedgeStrategy(
      makeMockClient(),
      makeMockRouter(),
      {
        name: 'polyclaw-hedge',
        enabled: true,
        capitalAllocation: '2000',
        params: { scanLimit: 5, maxTier: 1, maxOpenHedges: 3 },
      },
      '2000',
    );
    expect(strategy.name).toBe('polyclaw-hedge');
  });

  it('should stop without error', async () => {
    const strategy = new PolyClawHedgeStrategy(
      makeMockClient(),
      makeMockRouter(),
      { name: 'polyclaw-hedge', enabled: true, capitalAllocation: '1000', params: {} },
      '1000',
    );
    await strategy.stop();
    expect(strategy.getStatus().running).toBe(false);
  });
});
