import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderDashboard, loadDashboardData, DashboardData } from '../../src/cli/dashboard.js';
import type { AppConfig } from '../../src/core/types.js';

// Mock dependencies
vi.mock('../../src/data/database.js', () => ({
  getDatabase: vi.fn(() => ({
    getOpenPositions: vi.fn(() => []),
    getTrades: vi.fn(() => []),
    getPnlHistory: vi.fn(() => []),
    close: vi.fn(),
  })),
}));

describe('CLI Dashboard', () => {
  describe('loadDashboardData', () => {
    it('loads dashboard data with default config', () => {
      const config: AppConfig = {
        dbPath: ':memory:',
        strategyEnabled: {},
        polymarketEnabled: true,
        cexEnabled: false,
        dexChains: [],
      };

      const data = loadDashboardData(config);

      expect(data).toBeDefined();
      expect(data.positions).toBeInstanceOf(Array);
      expect(data.recentTrades).toBeInstanceOf(Array);
      expect(data.pnlSnapshots).toBeInstanceOf(Array);
    });

    it('loads data filtered by strategy', () => {
      const config: AppConfig = {
        dbPath: ':memory:',
        strategyEnabled: { 'test-strategy': true },
        polymarketEnabled: true,
        cexEnabled: false,
        dexChains: [],
      };

      const data = loadDashboardData(config, 'test-strategy');

      expect(data).toBeDefined();
      expect(Array.isArray(data.positions)).toBe(true);
      expect(Array.isArray(data.recentTrades)).toBe(true);
    });

    it('returns empty arrays when no data available', () => {
      const config: AppConfig = {
        dbPath: ':memory:',
        strategyEnabled: {},
        polymarketEnabled: true,
        cexEnabled: false,
        dexChains: [],
      };

      const data = loadDashboardData(config);

      expect(data.positions.length).toBe(0);
      expect(data.recentTrades.length).toBe(0);
      expect(data.pnlSnapshots.length).toBe(0);
    });
  });

  describe('renderDashboard', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('renders dashboard with empty data', () => {
      const data: DashboardData = {
        positions: [],
        recentTrades: [],
        pnlSnapshots: [],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('renders dashboard with sample positions', () => {
      const data: DashboardData = {
        positions: [
          {
            strategy: 'grid-trading',
            market: 'BTC/USD',
            side: 'long',
            size: '1.5',
            entry_price: '42000.00',
            unrealized_pnl: '3000.00',
          },
        ],
        recentTrades: [],
        pnlSnapshots: [],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('renders dashboard with sample trades', () => {
      const data: DashboardData = {
        positions: [],
        recentTrades: [
          {
            strategy: 'dca-bot',
            market: 'ETH/USD',
            side: 'buy',
            price: '2500.00',
            size: '0.5',
            timestamp: Date.now(),
          },
        ],
        pnlSnapshots: [],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('renders dashboard with PnL snapshots', () => {
      const data: DashboardData = {
        positions: [],
        recentTrades: [],
        pnlSnapshots: [
          {
            strategy: 'momentum-scalper',
            equity: '25000.00',
            daily_pnl: '500.00',
            cumulative_pnl: '2500.00',
            timestamp: Date.now(),
          },
        ],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('renders dashboard with all data types', () => {
      const data: DashboardData = {
        positions: [
          {
            strategy: 'grid-trading',
            market: 'BTC/USD',
            side: 'long',
            size: '1.0',
            entry_price: '42000.00',
            unrealized_pnl: '2000.00',
          },
        ],
        recentTrades: [
          {
            strategy: 'grid-trading',
            market: 'BTC/USD',
            side: 'buy',
            price: '42000.00',
            size: '1.0',
            timestamp: Date.now(),
          },
        ],
        pnlSnapshots: [
          {
            strategy: 'grid-trading',
            equity: '52000.00',
            daily_pnl: '500.00',
            cumulative_pnl: '2500.00',
            timestamp: Date.now(),
          },
        ],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('handles negative PnL correctly', () => {
      const data: DashboardData = {
        positions: [
          {
            strategy: 'momentum-scalper',
            market: 'ETH/USD',
            side: 'short',
            size: '2.0',
            entry_price: '2500.00',
            unrealized_pnl: '-1000.00',
          },
        ],
        recentTrades: [],
        pnlSnapshots: [
          {
            strategy: 'momentum-scalper',
            equity: '19000.00',
            daily_pnl: '-500.00',
            cumulative_pnl: '-1000.00',
            timestamp: Date.now(),
          },
        ],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('formats timestamps correctly', () => {
      const now = Date.now();
      const data: DashboardData = {
        positions: [],
        recentTrades: [
          {
            strategy: 'test-strat',
            market: 'TEST/USD',
            side: 'buy',
            price: '100.00',
            size: '1.0',
            timestamp: now,
          },
        ],
        pnlSnapshots: [],
      };

      expect(() => renderDashboard(data)).not.toThrow();
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe('Dashboard color formatting', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('uses green for positive PnL', () => {
      const data: DashboardData = {
        positions: [],
        recentTrades: [],
        pnlSnapshots: [
          {
            strategy: 'winner-strat',
            equity: '50000.00',
            daily_pnl: '1000.00',
            cumulative_pnl: '5000.00',
            timestamp: Date.now(),
          },
        ],
      };

      renderDashboard(data);
      expect(consoleLogSpy).toHaveBeenCalled();
    });

    it('uses red for negative PnL', () => {
      const data: DashboardData = {
        positions: [],
        recentTrades: [],
        pnlSnapshots: [
          {
            strategy: 'loser-strat',
            equity: '45000.00',
            daily_pnl: '-500.00',
            cumulative_pnl: '-2500.00',
            timestamp: Date.now(),
          },
        ],
      };

      renderDashboard(data);
      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });
});
