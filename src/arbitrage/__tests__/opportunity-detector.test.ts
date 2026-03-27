/**
 * OpportunityDetector Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OpportunityDetector } from '../opportunity-detector';
import { PricePoint } from '../types';

describe('OpportunityDetector', () => {
  let detector: OpportunityDetector;

  beforeEach(() => {
    detector = new OpportunityDetector({
      minProfitThreshold: 0.5,
      maxSlippageTolerance: 0.3,
      supportedTypes: ['triangular', 'dex-cex', 'cross-exchange'],
    });
  });

  it('should initialize with config', () => {
    expect(detector).toBeDefined();
  });

  it('should detect triangular arbitrage with sufficient profit', () => {
    const mockPrices: PricePoint[] = [
      { exchange: 'binance', symbol: 'BTC/USDT', bid: 50000, ask: 49900, timestamp: Date.now() },
      { exchange: 'binance', symbol: 'ETH/BTC', bid: 0.05, ask: 0.049, timestamp: Date.now() },
      { exchange: 'binance', symbol: 'ETH/USDT', bid: 2500, ask: 2490, timestamp: Date.now() },
    ];

    const opportunity = detector.detectTriangularArbitrage(mockPrices);
    expect(opportunity).toBeDefined();
    expect(opportunity?.type).toBe('triangular');
  });

  it('should return null for triangular arb below threshold', () => {
    const mockPrices: PricePoint[] = [
      { exchange: 'binance', symbol: 'BTC/USDT', bid: 50000, ask: 49999, timestamp: Date.now() },
      { exchange: 'binance', symbol: 'ETH/BTC', bid: 0.05, ask: 0.0499, timestamp: Date.now() },
      { exchange: 'binance', symbol: 'ETH/USDT', bid: 2500, ask: 2499, timestamp: Date.now() },
    ];

    const opportunity = detector.detectTriangularArbitrage(mockPrices);
    expect(opportunity).toBeNull();
  });

  it('should detect DEX-CEX arbitrage opportunities', () => {
    const dexPrices: PricePoint[] = [
      { exchange: 'uniswap', symbol: 'BTC/USDT', bid: 51000, ask: 50900, timestamp: Date.now() },
    ];
    const cexPrices: PricePoint[] = [
      { exchange: 'binance', symbol: 'BTC/USDT', bid: 50000, ask: 49900, timestamp: Date.now() },
    ];

    const opportunities = detector.detectDexCexArbitrage(dexPrices, cexPrices);
    expect(Array.isArray(opportunities)).toBe(true);
  });

  it('should detect funding rate arbitrage', () => {
    const prices: PricePoint[] = [
      { exchange: 'binance', symbol: 'BTC/USDT', bid: 50000, ask: 49900, timestamp: Date.now() },
    ];
    const fundingRates: Record<string, number> = { 'BTC/USDT': 0.02 };

    const opportunity = detector.detectFundingRateArbitrage(prices, fundingRates);
    expect(opportunity).toBeDefined();
    expect(opportunity?.type).toBe('funding-rate');
  });
});
