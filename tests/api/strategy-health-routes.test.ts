import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleStrategyHealthRoutes, type StrategyHealthDeps } from '../../src/api/strategy-health-routes.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StrategyStatus } from '../../src/strategies/strategy-orchestrator.js';

// Mock the rate limiter registry
vi.mock('../../src/resilience/rate-limiter.js', () => ({
  rateLimiterRegistry: {
    getAvailable: vi.fn().mockReturnValue(10),
  },
}));

import { rateLimiterRegistry } from '../../src/resilience/rate-limiter.js';

describe('Strategy Health Routes', () => {
  let mockOrchestrator: StrategyHealthDeps['orchestrator'];
  let deps: StrategyHealthDeps;
  let mockRes: ServerResponse;
  let responseStatus: number;
  let responseData: string;

  const healthyStrategy: StrategyStatus = {
    id: 'arb-1',
    name: 'Polymarket Arb',
    status: 'running',
    tickCount: 42,
    errorCount: 0,
    lastTick: '2026-03-24T10:00:00.000Z',
    lastError: null,
  };

  const errorStrategy: StrategyStatus = {
    id: 'mm-1',
    name: 'Market Maker',
    status: 'error',
    tickCount: 10,
    errorCount: 10,
    lastTick: '2026-03-24T09:50:00.000Z',
    lastError: 'Connection timeout',
  };

  const stoppedStrategy: StrategyStatus = {
    id: 'grid-1',
    name: 'Grid Strategy',
    status: 'stopped',
    tickCount: 0,
    errorCount: 0,
    lastTick: null,
    lastError: null,
  };

  function createMockReq(method: string): IncomingMessage {
    return { method } as IncomingMessage;
  }

  beforeEach(() => {
    mockOrchestrator = {
      getStatus: vi.fn().mockReturnValue([healthyStrategy, stoppedStrategy]),
      getStrategyStatus: vi.fn().mockImplementation((id: string) => {
        if (id === 'arb-1') return healthyStrategy;
        if (id === 'mm-1') return errorStrategy;
        if (id === 'grid-1') return stoppedStrategy;
        return undefined;
      }),
      isHealthy: vi.fn().mockReturnValue(true),
    } as any;

    deps = { orchestrator: mockOrchestrator };

    responseStatus = 0;
    responseData = '';
    mockRes = {
      writeHead: vi.fn().mockImplementation((status: number) => {
        responseStatus = status;
      }),
      end: vi.fn().mockImplementation((data?: string) => {
        if (data) responseData = data;
      }),
    } as any;

    // Reset rate limiter mock
    vi.mocked(rateLimiterRegistry.getAvailable).mockReturnValue(10);
  });

  describe('GET /api/strategies/health', () => {
    it('returns all strategy health reports', () => {
      const req = createMockReq('GET');
      const handled = handleStrategyHealthRoutes(req, mockRes, '/api/strategies/health', 'GET', deps);

      expect(handled).toBe(true);
      expect(responseStatus).toBe(200);

      const body = JSON.parse(responseData);
      expect(body.strategies).toHaveLength(2);
      expect(body.strategies[0].strategyId).toBe('arb-1');
      expect(body.strategies[0].name).toBe('Polymarket Arb');
      expect(body.strategies[0].status).toBe('running');
      expect(body.strategies[0].tickCount).toBe(42);
      expect(body.strategies[0].errorCount).toBe(0);
      expect(body.strategies[0].lastTick).toBe('2026-03-24T10:00:00.000Z');
      expect(body.strategies[0].lastError).toBeNull();
      expect(body.strategies[0].healthy).toBe(true);

      expect(body.strategies[1].strategyId).toBe('grid-1');
      expect(body.strategies[1].healthy).toBe(true);
    });

    it('returns 503 when any strategy is in error state', () => {
      vi.mocked(mockOrchestrator.getStatus).mockReturnValue([healthyStrategy, errorStrategy]);
      vi.mocked(mockOrchestrator.isHealthy).mockReturnValue(false);

      const req = createMockReq('GET');
      handleStrategyHealthRoutes(req, mockRes, '/api/strategies/health', 'GET', deps);

      expect(responseStatus).toBe(503);
      const body = JSON.parse(responseData);
      expect(body.overall).toBe(false);
      expect(body.strategies[1].healthy).toBe(false);
      expect(body.strategies[1].status).toBe('error');
    });

    it('includes rate limiter info', () => {
      vi.mocked(rateLimiterRegistry.getAvailable).mockReturnValue(7);

      const req = createMockReq('GET');
      handleStrategyHealthRoutes(req, mockRes, '/api/strategies/health', 'GET', deps);

      const body = JSON.parse(responseData);
      expect(body.rateLimiter).toBeDefined();
      expect(body.rateLimiter.polymarket).toBe(7);
    });

    it('returns overall healthy = true when all strategies ok', () => {
      const req = createMockReq('GET');
      handleStrategyHealthRoutes(req, mockRes, '/api/strategies/health', 'GET', deps);

      const body = JSON.parse(responseData);
      expect(body.overall).toBe(true);
      expect(body.timestamp).toBeDefined();
    });

    it('returns overall healthy = false when rate limiter has 0 tokens', () => {
      vi.mocked(rateLimiterRegistry.getAvailable).mockReturnValue(0);

      const req = createMockReq('GET');
      handleStrategyHealthRoutes(req, mockRes, '/api/strategies/health', 'GET', deps);

      expect(responseStatus).toBe(503);
      const body = JSON.parse(responseData);
      expect(body.overall).toBe(false);
    });
  });

  describe('GET /api/strategies/:id/health', () => {
    it('returns single strategy health', () => {
      const req = createMockReq('GET');
      const handled = handleStrategyHealthRoutes(req, mockRes, '/api/strategies/arb-1/health', 'GET', deps);

      expect(handled).toBe(true);
      expect(responseStatus).toBe(200);

      const body = JSON.parse(responseData);
      expect(body.strategyId).toBe('arb-1');
      expect(body.name).toBe('Polymarket Arb');
      expect(body.status).toBe('running');
      expect(body.tickCount).toBe(42);
      expect(body.healthy).toBe(true);
    });

    it('returns 404 for unknown strategy ID', () => {
      const req = createMockReq('GET');
      const handled = handleStrategyHealthRoutes(req, mockRes, '/api/strategies/unknown-99/health', 'GET', deps);

      expect(handled).toBe(true);
      expect(responseStatus).toBe(404);

      const body = JSON.parse(responseData);
      expect(body.error).toContain('unknown-99');
      expect(body.error).toContain('not found');
    });

    it('returns correct healthy boolean per strategy — error strategy', () => {
      const req = createMockReq('GET');
      handleStrategyHealthRoutes(req, mockRes, '/api/strategies/mm-1/health', 'GET', deps);

      expect(responseStatus).toBe(503);
      const body = JSON.parse(responseData);
      expect(body.strategyId).toBe('mm-1');
      expect(body.healthy).toBe(false);
      expect(body.status).toBe('error');
      expect(body.lastError).toBe('Connection timeout');
    });

    it('returns correct healthy boolean per strategy — stopped strategy', () => {
      const req = createMockReq('GET');
      handleStrategyHealthRoutes(req, mockRes, '/api/strategies/grid-1/health', 'GET', deps);

      expect(responseStatus).toBe(200);
      const body = JSON.parse(responseData);
      expect(body.strategyId).toBe('grid-1');
      expect(body.healthy).toBe(true);
      expect(body.status).toBe('stopped');
    });
  });

  describe('unhandled routes', () => {
    it('returns false for non-matching paths', () => {
      const req = createMockReq('GET');
      const handled = handleStrategyHealthRoutes(req, mockRes, '/api/other', 'GET', deps);
      expect(handled).toBe(false);
    });
  });
});
