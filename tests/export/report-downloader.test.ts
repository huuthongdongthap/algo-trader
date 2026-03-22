import { describe, it, expect } from 'vitest';
import {
  generateTradeReport,
  generatePnlReport,
  generatePortfolioReport,
  type DownloadableReport,
  type PortfolioSummary,
} from '../../src/export/report-downloader.js';
import type { TradeResult, PnlSnapshot } from '../../src/core/types.js';

describe('generateTradeReport', () => {
  it('should generate CSV trade report', () => {
    const trades: TradeResult[] = [
      {
        orderId: 'ord1',
        marketId: 'BTC/USDT',
        side: 'buy',
        fillPrice: '50000',
        fillSize: '0.1',
        fees: '5.25',
        timestamp: Date.now(),
        strategy: 'test',
      },
    ];
    const report = generateTradeReport(trades, 'csv');
    expect(report.filename).toMatch(/^trades-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(report.contentType).toBe('text/csv');
    expect(report.data).toContain('Date,Strategy,Side');
    expect(report.data).toContain('BTC/USDT');
  });

  it('should generate JSON trade report', () => {
    const trades: TradeResult[] = [
      {
        orderId: 'ord1',
        marketId: 'ETH/USDT',
        side: 'sell',
        fillPrice: '3000',
        fillSize: '1',
        fees: '10',
        timestamp: Date.now(),
        strategy: 'arb',
      },
    ];
    const report = generateTradeReport(trades, 'json');
    expect(report.filename).toMatch(/^trades-\d{4}-\d{2}-\d{2}\.json$/);
    expect(report.contentType).toBe('application/json');
    const parsed = JSON.parse(report.data);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].marketId).toBe('ETH/USDT');
  });

  it('should generate TSV trade report', () => {
    const trades: TradeResult[] = [
      {
        orderId: 'ord1',
        marketId: 'SOL/USDT',
        side: 'buy',
        fillPrice: '200',
        fillSize: '5',
        fees: '2.5',
        timestamp: Date.now(),
        strategy: 'grid',
      },
    ];
    const report = generateTradeReport(trades, 'tsv');
    expect(report.filename).toMatch(/^trades-\d{4}-\d{2}-\d{2}\.tsv$/);
    expect(report.contentType).toBe('text/tab-separated-values');
    expect(report.data).toContain('Date\tStrategy\tSide');
  });

  it('should handle empty trades array', () => {
    const report = generateTradeReport([], 'csv');
    expect(report.data).toContain('Date,Strategy,Side');
    expect(report.data.split('\n').length).toBe(1); // header only
  });
});

describe('generatePnlReport', () => {
  it('should generate CSV P&L report', () => {
    const snapshots: PnlSnapshot[] = [
      {
        timestamp: Date.now(),
        equity: '10000',
        peakEquity: '10500',
        drawdown: 0.05,
        realizedPnl: '500',
        unrealizedPnl: '-100',
        tradeCount: 5,
        winCount: 3,
      },
    ];
    const report = generatePnlReport(snapshots, 'csv');
    expect(report.filename).toMatch(/^pnl-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(report.contentType).toBe('text/csv');
    expect(report.data).toContain('Date,Equity,PeakEquity');
  });

  it('should generate JSON P&L report', () => {
    const snapshots: PnlSnapshot[] = [
      {
        timestamp: Date.now(),
        equity: '50000',
        peakEquity: '52000',
        drawdown: 0.04,
        realizedPnl: '1000',
        unrealizedPnl: '500',
        tradeCount: 10,
        winCount: 7,
      },
    ];
    const report = generatePnlReport(snapshots, 'json');
    expect(report.filename).toMatch(/^pnl-\d{4}-\d{2}-\d{2}\.json$/);
    expect(report.contentType).toBe('application/json');
    const parsed = JSON.parse(report.data);
    expect(Array.isArray(parsed)).toBe(true);
  });

  it('should include CSV header for P&L report', () => {
    const snapshots: PnlSnapshot[] = [];
    const report = generatePnlReport(snapshots, 'csv');
    expect(report.data).toContain('Date,Equity,PeakEquity');
  });
});

describe('generatePortfolioReport', () => {
  it('should generate CSV portfolio report', () => {
    const summary: PortfolioSummary = {
      totalEquity: '100000',
      totalUnrealizedPnl: '5000',
      openPositions: 3,
      strategies: [
        { name: 'market_maker', allocation: '40%', tradeCount: 25 },
        { name: 'arbitrage', allocation: '60%', tradeCount: 15 },
      ],
    };
    const report = generatePortfolioReport(summary, 'csv');
    expect(report.filename).toMatch(/^portfolio-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(report.contentType).toBe('text/csv');
    expect(report.data).toContain('Strategy,Allocation,TradeCount');
    expect(report.data).toContain('market_maker,40%,25');
  });

  it('should generate JSON portfolio report', () => {
    const summary: PortfolioSummary = {
      totalEquity: '50000',
      totalUnrealizedPnl: '2000',
      openPositions: 2,
      strategies: [
        { name: 'grid_trading', allocation: '100%', tradeCount: 50 },
      ],
    };
    const report = generatePortfolioReport(summary, 'json');
    expect(report.filename).toMatch(/^portfolio-\d{4}-\d{2}-\d{2}\.json$/);
    expect(report.contentType).toBe('application/json');
    const parsed = JSON.parse(report.data);
    expect(parsed.totalEquity).toBe('50000');
    expect(parsed.strategies[0].name).toBe('grid_trading');
  });

  it('should include metadata in CSV portfolio report', () => {
    const summary: PortfolioSummary = {
      totalEquity: '100000',
      totalUnrealizedPnl: '0',
      openPositions: 0,
      strategies: [],
    };
    const report = generatePortfolioReport(summary, 'csv');
    expect(report.data).toContain('# TotalEquity: 100000');
    expect(report.data).toContain('# UnrealizedPnL: 0');
    expect(report.data).toContain('# OpenPositions: 0');
  });

  it('should handle empty strategy list', () => {
    const summary: PortfolioSummary = {
      totalEquity: '10000',
      totalUnrealizedPnl: '100',
      openPositions: 0,
      strategies: [],
    };
    const report = generatePortfolioReport(summary, 'csv');
    expect(report.data).toBeTruthy();
    expect(report.filename).toMatch(/^portfolio-/);
  });
});
