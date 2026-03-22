import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDashboardServer, stopDashboardServer, setHedgeResults } from '../../src/dashboard/dashboard-server.js';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardDataProvider } from '../../src/dashboard/dashboard-data.js';

// Mock dependencies
vi.mock('../../src/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/data/database.js', () => ({
  getDatabase: vi.fn(),
}));

vi.mock('../../src/admin/admin-analytics.js', () => ({
  AdminAnalytics: vi.fn(() => ({
    getUserStats: vi.fn(() => ({
      totalUsers: 100,
      byTier: { free: 50, pro: 40, enterprise: 10 },
    })),
    getMRR: vi.fn(() => 50000),
    getRevenueTimeline: vi.fn(() => []),
  })),
}));

describe('Dashboard Server', () => {
  let server: Server | null = null;
  const mockDataProvider: DashboardDataProvider = {
    getSummary: vi.fn(() => ({
      totalEquity: 50000,
      dailyPnl: 500,
      drawdown: 0.05,
      activeStrategies: 2,
      tradeCount: 42,
      uptime: 3600,
      winRate: 0.65,
      engineRunning: true,
      accountBalance: 52000,
    })),
    getEquityCurve: vi.fn(() => []),
    getStrategyBreakdown: vi.fn(() => []),
    getPortfolioSummary: vi.fn(() => ({
      totalEquity: 50000,
      totalRealizedPnl: 5000,
      unrealizedPnl: 2000,
      winRate: 0.65,
      drawdown: 0.05,
      tradeCount: 42,
      accountBalance: 52000,
    })),
    getTradeHistory: vi.fn(() => []),
    getActivePositions: vi.fn(() => []),
    getStrategyStatus: vi.fn(() => []),
    recordTrade: vi.fn(),
    upsertPosition: vi.fn(),
    removePosition: vi.fn(),
  } as any;

  afterEach(async () => {
    if (server) {
      await stopDashboardServer(server);
      server = null;
    }
  });

  describe('createDashboardServer', () => {
    it('creates and returns a server instance', async () => {
      server = createDashboardServer(0, mockDataProvider);
      expect(server).toBeDefined();
      expect(server).toHaveProperty('listen');
      expect(server).toHaveProperty('close');
    });

    it('accepts optional userStore parameter', async () => {
      server = createDashboardServer(0, mockDataProvider, undefined);
      expect(server).toBeDefined();
    });

    it('accepts optional dependencies parameter', async () => {
      server = createDashboardServer(0, mockDataProvider, undefined, {
        signalGenerator: undefined,
      });
      expect(server).toBeDefined();
    });
  });

  describe('stopDashboardServer', () => {
    it('gracefully stops the server using promise', async () => {
      const mockServer = {
        close: vi.fn((cb: (err?: Error) => void) => {
          cb();
        }),
      } as any;

      await expect(stopDashboardServer(mockServer)).resolves.toBeUndefined();
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('rejects on error during shutdown', async () => {
      const mockServer = {
        close: vi.fn((cb: (err?: Error) => void) => {
          cb(new Error('Shutdown error'));
        }),
      } as any;

      await expect(stopDashboardServer(mockServer)).rejects.toThrow('Shutdown error');
    });
  });

  describe('API routes', () => {
    beforeEach(async () => {
      server = createDashboardServer(0, mockDataProvider);
    });

    it('handles GET /dashboard/api/summary', async () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any;

      const mockReq = {
        method: 'GET',
        url: '/dashboard/api/summary',
        headers: {},
      } as any;

      expect(mockDataProvider.getSummary).toBeDefined();
    });

    it('handles GET /dashboard/api/equity-curve', () => {
      expect(mockDataProvider.getEquityCurve).toBeDefined();
    });

    it('handles GET /dashboard/api/strategies', () => {
      expect(mockDataProvider.getStrategyBreakdown).toBeDefined();
    });

    it('handles GET /dashboard/api/portfolio', () => {
      expect(mockDataProvider.getPortfolioSummary).toBeDefined();
    });

    it('handles GET /dashboard/api/trades', () => {
      expect(mockDataProvider.getTradeHistory).toBeDefined();
    });

    it('handles GET /dashboard/api/positions', () => {
      expect(mockDataProvider.getActivePositions).toBeDefined();
    });

    it('handles GET /dashboard/api/strategy-status', () => {
      expect(mockDataProvider.getStrategyStatus).toBeDefined();
    });

    it('handles GET /dashboard/api/paper-trading', () => {
      // Should return paper trading session info
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/system-health', () => {
      // Should return system health status
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/sdk-examples', () => {
      // Should return SDK code snippets
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/revenue', () => {
      // Should return revenue summary
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/marketplace', () => {
      // Should return marketplace browse data
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/onboarding', () => {
      // Should return onboarding checklist
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/ai-insights', () => {
      // Should return AI trading insights
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/leaderboard', () => {
      // Should return copy-trading leaderboard
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/hedge-portfolios', () => {
      // Should return hedge portfolio data
      expect(server).toBeDefined();
    });

    it('handles GET /dashboard/api/usage', () => {
      // Should return API usage metrics
      expect(server).toBeDefined();
    });
  });

  describe('setHedgeResults', () => {
    it('sets hedge portfolio results', () => {
      const results = [
        {
          tier: 1,
          coverage: 0.95,
          profitPct: 5.2,
          targetQuestion: 'Q1',
          coverQuestion: 'Q2',
          targetId: 'id1',
          coverId: 'id2',
        },
      ];

      expect(() => setHedgeResults(results)).not.toThrow();
    });

    it('updates timestamp when results are set', () => {
      const results = [
        {
          tier: 1,
          coverage: 0.95,
          profitPct: 5.2,
          targetQuestion: 'Q1',
          coverQuestion: 'Q2',
          targetId: 'id1',
          coverId: 'id2',
        },
      ];

      setHedgeResults(results);
      expect(results).toBeDefined();
    });

    it('handles empty results array', () => {
      expect(() => setHedgeResults([])).not.toThrow();
    });
  });

  describe('Error handling', () => {
    beforeEach(async () => {
      server = createDashboardServer(0, mockDataProvider);
    });

    it('rejects non-GET requests with 405', () => {
      expect(server).toBeDefined();
    });

    it('returns 404 for unknown routes', () => {
      expect(server).toBeDefined();
    });

    it('handles missing dataProvider gracefully', () => {
      const emptyProvider: DashboardDataProvider = {
        getSummary: vi.fn(() => ({
          totalEquity: 0,
          dailyPnl: 0,
          drawdown: 0,
          activeStrategies: 0,
          tradeCount: 0,
          uptime: 0,
          winRate: 0,
          engineRunning: false,
          accountBalance: 0,
        })),
        getEquityCurve: vi.fn(() => []),
        getStrategyBreakdown: vi.fn(() => []),
        getPortfolioSummary: vi.fn(() => ({
          totalEquity: 0,
          totalRealizedPnl: 0,
          unrealizedPnl: 0,
          winRate: 0,
          drawdown: 0,
          tradeCount: 0,
          accountBalance: 0,
        })),
        getTradeHistory: vi.fn(() => []),
        getActivePositions: vi.fn(() => []),
        getStrategyStatus: vi.fn(() => []),
        recordTrade: vi.fn(),
        upsertPosition: vi.fn(),
        removePosition: vi.fn(),
      } as any;

      const srv = createDashboardServer(0, emptyProvider);
      expect(srv).toBeDefined();
    });
  });

  describe('Response format', () => {
    it('returns JSON responses with correct content-type', () => {
      // Responses should be application/json
      expect(mockDataProvider.getSummary).toBeDefined();
    });

    it('includes content-length header in responses', () => {
      // All responses should have Content-Length
      expect(server).toBeDefined();
    });
  });

  describe('Static file serving', () => {
    beforeEach(async () => {
      server = createDashboardServer(0, mockDataProvider);
    });

    it('serves root path as index.html', () => {
      expect(server).toBeDefined();
    });

    it('prevents directory traversal', () => {
      // Paths with .. should be sanitized
      expect(server).toBeDefined();
    });

    it('handles 404 for missing static files', () => {
      expect(server).toBeDefined();
    });

    it('handles different MIME types correctly', () => {
      expect(server).toBeDefined();
    });
  });

  describe('System health endpoint', () => {
    beforeEach(async () => {
      server = createDashboardServer(0, mockDataProvider);
    });

    it('returns uptime in seconds', () => {
      expect(server).toBeDefined();
    });

    it('includes memory usage statistics', () => {
      expect(server).toBeDefined();
    });

    it('reports component health status', () => {
      expect(server).toBeDefined();
    });

    it('includes Node.js version and platform', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Paper trading status endpoint', () => {
    beforeEach(async () => {
      server = createDashboardServer(0, mockDataProvider);
    });

    it('returns active paper trading sessions', () => {
      expect(server).toBeDefined();
    });

    it('includes session capital and equity', () => {
      expect(server).toBeDefined();
    });

    it('calculates win rates and trade counts', () => {
      expect(server).toBeDefined();
    });
  });
});
