import { describe, it, expect, vi } from 'vitest';
import { buildPolymarketAdapter, type AdapterDeps } from '../../src/polymarket/polymarket-execution-adapter.js';

function makeDeps(overrides: Partial<AdapterDeps> = {}): AdapterDeps {
  return {
    riskManager: {
      canOpenPosition: vi.fn().mockReturnValue({ allowed: true }),
    } as any,
    orderManager: {
      placeOrder: vi.fn().mockResolvedValue({ id: 'live-order-1' }),
    } as any,
    orderbookStream: {
      getBook: vi.fn().mockReturnValue({
        bids: [{ price: '0.60', size: '100' }],
        asks: [{ price: '0.62', size: '100' }],
      }),
    } as any,
    paperExchange: {
      setPrice: vi.fn(),
      submitOrder: vi.fn().mockReturnValue({
        orderId: 'paper-order-1',
        marketId: 'token-1',
        side: 'buy',
        fillPrice: '0.61',
        fillSize: '50',
        fees: '0',
        timestamp: Date.now(),
        strategy: 'cross-market-arb',
      }),
    } as any,
    db: {
      getOpenPositions: vi.fn().mockReturnValue([]),
      insertTrade: vi.fn(),
    } as any,
    capitalUsdc: '10000',
    paperTrading: true,
    ...overrides,
  };
}

describe('buildPolymarketAdapter', () => {
  it('should return adapter with executeOrder method', () => {
    const adapter = buildPolymarketAdapter(makeDeps());
    expect(typeof adapter.executeOrder).toBe('function');
  });

  describe('paper mode', () => {
    it('should execute via paperExchange in paper mode', async () => {
      const deps = makeDeps({ paperTrading: true });
      const adapter = buildPolymarketAdapter(deps);
      const result = await adapter.executeOrder('buy', 'token-1', '0.61', '50');
      expect(result.orderId).toBe('paper-order-1');
      expect(deps.paperExchange.submitOrder).toHaveBeenCalled();
      expect(deps.db.insertTrade).toHaveBeenCalled();
    });

    it('should seed price from orderbook', async () => {
      const deps = makeDeps({ paperTrading: true });
      const adapter = buildPolymarketAdapter(deps);
      await adapter.executeOrder('buy', 'token-1', '0.61', '50');
      expect(deps.paperExchange.setPrice).toHaveBeenCalledWith('token-1', 0.61);
    });
  });

  describe('live mode', () => {
    it('should execute via orderManager in live mode', async () => {
      const deps = makeDeps({ paperTrading: false });
      const adapter = buildPolymarketAdapter(deps);
      const result = await adapter.executeOrder('buy', 'token-1', '0.61', '50');
      expect(result.orderId).toBe('live-order-1');
      expect(deps.orderManager.placeOrder).toHaveBeenCalled();
    });
  });

  describe('risk gate', () => {
    it('should block trade when risk check fails', async () => {
      const deps = makeDeps();
      (deps.riskManager.canOpenPosition as any).mockReturnValue({ allowed: false, reason: 'max exposure' });
      const adapter = buildPolymarketAdapter(deps);
      await expect(adapter.executeOrder('buy', 'token-1', '0.61', '50')).rejects.toThrow('Risk check failed');
    });

    it('should pass capital and positions to risk manager', async () => {
      const deps = makeDeps();
      (deps.db.getOpenPositions as any).mockReturnValue([
        { market: 'm1', side: 'buy', entry_price: '0.5', size: '100', unrealized_pnl: '10', opened_at: 1000 },
      ]);
      const adapter = buildPolymarketAdapter(deps);
      await adapter.executeOrder('buy', 'token-1', '0.61', '50');
      expect(deps.riskManager.canOpenPosition).toHaveBeenCalledWith(
        '10000',
        expect.arrayContaining([expect.objectContaining({ marketId: 'm1' })]),
        '50',
      );
    });
  });

  describe('trade persistence', () => {
    it('should insert trade to DB after execution', async () => {
      const deps = makeDeps();
      const adapter = buildPolymarketAdapter(deps);
      await adapter.executeOrder('buy', 'token-1', '0.61', '50');
      expect(deps.db.insertTrade).toHaveBeenCalledTimes(1);
    });
  });
});
