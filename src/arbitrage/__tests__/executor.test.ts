/**
 * ExecutionEngine Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ExecutionEngine } from '../executor';
import { ArbitrageOpportunity } from '../types';

describe('ExecutionEngine', () => {
  let engine: ExecutionEngine;

  beforeEach(() => {
    engine = new ExecutionEngine({
      dryRun: true,
      maxPositionSize: 1000,
      slippageTolerance: 0.5,
      timeoutMs: 5000,
    });
  });

  it('should initialize with config', () => {
    expect(engine).toBeDefined();
  });

  it('should simulate execution in dry run mode', async () => {
    const mockOpportunity: ArbitrageOpportunity = {
      id: 'test_opp_1',
      type: 'cross-exchange',
      legs: [
        { exchange: 'binance', symbol: 'BTC/USDT', side: 'buy', price: 50000, amount: 1000, fee: 1 },
        { exchange: 'coinbase', symbol: 'BTC/USDT', side: 'sell', price: 50500, amount: 1000, fee: 5 },
      ],
      expectedProfit: 494,
      expectedProfitPct: 0.988,
      totalFees: 6,
      confidence: 85,
      detectedAt: Date.now(),
      expiresAt: Date.now() + 5000,
    };

    const result = await engine.execute(mockOpportunity);
    expect(result.success).toBe(true);
    expect(result.executedLegs.length).toBe(2);
    expect(result.actualProfit).toBe(494);
  });

  it('should validate opportunity correctly', () => {
    const validOpportunity: ArbitrageOpportunity = {
      id: 'test_opp_2',
      type: 'triangular',
      legs: [
        { exchange: 'binance', symbol: 'BTC/USDT', side: 'buy', price: 50000, amount: 1000, fee: 1 },
      ],
      expectedProfit: 10,
      expectedProfitPct: 1,
      totalFees: 1,
      confidence: 80,
      detectedAt: Date.now(),
      expiresAt: Date.now() + 5000,
    };

    expect(engine.validateOpportunity(validOpportunity)).toBe(true);
  });

  it('should reject opportunity with empty legs', () => {
    const invalidOpportunity: ArbitrageOpportunity = {
      id: 'test_opp_3',
      type: 'triangular',
      legs: [],
      expectedProfit: 10,
      expectedProfitPct: 1,
      totalFees: 0,
      confidence: 80,
      detectedAt: Date.now(),
      expiresAt: Date.now() + 5000,
    };

    expect(engine.validateOpportunity(invalidOpportunity)).toBe(false);
  });

  it('should calculate slippage based on position size', () => {
    const leg = { exchange: 'binance', symbol: 'BTC/USDT', side: 'buy', price: 50000, amount: 1000, fee: 1 };
    const slippage = (engine as any).calculateSlippage(leg);
    expect(slippage).toBeGreaterThan(0);
  });
});
