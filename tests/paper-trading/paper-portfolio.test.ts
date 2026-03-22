import { describe, it, expect } from 'vitest';
import { PaperPortfolio } from '../../src/paper-trading/paper-portfolio.js';
import type { TradeResult } from '../../src/core/types.js';

function makeBuyResult(price: string, size: string, fees = '5'): TradeResult {
  return {
    orderId: 'o-1', marketId: 'BTC-USDC', side: 'buy',
    fillPrice: price, fillSize: size, fees, timestamp: Date.now(), strategy: 'grid-trading',
  };
}

function makeSellResult(price: string, size: string, fees = '5'): TradeResult {
  return {
    orderId: 'o-2', marketId: 'BTC-USDC', side: 'sell',
    fillPrice: price, fillSize: size, fees, timestamp: Date.now(), strategy: 'grid-trading',
  };
}

describe('PaperPortfolio', () => {
  it('should initialize with USDC balance', () => {
    const p = new PaperPortfolio(10000);
    expect(p.getBalance('USDC')).toBe(10000);
  });

  it('should reject non-positive initial capital', () => {
    expect(() => new PaperPortfolio(0)).toThrow();
    expect(() => new PaperPortfolio(-100)).toThrow();
  });

  it('should deposit and withdraw', () => {
    const p = new PaperPortfolio(1000);
    p.deposit('BTC', 0.5);
    expect(p.getBalance('BTC')).toBe(0.5);
    p.withdraw('BTC', 0.2);
    expect(p.getBalance('BTC')).toBeCloseTo(0.3);
  });

  it('should throw on insufficient withdrawal', () => {
    const p = new PaperPortfolio(1000);
    expect(() => p.withdraw('BTC', 1)).toThrow('Insufficient');
  });

  it('should apply buy trade', () => {
    const p = new PaperPortfolio(100000);
    p.applyTrade(makeBuyResult('50000', '1', '50'));
    // Deducted 50000 + 50 fee = 49950 USDC remaining
    expect(p.getBalance('USDC')).toBe(49950);
    expect(p.getBalance('BTC')).toBe(1);
  });

  it('should apply sell trade with realized PnL', () => {
    const p = new PaperPortfolio(100000);
    p.applyTrade(makeBuyResult('50000', '1', '0'));
    p.applyTrade(makeSellResult('55000', '1', '0'));
    // Profit = (55000 - 50000) * 1 = 5000
    expect(p.getRealizedPnl()).toBeCloseTo(5000);
    expect(p.getBalance('BTC')).toBe(0);
  });

  it('should calculate equity with price map', () => {
    const p = new PaperPortfolio(100000);
    p.applyTrade(makeBuyResult('50000', '1', '0'));
    // USDC: 50000, BTC: 1 @ current 60000
    const equity = p.getEquity({ BTC: 60000 });
    expect(equity).toBe(110000);
  });

  it('should calculate unrealized PnL', () => {
    const p = new PaperPortfolio(100000);
    p.applyTrade(makeBuyResult('50000', '1', '0'));
    const unrealized = p.getUnrealizedPnl({ BTC: 55000 });
    expect(unrealized).toBe(5000);
  });

  it('should get snapshot', () => {
    const p = new PaperPortfolio(10000);
    const snap = p.getSnapshot();
    expect(snap.initialCapital).toBeDefined();
    expect(snap.realizedPnl).toBeDefined();
  });

  it('should reset portfolio', () => {
    const p = new PaperPortfolio(10000);
    p.deposit('BTC', 1);
    p.reset();
    expect(p.getBalance('USDC')).toBe(10000);
    expect(p.getBalance('BTC')).toBe(0);
    expect(p.getRealizedPnl()).toBe(0);
  });

  it('should return all non-zero balances', () => {
    const p = new PaperPortfolio(1000);
    p.deposit('ETH', 5);
    const all = p.getAllBalances();
    expect(all['USDC']).toBe(1000);
    expect(all['ETH']).toBe(5);
  });
});
