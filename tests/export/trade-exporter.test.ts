import { describe, it, expect } from 'vitest';
import {
  filterTradesByDateRange,
  filterTradesByStrategy,
  exportTradesToCsv,
  exportTradesToJson,
  exportTradesToTsv,
} from '../../src/export/trade-exporter.js';
import type { TradeResult } from '../../src/core/types.js';

function makeTrade(ts: number, strategy = 'grid-trading' as any): TradeResult {
  return {
    orderId: `o-${ts}`, marketId: 'BTC-USDC', side: 'buy',
    fillPrice: '50000', fillSize: '1', fees: '5', timestamp: ts, strategy,
  };
}

describe('filterTradesByDateRange', () => {
  const trades = [makeTrade(100), makeTrade(200), makeTrade(300), makeTrade(400)];

  it('should filter within range', () => {
    expect(filterTradesByDateRange(trades, 150, 350)).toHaveLength(2);
  });

  it('should include boundary values', () => {
    expect(filterTradesByDateRange(trades, 100, 400)).toHaveLength(4);
  });

  it('should return empty for out of range', () => {
    expect(filterTradesByDateRange(trades, 500, 600)).toHaveLength(0);
  });
});

describe('filterTradesByStrategy', () => {
  const trades = [
    makeTrade(1, 'grid-trading'),
    makeTrade(2, 'dca-bot'),
    makeTrade(3, 'grid-trading'),
  ];

  it('should filter by strategy', () => {
    expect(filterTradesByStrategy(trades, 'grid-trading')).toHaveLength(2);
    expect(filterTradesByStrategy(trades, 'dca-bot')).toHaveLength(1);
  });

  it('should return empty for unknown strategy', () => {
    expect(filterTradesByStrategy(trades, 'market-maker')).toHaveLength(0);
  });
});

describe('exportTradesToCsv', () => {
  it('should produce CSV with headers', () => {
    const csv = exportTradesToCsv([makeTrade(Date.now())]);
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Date');
    expect(lines[0]).toContain('Strategy');
    expect(lines).toHaveLength(2);
  });

  it('should produce header only for empty trades', () => {
    const csv = exportTradesToCsv([]);
    expect(csv.split('\n')).toHaveLength(1);
  });
});

describe('exportTradesToJson', () => {
  it('should produce valid JSON', () => {
    const json = exportTradesToJson([makeTrade(1000)]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('should pretty-print when requested', () => {
    const json = exportTradesToJson([makeTrade(1000)], true);
    expect(json).toContain('\n');
  });
});

describe('exportTradesToTsv', () => {
  it('should produce TSV with tabs', () => {
    const tsv = exportTradesToTsv([makeTrade(Date.now())]);
    expect(tsv).toContain('\t');
  });
});
