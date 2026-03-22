import { describe, it, expect } from 'vitest';
import { SimulatedExchange, runBacktest } from '../../src/backtest/simulator.js';
import type { BacktestConfig, BacktestStrategy } from '../../src/backtest/simulator.js';
import type { HistoricalCandle } from '../../src/backtest/data-loader.js';

function makeCandle(close: number, idx: number): HistoricalCandle {
  return {
    timestamp: Date.now() + idx * 60_000,
    open: close * 0.99,
    high: close * 1.01,
    low: close * 0.98,
    close,
    volume: 1000,
  };
}

const baseConfig: BacktestConfig = {
  initialCapital: 10_000,
  slippage: 0,
  feeRate: 0,
  strategy: 'test-strategy',
};

describe('SimulatedExchange', () => {
  it('should start with initial capital', () => {
    const exchange = new SimulatedExchange(baseConfig);
    exchange.setCandle(makeCandle(100, 0));
    expect(exchange.getEquity()).toBe(10_000);
  });

  it('should throw if no candle set', () => {
    const exchange = new SimulatedExchange(baseConfig);
    expect(() => exchange.getState()).toThrow('No active candle');
  });

  it('should execute a buy trade', () => {
    const exchange = new SimulatedExchange(baseConfig);
    exchange.setCandle(makeCandle(100, 0));
    const result = exchange.simulateTrade({ symbol: 'BTC', side: 'buy', size: '10' });
    expect(result).not.toBeNull();
    expect(result!.side).toBe('buy');
    expect(parseFloat(result!.fillSize)).toBe(10);
    const state = exchange.getState();
    expect(state.position).toBe(10);
  });

  it('should execute a sell trade closing position', () => {
    const exchange = new SimulatedExchange(baseConfig);
    exchange.setCandle(makeCandle(100, 0));
    exchange.simulateTrade({ symbol: 'BTC', side: 'buy', size: '10' });
    exchange.setCandle(makeCandle(110, 1));
    const result = exchange.simulateTrade({ symbol: 'BTC', side: 'sell', size: '10' });
    expect(result).not.toBeNull();
    const state = exchange.getState();
    expect(state.position).toBe(0);
  });

  it('should apply slippage', () => {
    const config = { ...baseConfig, slippage: 0.01 }; // 1%
    const exchange = new SimulatedExchange(config);
    exchange.setCandle(makeCandle(100, 0));
    const result = exchange.simulateTrade({ symbol: 'BTC', side: 'buy', size: '1' });
    // Buy slippage: close * (1 + 0.01) = 101
    expect(parseFloat(result!.fillPrice)).toBeCloseTo(101, 2);
  });

  it('should apply fees', () => {
    const config = { ...baseConfig, feeRate: 0.001 }; // 0.1%
    const exchange = new SimulatedExchange(config);
    exchange.setCandle(makeCandle(100, 0));
    const result = exchange.simulateTrade({ symbol: 'BTC', side: 'buy', size: '10' });
    expect(parseFloat(result!.fees)).toBeCloseTo(1, 2); // 100*10*0.001
  });

  it('should build equity curve', () => {
    const exchange = new SimulatedExchange(baseConfig);
    exchange.setCandle(makeCandle(100, 0));
    exchange.setCandle(makeCandle(105, 1));
    exchange.setCandle(makeCandle(110, 2));
    const curve = exchange.getEquityCurve();
    expect(curve.length).toBe(3);
  });

  it('should compute equity with open position', () => {
    const exchange = new SimulatedExchange(baseConfig);
    exchange.setCandle(makeCandle(100, 0));
    exchange.simulateTrade({ symbol: 'BTC', side: 'buy', size: '10' });
    exchange.setCandle(makeCandle(110, 1));
    // Balance = 10000 - 1000 (cost) = 9000, unrealized PnL = (110-100)*10 = 100
    expect(exchange.getEquity()).toBe(9000 + (110 - 100) * 10);
  });
});

describe('runBacktest', () => {
  it('should run a simple buy-and-hold strategy', async () => {
    const candles = Array.from({ length: 20 }, (_, i) => makeCandle(100 + i, i));

    const strategy: BacktestStrategy = {
      onCandle: (candle, state) => {
        if (state.position === 0) return { symbol: 'BTC', side: 'buy', size: '10' };
        return null;
      },
    };

    const result = await runBacktest(strategy, candles, baseConfig);
    expect(result.tradeCount).toBe(1);
    expect(result.initialCapital).toBe(10_000);
    expect(result.equityCurve.length).toBe(20);
    // Buy costs balance, but unrealized PnL should be positive on rising prices
    expect(result.totalReturn).not.toBe(0);
    expect(result.tradeCount).toBe(1);
  });

  it('should return 0 trades for no-op strategy', async () => {
    const candles = Array.from({ length: 10 }, (_, i) => makeCandle(100, i));
    const strategy: BacktestStrategy = { onCandle: () => null };
    const result = await runBacktest(strategy, candles, baseConfig);
    expect(result.tradeCount).toBe(0);
    expect(result.totalReturn).toBe(0);
    expect(result.winRate).toBe(0);
  });

  it('should compute profit factor correctly', async () => {
    const prices = [100, 110, 105, 115, 108]; // alternating
    const candles = prices.map((p, i) => makeCandle(p, i));

    // Buy-sell every other candle
    let tradeNum = 0;
    const strategy: BacktestStrategy = {
      onCandle: (_candle, state) => {
        tradeNum++;
        if (tradeNum % 2 === 1 && state.position === 0) return { symbol: 'BTC', side: 'buy', size: '1' };
        if (tradeNum % 2 === 0 && state.position > 0) return { symbol: 'BTC', side: 'sell', size: '1' };
        return null;
      },
    };

    const result = await runBacktest(strategy, candles, baseConfig);
    expect(result.tradeCount).toBeGreaterThan(0);
    expect(result.profitFactor).toBeGreaterThanOrEqual(0);
  });
});
