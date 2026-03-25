import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OrderExecutor } from '../../src/cex/order-executor.js';
import { ExchangeClient, type ExchangeConfig } from '../../src/cex/exchange-client.js';

// Mock getTicker to avoid real network calls
vi.spyOn(ExchangeClient.prototype, 'getTicker').mockResolvedValue({
  symbol: 'BTC/USDT',
  bid: '49990',
  ask: '50010',
  last: '50000',
  volume: '1000',
  timestamp: Date.now(),
});

describe('OrderExecutor', () => {
  let client: ExchangeClient;
  let executor: OrderExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply mock after clearAllMocks
    vi.spyOn(ExchangeClient.prototype, 'getTicker').mockResolvedValue({
      symbol: 'BTC/USDT',
      bid: '49990',
      ask: '50010',
      last: '50000',
      volume: '1000',
      timestamp: Date.now(),
    });
    delete process.env['LIVE_TRADING'];
    client = new ExchangeClient();
    const config: ExchangeConfig = { apiKey: 'key', apiSecret: 'secret' };
    client.connect('binance', config);
    executor = new OrderExecutor(client);
  });

  describe('placeOrder paper mode', () => {
    it('should place market order in paper mode', async () => {
      const order = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        strategy: 'test',
      });
      expect(order.id).toBeTruthy();
      expect(order.side).toBe('buy');
      expect(order.status).toBe('filled');
      expect(order.paperFill).toBe(true);
    });

    it('should apply buy-side slippage (positive)', async () => {
      const order = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        price: 50000,
        strategy: 'test',
      });
      const fillPrice = parseFloat(order.price);
      expect(fillPrice).toBeGreaterThan(50000);
    });

    it('should apply sell-side slippage (negative)', async () => {
      const order = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'sell',
        amount: 0.1,
        price: 50000,
        strategy: 'test',
      });
      const fillPrice = parseFloat(order.price);
      expect(fillPrice).toBeLessThan(50000);
    });

    it('should use market type swap if provided', async () => {
      const order = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        price: 100,
        strategy: 'test',
        marketType: 'swap',
      });
      expect(order).toBeTruthy();
    });
  });

  describe('getOrder', () => {
    it('should retrieve tracked order by id', async () => {
      const placed = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'ETH/USDT',
        side: 'buy',
        amount: 1,
        price: 3000,
        strategy: 'test',
      });
      const tracked = executor.getOrder(placed.id);
      expect(tracked).toEqual(placed);
    });

    it('should return undefined for non-existent order', () => {
      const tracked = executor.getOrder('non-existent');
      expect(tracked).toBeUndefined();
    });
  });

  describe('listOrders', () => {
    it('should list all orders', async () => {
      await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        strategy: 'test',
      });
      await executor.placeOrder({
        exchange: 'binance',
        symbol: 'ETH/USDT',
        side: 'sell',
        amount: 1,
        strategy: 'test',
      });
      const orders = executor.listOrders();
      expect(orders.length).toBeGreaterThanOrEqual(2);
    });

    it('should filter orders by exchange', async () => {
      await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        strategy: 'test',
      });
      const orders = executor.listOrders('binance');
      expect(orders.length).toBeGreaterThan(0);
      expect(orders.every(o => o.exchange === 'binance')).toBe(true);
    });
  });

  describe('toTradeResult', () => {
    it('should convert order to trade result', async () => {
      const order = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        price: 50000,
        strategy: 'test',
      });
      const trade = executor.toTradeResult(order, '5.25');
      expect(trade.orderId).toBe(order.id);
      expect(trade.marketId).toBe(order.marketId);
      expect(trade.side).toBe('buy');
      expect(trade.fees).toBe('5.25');
    });
  });

  describe('cancelOrder', () => {
    it('should return false for paper orders', async () => {
      const order = await executor.placeOrder({
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy',
        amount: 0.1,
        strategy: 'test',
      });
      const cancelled = await executor.cancelOrder('binance', order.id, 'BTC/USDT');
      expect(cancelled).toBe(false);
    });
  });
});
