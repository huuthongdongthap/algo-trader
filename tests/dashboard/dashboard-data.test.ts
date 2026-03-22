import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardDataProvider } from '../../src/dashboard/dashboard-data.js';
import type { TradingEngine } from '../../src/engine/engine.js';
import type { PortfolioTracker } from '../../src/portfolio/portfolio-tracker.js';
import type { TradeResult, Position } from '../../src/core/types.js';

describe('Dashboard Data Provider', () => {
  let mockEngine: TradingEngine;
  let mockPortfolio: PortfolioTracker;

  beforeEach(() => {
    mockEngine = {
      getStatus: vi.fn(() => ({
        running: true,
        strategies: [
          { name: 'grid-trading', state: 'running' },
          { name: 'dca-bot', state: 'stopped' },
        ],
        tradeCount: 42,
        config: {},
      })),
    } as any;

    mockPortfolio = {
      getPortfolioSummary: vi.fn(() => ({
        totalEquity: 50000,
        totalRealizedPnl: 5000,
        totalUnrealizedPnl: 2000,
        winRate: 0.65,
        drawdown: 0.05,
        totalTradeCount: 42,
        strategies: [
          {
            name: 'grid-trading',
            equity: 30000,
            realizedPnl: 3000,
            tradeCount: 25,
            winRate: 0.68,
            avgWin: 150,
            avgLoss: -100,
          },
          {
            name: 'dca-bot',
            equity: 20000,
            realizedPnl: 2000,
            tradeCount: 17,
            winRate: 0.61,
            avgWin: 120,
            avgLoss: -80,
          },
        ],
      })),
      getEquityCurve: vi.fn(() => [
        { timestamp: Date.now() - 3600000, equity: 48000 },
        { timestamp: Date.now(), equity: 50000 },
      ]),
    } as any;
  });

  describe('constructor', () => {
    it('creates instance with engine only', () => {
      const provider = new DashboardDataProvider(mockEngine);
      expect(provider).toBeDefined();
    });

    it('creates instance with engine and portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine, mockPortfolio);
      expect(provider).toBeDefined();
    });

    it('initializes empty trade log', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const history = provider.getTradeHistory(undefined, 10);
      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBe(0);
    });

    it('initializes empty positions map', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const positions = provider.getActivePositions();
      expect(Array.isArray(positions)).toBe(true);
      expect(positions.length).toBe(0);
    });
  });

  describe('recordTrade', () => {
    it('adds trade to in-memory log', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const trade: TradeResult = {
        orderId: 'order-1',
        marketId: 'BTC/USD',
        side: 'buy',
        fillPrice: '42000.00',
        fillSize: '1.0',
        fees: '42.00',
        timestamp: Date.now(),
        strategy: 'grid-trading',
      };

      provider.recordTrade(trade);
      const history = provider.getTradeHistory(undefined, 10);

      expect(history.length).toBe(1);
      expect(history[0].marketId).toBe('BTC/USD');
      expect(history[0].side).toBe('buy');
    });

    it('stores trades in reverse order (newest first)', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const trade1: TradeResult = {
        orderId: 'order-1',
        marketId: 'BTC/USD',
        side: 'buy',
        fillPrice: '42000.00',
        fillSize: '1.0',
        fees: '42.00',
        timestamp: Date.now() - 1000,
        strategy: 'grid-trading',
      };

      const trade2: TradeResult = {
        orderId: 'order-2',
        marketId: 'ETH/USD',
        side: 'sell',
        fillPrice: '2500.00',
        fillSize: '2.0',
        fees: '10.00',
        timestamp: Date.now(),
        strategy: 'grid-trading',
      };

      provider.recordTrade(trade1);
      provider.recordTrade(trade2);

      const history = provider.getTradeHistory(undefined, 10);
      expect(history[0].marketId).toBe('ETH/USD'); // Most recent first
      expect(history[1].marketId).toBe('BTC/USD');
    });

    it('limits trade log to 500 entries', () => {
      const provider = new DashboardDataProvider(mockEngine);

      // Add 501 trades
      for (let i = 0; i < 501; i++) {
        const trade: TradeResult = {
          orderId: `order-${i}`,
          marketId: 'BTC/USD',
          side: i % 2 === 0 ? 'buy' : 'sell',
          fillPrice: '42000.00',
          fillSize: '1.0',
          fees: '42.00',
          timestamp: Date.now() + i,
          strategy: 'grid-trading',
        };
        provider.recordTrade(trade);
      }

      const history = provider.getTradeHistory(undefined, 600);
      expect(history.length).toBe(500); // Should be capped at 500
    });

    it('converts trade data correctly in history', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const trade: TradeResult = {
        orderId: 'order-1',
        marketId: 'BTC/USD',
        side: 'buy',
        fillPrice: '42000.50',
        fillSize: '1.5',
        fees: '63.00',
        timestamp: 1700000000000,
        strategy: 'grid-trading',
      };

      provider.recordTrade(trade);
      const history = provider.getTradeHistory(undefined, 10);

      expect(history[0].timestamp).toBe(1700000000000);
      expect(history[0].amount).toBe(1.5);
      expect(history[0].fillPrice).toBe(42000.5);
      expect(history[0].fees).toBe(63);
      expect(history[0].strategy).toBe('grid-trading');
    });

    it('calculates PnL correctly for buy trades', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const trade: TradeResult = {
        orderId: 'order-1',
        marketId: 'BTC/USD',
        side: 'buy',
        fillPrice: '1000.00',
        fillSize: '10.0',
        fees: '100.00',
        timestamp: Date.now(),
        strategy: 'test',
      };

      provider.recordTrade(trade);
      const history = provider.getTradeHistory();

      // Buy: -(price * size + fees) = -(1000 * 10 + 100) = -10100
      expect(history[0].pnl).toBe(-10100);
    });

    it('calculates PnL correctly for sell trades', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const trade: TradeResult = {
        orderId: 'order-1',
        marketId: 'BTC/USD',
        side: 'sell',
        fillPrice: '1000.00',
        fillSize: '10.0',
        fees: '100.00',
        timestamp: Date.now(),
        strategy: 'test',
      };

      provider.recordTrade(trade);
      const history = provider.getTradeHistory();

      // Sell: price * size - fees = 1000 * 10 - 100 = 9900
      expect(history[0].pnl).toBe(9900);
    });
  });

  describe('upsertPosition', () => {
    it('adds new position', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const pos: Position = {
        marketId: 'BTC/USD',
        side: 'long',
        entryPrice: '42000.00',
        size: '1.5',
        unrealizedPnl: '3000.00',
        strategy: 'grid-trading',
      };

      provider.upsertPosition(pos);
      const positions = provider.getActivePositions();

      expect(positions.length).toBe(1);
      expect(positions[0].marketId).toBe('BTC/USD');
    });

    it('updates existing position', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const pos1: Position = {
        marketId: 'BTC/USD',
        side: 'long',
        entryPrice: '42000.00',
        size: '1.0',
        unrealizedPnl: '1000.00',
        strategy: 'grid-trading',
      };

      provider.upsertPosition(pos1);

      const pos2: Position = {
        marketId: 'BTC/USD',
        side: 'long',
        entryPrice: '42000.00',
        size: '2.0',
        unrealizedPnl: '2000.00',
        strategy: 'grid-trading',
      };

      provider.upsertPosition(pos2);

      const positions = provider.getActivePositions();
      expect(positions.length).toBe(1); // Still 1 position
      expect(parseFloat(positions[0].size)).toBe(2.0); // Updated size
    });
  });

  describe('removePosition', () => {
    it('removes closed position', () => {
      const provider = new DashboardDataProvider(mockEngine);

      const pos: Position = {
        marketId: 'BTC/USD',
        side: 'long',
        entryPrice: '42000.00',
        size: '1.5',
        unrealizedPnl: '3000.00',
        strategy: 'grid-trading',
      };

      provider.upsertPosition(pos);
      provider.removePosition('BTC/USD');

      const positions = provider.getActivePositions();
      expect(positions.length).toBe(0);
    });

    it('handles removal of non-existent position', () => {
      const provider = new DashboardDataProvider(mockEngine);
      expect(() => provider.removePosition('NONEXISTENT')).not.toThrow();
    });
  });

  describe('getSummary', () => {
    it('returns summary with portfolio data', () => {
      const provider = new DashboardDataProvider(mockEngine, mockPortfolio);
      const summary = provider.getSummary();

      expect(summary.totalEquity).toBe(50000);
      expect(summary.dailyPnl).toBe(5000);
      expect(summary.drawdown).toBe(0.05);
      expect(summary.activeStrategies).toBe(1); // Only 1 running
      expect(summary.tradeCount).toBe(42);
      expect(summary.winRate).toBe(0.65);
      expect(summary.engineRunning).toBe(true);
    });

    it('returns default values when no portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const summary = provider.getSummary();

      expect(summary.totalEquity).toBe(0);
      expect(summary.dailyPnl).toBe(0);
      expect(summary.drawdown).toBe(0);
      expect(summary.tradeCount).toBe(42); // From engine
      expect(summary.engineRunning).toBe(true);
    });
  });

  describe('getEquityCurve', () => {
    it('returns equity curve points from portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine, mockPortfolio);
      const curve = provider.getEquityCurve();

      expect(Array.isArray(curve)).toBe(true);
      expect(curve.length).toBe(2);
      expect(curve[0]).toHaveProperty('timestamp');
      expect(curve[0]).toHaveProperty('equity');
    });

    it('returns empty array when no portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const curve = provider.getEquityCurve();

      expect(Array.isArray(curve)).toBe(true);
      expect(curve.length).toBe(0);
    });
  });

  describe('getStrategyBreakdown', () => {
    it('returns strategy breakdown from portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine, mockPortfolio);
      const breakdown = provider.getStrategyBreakdown();

      expect(Array.isArray(breakdown)).toBe(true);
      expect(breakdown.length).toBe(2);
      expect(breakdown[0]).toHaveProperty('name');
      expect(breakdown[0]).toHaveProperty('equity');
      expect(breakdown[0]).toHaveProperty('realizedPnl');
      expect(breakdown[0]).toHaveProperty('tradeCount');
      expect(breakdown[0]).toHaveProperty('winRate');
    });

    it('returns default breakdown when no portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const breakdown = provider.getStrategyBreakdown();

      expect(Array.isArray(breakdown)).toBe(true);
      expect(breakdown.length).toBe(2); // From engine status
      expect(breakdown[0].equity).toBe(0);
      expect(breakdown[0].realizedPnl).toBe(0);
    });
  });

  describe('getPortfolioSummary', () => {
    it('returns portfolio summary with all fields', () => {
      const provider = new DashboardDataProvider(mockEngine, mockPortfolio);
      const summary = provider.getPortfolioSummary();

      expect(summary.totalEquity).toBe(50000);
      expect(summary.totalRealizedPnl).toBe(5000);
      expect(summary.unrealizedPnl).toBe(2000);
      expect(summary.winRate).toBe(0.65);
      expect(summary.drawdown).toBe(0.05);
      expect(summary.tradeCount).toBe(42);
      expect(summary.accountBalance).toBe(52000);
    });

    it('returns zeros when no portfolio', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const summary = provider.getPortfolioSummary();

      expect(summary.totalEquity).toBe(0);
      expect(summary.totalRealizedPnl).toBe(0);
      expect(summary.unrealizedPnl).toBe(0);
      expect(summary.winRate).toBe(0);
      expect(summary.drawdown).toBe(0);
    });
  });

  describe('getTradeHistory', () => {
    it('returns trade history limited by count', () => {
      const provider = new DashboardDataProvider(mockEngine);

      for (let i = 0; i < 10; i++) {
        const trade: TradeResult = {
          orderId: `order-${i}`,
          marketId: 'BTC/USD',
          side: i % 2 === 0 ? 'buy' : 'sell',
          fillPrice: '42000.00',
          fillSize: '1.0',
          fees: '42.00',
          timestamp: Date.now() + i,
          strategy: 'grid-trading',
        };
        provider.recordTrade(trade);
      }

      const history = provider.getTradeHistory(undefined, 5);
      expect(history.length).toBe(5);
    });

    it('returns all history if no limit specified', () => {
      const provider = new DashboardDataProvider(mockEngine);

      for (let i = 0; i < 3; i++) {
        const trade: TradeResult = {
          orderId: `order-${i}`,
          marketId: 'BTC/USD',
          side: 'buy',
          fillPrice: '42000.00',
          fillSize: '1.0',
          fees: '42.00',
          timestamp: Date.now(),
          strategy: 'grid-trading',
        };
        provider.recordTrade(trade);
      }

      const history = provider.getTradeHistory();
      expect(history.length).toBe(3);
    });
  });

  describe('getActivePositions', () => {
    it('returns all active positions', () => {
      const provider = new DashboardDataProvider(mockEngine);

      provider.upsertPosition({
        marketId: 'BTC/USD',
        side: 'long',
        entryPrice: '42000.00',
        size: '1.0',
        unrealizedPnl: '1000.00',
        strategy: 'grid-trading',
      });

      provider.upsertPosition({
        marketId: 'ETH/USD',
        side: 'short',
        entryPrice: '2500.00',
        size: '2.0',
        unrealizedPnl: '-500.00',
        strategy: 'dca-bot',
      });

      const positions = provider.getActivePositions();
      expect(positions.length).toBe(2);
    });
  });

  describe('getStrategyStatus', () => {
    it('returns strategy status from engine', () => {
      const provider = new DashboardDataProvider(mockEngine);
      const status = provider.getStrategyStatus();

      expect(Array.isArray(status)).toBe(true);
      expect(status.length).toBe(2);
      expect(status[0]).toHaveProperty('name');
      expect(status[0]).toHaveProperty('running');
      expect(status[0].running).toBe(true); // grid-trading is running
      expect(status[1].running).toBe(false); // dca-bot is stopped
    });
  });

  describe('Data aggregation edge cases', () => {
    it('handles uptime calculation correctly', () => {
      const provider = new DashboardDataProvider(mockEngine, mockPortfolio);
      const summary = provider.getSummary();
      expect(summary.uptime).toBeGreaterThanOrEqual(0);
    });

    it('handles zero trade count', () => {
      mockEngine.getStatus = vi.fn(() => ({
        running: true,
        strategies: [],
        tradeCount: 0,
        config: {},
      }));

      const provider = new DashboardDataProvider(mockEngine);
      const summary = provider.getSummary();
      expect(summary.tradeCount).toBe(0);
    });

    it('handles multiple strategies with different states', () => {
      mockEngine.getStatus = vi.fn(() => ({
        running: true,
        strategies: [
          { name: 'strat1', state: 'running' },
          { name: 'strat2', state: 'running' },
          { name: 'strat3', state: 'stopped' },
          { name: 'strat4', state: 'error' },
        ],
        tradeCount: 100,
        config: {},
      }));

      const provider = new DashboardDataProvider(mockEngine);
      const summary = provider.getSummary();
      expect(summary.activeStrategies).toBe(2); // Only 2 running
    });
  });
});
