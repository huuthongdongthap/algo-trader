import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrderManager } from '../../src/polymarket/order-manager.js';
import type { ClobClient, OrderArgs } from '../../src/polymarket/clob-client.js';
import type { Order } from '../../src/core/types.js';

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'order-1',
    marketId: 'market-1',
    side: 'buy',
    price: '0.60',
    size: '100',
    status: 'open',
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeMockClient(): ClobClient {
  return {
    isPaperMode: false,
    postOrder: vi.fn().mockResolvedValue(makeOrder()),
    cancelOrder: vi.fn().mockResolvedValue(true),
    getPrice: vi.fn().mockResolvedValue({ mid: '0.60', bid: '0.59', ask: '0.61' }),
    getOrderBook: vi.fn().mockResolvedValue({ bids: [], asks: [], market: '', asset_id: '', hash: '' }),
    getMarkets: vi.fn().mockResolvedValue([]),
  } as unknown as ClobClient;
}

describe('OrderManager', () => {
  let client: ClobClient;
  let manager: OrderManager;

  beforeEach(() => {
    client = makeMockClient();
    manager = new OrderManager(client);
  });

  describe('placeOrder', () => {
    it('should place and track order', async () => {
      const record = await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      expect(record.id).toBe('order-1');
      expect(record.filledSize).toBe('0');
      expect(manager.getAllOrders()).toHaveLength(1);
    });

    it('should call client.postOrder', async () => {
      const args: OrderArgs = { tokenId: 't', price: '0.5', size: '50', side: 'sell' };
      await manager.placeOrder(args);
      expect(client.postOrder).toHaveBeenCalledWith(args);
    });
  });

  describe('cancelOrder', () => {
    it('should cancel tracked order', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      const result = await manager.cancelOrder('order-1');
      expect(result).toBe(true);
      expect(client.cancelOrder).toHaveBeenCalledWith('order-1');
    });

    it('should return false for unknown order', async () => {
      const result = await manager.cancelOrder('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false for already cancelled order', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('order-1', 'cancelled');
      const result = await manager.cancelOrder('order-1');
      expect(result).toBe(false);
    });

    it('should return false for filled order', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('order-1', 'filled', '100');
      const result = await manager.cancelOrder('order-1');
      expect(result).toBe(false);
    });
  });

  describe('cancelAllForMarket', () => {
    it('should cancel all open orders for market', async () => {
      (client.postOrder as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeOrder({ id: 'o1', marketId: 'm1' }))
        .mockResolvedValueOnce(makeOrder({ id: 'o2', marketId: 'm1' }))
        .mockResolvedValueOnce(makeOrder({ id: 'o3', marketId: 'm2' }));
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      const cancelled = await manager.cancelAllForMarket('m1');
      expect(cancelled).toBe(2);
    });
  });

  describe('updateStatus', () => {
    it('should update order status', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('order-1', 'filled', '100');
      const orders = manager.getAllOrders();
      expect(orders[0].status).toBe('filled');
      expect(orders[0].filledSize).toBe('100');
    });

    it('should ignore unknown order', () => {
      expect(() => manager.updateStatus('nope', 'filled')).not.toThrow();
    });
  });

  describe('getOpenOrders', () => {
    it('should return only open/pending orders', async () => {
      (client.postOrder as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeOrder({ id: 'o1', status: 'open' }))
        .mockResolvedValueOnce(makeOrder({ id: 'o2', status: 'pending' }));
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('o1', 'filled', '100');
      expect(manager.getOpenOrders()).toHaveLength(1);
      expect(manager.getOpenOrders()[0].id).toBe('o2');
    });
  });

  describe('getOrdersForMarket', () => {
    it('should filter by market', async () => {
      (client.postOrder as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeOrder({ id: 'o1', marketId: 'A' }))
        .mockResolvedValueOnce(makeOrder({ id: 'o2', marketId: 'B' }));
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      expect(manager.getOrdersForMarket('A')).toHaveLength(1);
    });
  });

  describe('pruneClosedOrders', () => {
    it('should remove old closed orders', async () => {
      (client.postOrder as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(makeOrder({ id: 'old', status: 'filled', createdAt: Date.now() - 2 * 3600_000 }));
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('old', 'filled', '100');
      manager.pruneClosedOrders(3600_000);
      expect(manager.getAllOrders()).toHaveLength(0);
    });

    it('should keep recent closed orders', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('order-1', 'filled', '100');
      manager.pruneClosedOrders(3600_000);
      expect(manager.getAllOrders()).toHaveLength(1);
    });
  });

  describe('position tracking', () => {
    it('should track position after fill', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('order-1', 'filled', '100');
      const pos = manager.getPosition('market-1');
      expect(pos).toBeDefined();
      expect(pos!.totalSize).toBeGreaterThan(0);
    });

    it('should compute pnl', async () => {
      await manager.placeOrder({ tokenId: 't', price: '0.6', size: '100', side: 'buy' });
      manager.updateStatus('order-1', 'filled', '100');
      const pnl = manager.computePnl('market-1', 0.7);
      expect(pnl).not.toBeNull();
      expect(pnl!.unrealizedPnl).toBeGreaterThan(0);
    });
  });
});
