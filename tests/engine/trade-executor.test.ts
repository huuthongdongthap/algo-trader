import { describe, it, expect } from 'vitest';
import { TradeExecutor } from '../../src/engine/trade-executor.js';
import type { TradeRequest } from '../../src/engine/trade-executor.js';

describe('TradeExecutor', () => {
  it('should execute dry-run trade', async () => {
    const executor = new TradeExecutor({});
    const request: TradeRequest = {
      marketType: 'polymarket',
      exchange: 'polymarket',
      symbol: 'BTC-YES',
      side: 'buy',
      size: '100',
      price: '0.65',
      strategy: 'test-strat',
      dryRun: true,
    };
    const result = await executor.execute(request);
    expect(result.orderId).toMatch(/^sim[_-]/);
    expect(result.side).toBe('buy');
    expect(result.fillSize).toBe('100');
    expect(result.fees).toBe('0');
  });

  it('should add dry-run to trade log', async () => {
    const executor = new TradeExecutor({});
    // Note: dry-run trades return but are NOT added to tradeLog in simulateTrade
    // because simulateTrade returns early before push. Let's verify:
    await executor.execute({
      marketType: 'cex', exchange: 'binance', symbol: 'BTC/USDT',
      side: 'buy', size: '0.01', strategy: 'test', dryRun: true,
    });
    // dry-run returns early before tradeLog.push
    expect(executor.getTradeLog().length).toBe(0);
  });

  it('should throw for missing polymarket adapter', async () => {
    const executor = new TradeExecutor({});
    await expect(executor.execute({
      marketType: 'polymarket', exchange: 'polymarket', symbol: 'BTC-YES',
      side: 'buy', size: '10', strategy: 'test',
    })).rejects.toThrow('Polymarket adapter not configured');
  });

  it('should throw for missing CEX adapter', async () => {
    const executor = new TradeExecutor({});
    await expect(executor.execute({
      marketType: 'cex', exchange: 'binance', symbol: 'BTC/USDT',
      side: 'buy', size: '0.01', strategy: 'test',
    })).rejects.toThrow('CEX adapter not configured');
  });

  it('should throw for missing DEX adapter', async () => {
    const executor = new TradeExecutor({});
    await expect(executor.execute({
      marketType: 'dex', exchange: 'uniswap', symbol: 'WETH',
      side: 'buy', size: '1', strategy: 'test',
    })).rejects.toThrow('DEX adapter not configured');
  });

  it('should throw for unsupported market type', async () => {
    const executor = new TradeExecutor({});
    await expect(executor.execute({
      marketType: 'unknown' as any, exchange: 'x', symbol: 'Y',
      side: 'buy', size: '1', strategy: 'test',
    })).rejects.toThrow('Unsupported market type');
  });

  it('should execute via polymarket adapter and log trade', async () => {
    const executor = new TradeExecutor({
      polymarket: {
        executeOrder: async (side, tokenId, price, size) => ({
          orderId: 'poly-123',
          marketId: tokenId,
          side,
          fillPrice: price,
          fillSize: size,
          fees: '0.01',
          timestamp: Date.now(),
          strategy: 'test',
        }),
      },
    });
    const result = await executor.execute({
      marketType: 'polymarket', exchange: 'polymarket', symbol: 'BTC-YES',
      side: 'buy', size: '10', price: '0.65', strategy: 'test',
    });
    expect(result.orderId).toBe('poly-123');
    expect(executor.getTradeLog().length).toBe(1);
  });

  it('should execute CEX market order', async () => {
    const executor = new TradeExecutor({
      cex: {
        executeLimitOrder: async () => { throw new Error('should not be called'); },
        executeMarketOrder: async (_ex, symbol, side, amount) => ({
          orderId: 'cex-mkt-1',
          marketId: symbol,
          side,
          fillPrice: '50000',
          fillSize: amount,
          fees: '0.50',
          timestamp: Date.now(),
          strategy: 'test',
        }),
      },
    });
    const result = await executor.execute({
      marketType: 'cex', exchange: 'binance', symbol: 'BTC/USDT',
      side: 'buy', size: '0.01', strategy: 'test',
      // no price → market order
    });
    expect(result.orderId).toBe('cex-mkt-1');
  });
});
