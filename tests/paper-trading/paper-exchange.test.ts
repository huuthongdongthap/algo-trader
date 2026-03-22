import { describe, it, expect, beforeEach } from 'vitest';
import { PaperExchange } from '../../src/paper-trading/paper-exchange.js';
import type { TradeRequest } from '../../src/engine/trade-executor.js';

function makeRequest(overrides: Partial<TradeRequest> = {}): TradeRequest {
  return {
    marketType: 'spot',
    exchange: 'binance',
    symbol: 'BTC-USD',
    side: 'buy',
    size: '1',
    price: '60000',
    strategy: 'test',
    dryRun: false,
    ...overrides,
  };
}

describe('PaperExchange', () => {
  let exchange: PaperExchange;

  beforeEach(() => {
    exchange = new PaperExchange();
  });

  describe('setPrice', () => {
    it('should store price', () => {
      exchange.setPrice('BTC-USD', 60000);
      expect(exchange.getPrice('BTC-USD')).toBe(60000);
    });

    it('should throw on invalid price', () => {
      expect(() => exchange.setPrice('BTC', 0)).toThrow('Invalid price');
      expect(() => exchange.setPrice('BTC', -100)).toThrow('Invalid price');
    });

    it('should update existing price', () => {
      exchange.setPrice('BTC-USD', 60000);
      exchange.setPrice('BTC-USD', 65000);
      expect(exchange.getPrice('BTC-USD')).toBe(65000);
    });
  });

  describe('submitOrder', () => {
    it('should fill order when price available', () => {
      exchange.setPrice('BTC-USD', 60000);
      const result = exchange.submitOrder(makeRequest());
      expect(result.orderId).toBeTruthy();
      expect(result.marketId).toBe('BTC-USD');
      expect(result.side).toBe('buy');
      expect(parseFloat(result.fillPrice)).toBeGreaterThan(0);
      expect(parseFloat(result.fillSize)).toBe(1);
      expect(result.strategy).toBe('test');
    });

    it('should apply slippage for buy (fill above market)', () => {
      exchange.setPrice('BTC-USD', 60000);
      const result = exchange.submitOrder(makeRequest({ side: 'buy' }));
      expect(parseFloat(result.fillPrice)).toBeGreaterThan(60000);
    });

    it('should apply slippage for sell (fill below market)', () => {
      exchange.setPrice('BTC-USD', 60000);
      const result = exchange.submitOrder(makeRequest({ side: 'sell' }));
      expect(parseFloat(result.fillPrice)).toBeLessThan(60000);
    });

    it('should queue order when no price available', () => {
      const result = exchange.submitOrder(makeRequest({ symbol: 'UNKNOWN' }));
      expect(parseFloat(result.fillPrice)).toBe(0);
      expect(exchange.getOpenOrders()).toHaveLength(1);
    });

    it('should charge fees', () => {
      exchange.setPrice('BTC-USD', 60000);
      const result = exchange.submitOrder(makeRequest());
      expect(parseFloat(result.fees)).toBeGreaterThan(0);
    });
  });

  describe('getOpenOrders', () => {
    it('should return pending orders', () => {
      exchange.submitOrder(makeRequest({ symbol: 'NO-PRICE' }));
      const open = exchange.getOpenOrders();
      expect(open).toHaveLength(1);
      expect(open[0].request.symbol).toBe('NO-PRICE');
    });

    it('should return copy (immutable)', () => {
      exchange.submitOrder(makeRequest({ symbol: 'NO-PRICE' }));
      const open = exchange.getOpenOrders();
      open.pop();
      expect(exchange.getOpenOrders()).toHaveLength(1);
    });
  });

  describe('cancelOrder', () => {
    it('should cancel pending order', () => {
      exchange.submitOrder(makeRequest({ symbol: 'NO-PRICE' }));
      const orderId = exchange.getOpenOrders()[0].id;
      expect(exchange.cancelOrder(orderId)).toBe(true);
      expect(exchange.getOpenOrders()).toHaveLength(0);
    });

    it('should return false for unknown order', () => {
      expect(exchange.cancelOrder('nonexistent')).toBe(false);
    });
  });

  describe('setPrice auto-fill', () => {
    it('should clear pending orders when price arrives', () => {
      exchange.submitOrder(makeRequest({ symbol: 'ETH-USD' }));
      expect(exchange.getOpenOrders()).toHaveLength(1);
      exchange.setPrice('ETH-USD', 3000);
      expect(exchange.getOpenOrders()).toHaveLength(0);
    });
  });
});
