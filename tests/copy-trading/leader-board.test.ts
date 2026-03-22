import { describe, it, expect } from 'vitest';
import { LeaderBoard } from '../../src/copy-trading/leader-board.js';
import type { TradeResult } from '../../src/core/types.js';

function makeTradeResult(): TradeResult {
  return {
    orderId: 'o-1',
    marketId: 'BTC-USDC',
    side: 'buy',
    fillPrice: '50000',
    fillSize: '0.1',
    fees: '5',
    timestamp: Date.now(),
    strategy: 'grid-trading',
  };
}

describe('LeaderBoard', () => {
  it('should register trader', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Trader Alpha');
    const profile = lb.getTraderProfile('u-1');
    expect(profile).not.toBeNull();
    expect(profile!.displayName).toBe('Trader Alpha');
    expect(profile!.tradeCount).toBe(0);
  });

  it('should be idempotent on duplicate register', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Original');
    lb.registerTrader('u-1', 'Overwrite');
    expect(lb.getTraderProfile('u-1')!.displayName).toBe('Original');
  });

  it('should update stats with winning trade', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Alpha');
    lb.updateStats('u-1', makeTradeResult(), 0.05); // +5%
    const profile = lb.getTraderProfile('u-1')!;
    expect(profile.tradeCount).toBe(1);
    expect(profile.winRate).toBe(1);
    expect(profile.totalReturn).toBeCloseTo(0.05);
  });

  it('should update stats with losing trade', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Beta');
    lb.updateStats('u-1', makeTradeResult(), -0.03); // -3%
    const profile = lb.getTraderProfile('u-1')!;
    expect(profile.winRate).toBe(0);
    expect(profile.totalReturn).toBeCloseTo(-0.03);
  });

  it('should compute drawdown from peak', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Gamma');
    lb.updateStats('u-1', makeTradeResult(), 0.10); // +10%
    lb.updateStats('u-1', makeTradeResult(), -0.05); // -5%
    const profile = lb.getTraderProfile('u-1')!;
    expect(profile.maxDrawdown).toBeGreaterThan(0);
  });

  it('should rank by composite score', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Good');
    lb.registerTrader('u-2', 'Better');
    lb.updateStats('u-1', makeTradeResult(), 0.02);
    lb.updateStats('u-2', makeTradeResult(), 0.10);
    lb.updateStats('u-2', makeTradeResult(), 0.08);

    const top = lb.getTopTraders(10);
    expect(top[0].userId).toBe('u-2');
    expect(top[0].score).toBeGreaterThan(top[1].score);
  });

  it('should increment and decrement followers', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Alpha');
    lb.incrementFollowers('u-1');
    lb.incrementFollowers('u-1');
    expect(lb.getTraderProfile('u-1')!.followers).toBe(2);
    lb.decrementFollowers('u-1');
    expect(lb.getTraderProfile('u-1')!.followers).toBe(1);
  });

  it('should not decrement below 0', () => {
    const lb = new LeaderBoard();
    lb.registerTrader('u-1', 'Alpha');
    lb.decrementFollowers('u-1');
    expect(lb.getTraderProfile('u-1')!.followers).toBe(0);
  });

  it('should return null for unknown trader', () => {
    const lb = new LeaderBoard();
    expect(lb.getTraderProfile('unknown')).toBeNull();
  });

  it('should limit getTopTraders result', () => {
    const lb = new LeaderBoard();
    for (let i = 0; i < 5; i++) lb.registerTrader(`u-${i}`, `T${i}`);
    expect(lb.getTopTraders(3)).toHaveLength(3);
  });
});
