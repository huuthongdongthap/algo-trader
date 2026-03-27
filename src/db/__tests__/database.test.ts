/**
 * Database Module Tests
 */

import { describe, it, expect, vi } from 'vitest';

const mockQuery = vi.fn();
const mockTransaction = vi.fn();

vi.mock('../postgres-client', () => ({
  query: mockQuery.mockResolvedValue({ rows: [] }),
  transaction: mockTransaction,
  getDbClient: () => ({}),
  closeDbConnection: vi.fn(),
}));

describe('TradeRepository', () => {
  it('should be constructable', async () => {
    const { TradeRepository } = await import('../trade-repository');
    const repo = new TradeRepository();
    expect(repo).toBeDefined();
    expect(typeof repo.insert).toBe('function');
    expect(typeof repo.getById).toBe('function');
    expect(typeof repo.getRecent).toBe('function');
  });

  it('should insert trade', async () => {
    const { TradeRepository } = await import('../trade-repository');
    const repo = new TradeRepository();

    const opportunity = {
      id: 'opp-1',
      symbol: 'BTC/USDT',
      buyExchange: 'binance',
      sellExchange: 'okx',
      buyPrice: 50000,
      sellPrice: 50500,
      spread: 500,
      spreadPercent: 1.0,
      timestamp: Date.now(),
      latency: 50,
    };

    const execution = {
      id: 'exec-1',
      opportunityId: opportunity.id,
      status: 'FILLED' as const,
      profit: 4.95,
      timestamp: Date.now(),
      buyOrder: {
        orderId: 'order-1',
        exchange: 'binance',
        symbol: 'BTC/USDT',
        side: 'buy' as const,
        price: 50000,
        amount: 0.01,
        filled: 0.01,
        remaining: 0,
        status: 'closed' as const,
        fee: 0.5,
      },
      sellOrder: {
        orderId: 'order-2',
        exchange: 'okx',
        symbol: 'BTC/USDT',
        side: 'sell' as const,
        price: 50500,
        amount: 0.01,
        filled: 0.01,
        remaining: 0,
        status: 'closed' as const,
        fee: 0.505,
      },
    };

    await repo.insert(opportunity, execution);
    expect(mockQuery).toHaveBeenCalled();
  });

  it('should get trade by ID', async () => {
    const { TradeRepository } = await import('../trade-repository');
    const repo = new TradeRepository();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'trade-1',
          symbol: 'BTC/USDT',
          profit: 5.0,
          status: 'FILLED',
        },
      ],
    });

    const trade = await repo.getById('trade-1');
    expect(trade).toBeDefined();
    expect(trade?.id).toBe('trade-1');
  });

  it('should get recent trades', async () => {
    const { TradeRepository } = await import('../trade-repository');
    const repo = new TradeRepository();

    mockQuery.mockResolvedValueOnce({
      rows: [
        { id: 'trade-1', profit: 5.0 },
        { id: 'trade-2', profit: -2.0 },
      ],
    });

    const trades = await repo.getRecent(100);
    expect(trades.length).toBe(2);
  });

  it('should update trade status', async () => {
    const { TradeRepository } = await import('../trade-repository');
    const repo = new TradeRepository();

    await repo.updateStatus('trade-1', 'FILLED', 5.0);
    expect(mockQuery).toHaveBeenCalled();
  });
});

describe('PnLService', () => {
  it('should be constructable', async () => {
    const { PnLService } = await import('../pnl-service');
    const service = new PnLService();
    expect(service).toBeDefined();
    expect(typeof service.getDailySummary).toBe('function');
    expect(typeof service.getPerformanceMetrics).toBe('function');
  });

  it('should calculate daily summary', async () => {
    const { PnLService } = await import('../pnl-service');
    const service = new PnLService();

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          trade_count: '10',
          total_profit: '50.0',
          total_loss: '20.0',
          net_pnl: '30.0',
          win_count: '6',
          loss_count: '4',
          avg_win: '8.33',
          avg_loss: '5.0',
        },
      ],
    });

    const summary = await service.getDailySummary(new Date());
    expect(summary.tradeCount).toBe(10);
    expect(summary.winRate).toBe(0.6);
    expect(summary.netPnl).toBe(30);
  });

  it('should calculate performance metrics', async () => {
    const { PnLService } = await import('../pnl-service');
    const service = new PnLService();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ total: '100.0' }] }) // totalPnl
      .mockResolvedValueOnce({ rows: [] }) // daily
      .mockResolvedValueOnce({ rows: [] }) // weekly
      .mockResolvedValueOnce({ rows: [] }) // monthly
      .mockResolvedValueOnce({
        rows: [
          {
            total: '100',
            wins: '55',
            avg_trade: '1.0',
            best_trade: '50.0',
            worst_trade: '-20.0',
          },
        ],
      }); // stats

    const metrics = await service.getPerformanceMetrics();
    expect(metrics.totalPnl).toBe(100);
    expect(metrics.winRate).toBe(0.55);
  });
});
