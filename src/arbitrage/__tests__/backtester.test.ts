/**
 * Backtester Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Backtester } from '../backtester';
import { PricePoint } from '../types';

describe('Backtester', () => {
  let backtester: Backtester;

  beforeEach(() => {
    backtester = new Backtester({
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-01-07'),
      initialCapital: 10000,
      exchanges: ['binance', 'coinbase'],
      symbols: ['BTC/USDT'],
      minProfitThreshold: 0.5,
      maxPositionSize: 1000,
    });
  });

  it('should initialize with config', () => {
    expect(backtester).toBeDefined();
  });

  it('should run backtest with historical data', async () => {
    const mockData: PricePoint[][] = [
      [
        { exchange: 'binance', symbol: 'BTC/USDT', bid: 50000, ask: 49900, timestamp: Date.now() },
        { exchange: 'binance', symbol: 'ETH/BTC', bid: 0.05, ask: 0.049, timestamp: Date.now() },
        { exchange: 'binance', symbol: 'ETH/USDT', bid: 2500, ask: 2490, timestamp: Date.now() },
      ],
      [
        { exchange: 'binance', symbol: 'BTC/USDT', bid: 50100, ask: 50000, timestamp: Date.now() },
      ],
    ];

    const result = await backtester.run(mockData);
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(typeof result.netProfit).toBe('number');
    expect(typeof result.sharpeRatio).toBe('number');
  });

  it('should calculate Sharpe ratio', () => {
    const opportunities = [
      { timestamp: Date.now(), type: 'triangular', expectedProfit: 10, executed: true },
      { timestamp: Date.now(), type: 'triangular', expectedProfit: 15, executed: true },
      { timestamp: Date.now(), type: 'triangular', expectedProfit: -5, executed: true },
    ];

    const sharpe = (backtester as any).calculateSharpeRatio(opportunities);
    expect(typeof sharpe).toBe('number');
  });

  it('should calculate max drawdown', () => {
    const opportunities = [
      { timestamp: Date.now(), type: 'triangular', expectedProfit: 100, executed: true },
      { timestamp: Date.now(), type: 'triangular', expectedProfit: -50, executed: true },
      { timestamp: Date.now(), type: 'triangular', expectedProfit: 200, executed: true },
    ];

    const drawdown = (backtester as any).calculateMaxDrawdown(opportunities);
    expect(drawdown).toBeGreaterThanOrEqual(0);
  });

  it('should return optimization parameters', () => {
    const optimization = backtester.optimize();
    expect(optimization).toHaveProperty('minProfitThreshold');
    expect(optimization).toHaveProperty('maxPositionSize');
  });

  it('should handle empty historical data', async () => {
    const result = await backtester.run([]);
    expect(result.totalTrades).toBe(0);
    expect(result.netProfit).toBe(0);
  });
});
