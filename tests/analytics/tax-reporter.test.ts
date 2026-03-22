import { describe, it, expect } from 'vitest';
import {
  calculateGainLoss,
  generateTaxReport,
  exportToCsv,
  getSummary,
} from '../../src/analytics/tax-reporter.js';
import type { TradeResult } from '../../src/core/types.js';

function makeTrade(side: 'buy' | 'sell', price: string, size: string, timestamp: number): TradeResult {
  return {
    orderId: `o-${timestamp}`, marketId: 'BTC-USDC', side,
    fillPrice: price, fillSize: size, fees: '10', timestamp, strategy: 'grid-trading',
  };
}

const JAN1 = new Date('2025-01-01').getTime();
const FEB1 = new Date('2025-02-01').getTime();
const MAR1 = new Date('2025-03-01').getTime();

describe('calculateGainLoss', () => {
  it('should return no events for only buys', () => {
    const events = calculateGainLoss([makeTrade('buy', '50000', '1', JAN1)]);
    expect(events).toHaveLength(0);
  });

  it('should compute gain on FIFO sell', () => {
    const trades = [
      makeTrade('buy', '40000', '1', JAN1),
      makeTrade('sell', '50000', '1', FEB1),
    ];
    const events = calculateGainLoss(trades);
    expect(events).toHaveLength(1);
    expect(events[0].gainLoss).toBeGreaterThan(0);
    expect(events[0].costBasis).toBe(40000);
    expect(events[0].holdingPeriod).toBe(31);
  });

  it('should compute loss on sell below cost', () => {
    const trades = [
      makeTrade('buy', '50000', '1', JAN1),
      makeTrade('sell', '40000', '1', FEB1),
    ];
    const events = calculateGainLoss(trades);
    expect(events[0].gainLoss).toBeLessThan(0);
  });

  it('should handle partial lot matching', () => {
    const trades = [
      makeTrade('buy', '40000', '2', JAN1),
      makeTrade('sell', '50000', '1', FEB1),
    ];
    const events = calculateGainLoss(trades);
    expect(events).toHaveLength(1);
    expect(events[0].quantity).toBe(1);
  });
});

describe('generateTaxReport', () => {
  it('should filter by year', () => {
    const trades = [
      makeTrade('buy', '40000', '1', JAN1),
      makeTrade('sell', '50000', '1', FEB1),
    ];
    const report2025 = generateTaxReport(trades, 2025);
    expect(report2025.length).toBeGreaterThan(0);
    const report2024 = generateTaxReport(trades, 2024);
    expect(report2024).toHaveLength(0);
  });
});

describe('exportToCsv', () => {
  it('should produce CSV with headers', () => {
    const trades = [
      makeTrade('buy', '40000', '1', JAN1),
      makeTrade('sell', '50000', '1', FEB1),
    ];
    const events = calculateGainLoss(trades);
    const csv = exportToCsv(events);
    expect(csv).toContain('Description');
    expect(csv).toContain('Gain or Loss');
    expect(csv.split('\n').length).toBe(2); // header + 1 row
  });
});

describe('getSummary', () => {
  it('should aggregate gains and losses', () => {
    const trades = [
      makeTrade('buy', '40000', '1', JAN1),
      makeTrade('sell', '50000', '1', FEB1),
      makeTrade('buy', '55000', '1', FEB1),
      makeTrade('sell', '45000', '1', MAR1),
    ];
    const events = calculateGainLoss(trades);
    const summary = getSummary(events);
    expect(summary.eventCount).toBe(2);
    expect(summary.totalGains).toBeGreaterThan(0);
    expect(summary.totalLosses).toBeLessThan(0);
    expect(summary.netGainLoss).toBe(summary.totalGains + summary.totalLosses);
  });

  it('should classify as short-term (< 365 days)', () => {
    const trades = [
      makeTrade('buy', '40000', '1', JAN1),
      makeTrade('sell', '50000', '1', FEB1),
    ];
    const events = calculateGainLoss(trades);
    const summary = getSummary(events);
    expect(summary.shortTermNet).not.toBe(0);
    expect(summary.longTermNet).toBe(0);
  });
});
