import { describe, it, expect, beforeEach } from 'vitest';
import { TradingEngine, Order } from './engine';

describe('TradingEngine', () => {
  let engine: TradingEngine;

  beforeEach(() => {
    engine = new TradingEngine();
  });

  it('should execute valid buy order', () => {
    const order: Order = {
      symbol: 'AAPL',
      quantity: 100,
      price: 150.00,
      side: 'buy',
      timestamp: new Date()
    };

    const result = engine.executeOrder(order);

    expect(result.success).toBe(true);
    expect(result.orderId).toMatch(/^ORD-\d+-[a-z0-9]+$/);
  });

  it('should execute valid sell order', () => {
    const order: Order = {
      symbol: 'GOOGL',
      quantity: 50,
      price: 2800.00,
      side: 'sell',
      timestamp: new Date()
    };

    const result = engine.executeOrder(order);

    expect(result.success).toBe(true);
  });

  it('should reject order with zero quantity', () => {
    const order: Order = {
      symbol: 'AAPL',
      quantity: 0,
      price: 150.00,
      side: 'buy',
      timestamp: new Date()
    };

    const result = engine.executeOrder(order);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Quantity must be positive');
  });

  it('should reject order with negative quantity', () => {
    const order: Order = {
      symbol: 'AAPL',
      quantity: -10,
      price: 150.00,
      side: 'buy',
      timestamp: new Date()
    };

    const result = engine.executeOrder(order);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Quantity must be positive');
  });

  it('should reject order with zero price', () => {
    const order: Order = {
      symbol: 'AAPL',
      quantity: 100,
      price: 0,
      side: 'buy',
      timestamp: new Date()
    };

    const result = engine.executeOrder(order);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Price must be positive');
  });

  it('should track executed orders', () => {
    const order1: Order = {
      symbol: 'AAPL',
      quantity: 100,
      price: 150.00,
      side: 'buy',
      timestamp: new Date()
    };

    const order2: Order = {
      symbol: 'GOOGL',
      quantity: 50,
      price: 2800.00,
      side: 'sell',
      timestamp: new Date()
    };

    engine.executeOrder(order1);
    engine.executeOrder(order2);

    const orders = engine.getOrders();
    expect(orders).toHaveLength(2);
    expect(orders[0].symbol).toBe('AAPL');
    expect(orders[1].symbol).toBe('GOOGL');
  });

  it('should clear orders', () => {
    const order: Order = {
      symbol: 'AAPL',
      quantity: 100,
      price: 150.00,
      side: 'buy',
      timestamp: new Date()
    };

    engine.executeOrder(order);
    engine.clearOrders();

    expect(engine.getOrders()).toHaveLength(0);
  });
});
