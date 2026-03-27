/**
 * API Tests
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';

// Mock Redis
const mockRedis = {
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  keys: vi.fn().mockImplementation(async () => ['key1', 'key2', 'key3']),
  ping: vi.fn().mockResolvedValue('PONG'),
  info: vi.fn().mockImplementation(async () => {
    // Return properly formatted Redis INFO response
    return [
      '# Server',
      'redis_version:7.0.0',
      'uptime_in_seconds:86400',
      '# Memory',
      'used_memory:1048576',
      'used_memory_human:1.00M',
      'used_memory_rss:2097152',
      '# Stats',
      'total_connections_received:100',
      'total_commands_processed:5000',
    ].join('\r\n');
  }),
};

vi.mock('../../redis', () => ({
  getRedisClient: () => mockRedis,
}));

// Mock PostgreSQL
vi.mock('../../db/postgres-client', () => ({
  getDbClient: () => ({
    query: vi.fn().mockResolvedValue({ rows: [] }),
  }),
}));

// Mock TradeRepository
vi.mock('../../db/trade-repository', () => ({
  TradeRepository: class {
    getRecent = vi.fn().mockResolvedValue([]);
    getById = vi.fn().mockResolvedValue(null);
  },
}));

// Mock PnLService
vi.mock('../../db/pnl-service', () => ({
  PnLService: class {
    getPerformanceMetrics = vi.fn().mockResolvedValue({
      totalPnl: 100,
      dailyPnl: 10,
      weeklyPnl: 50,
      monthlyPnl: 80,
      sharpeRatio: 1.5,
      maxDrawdown: 0.05,
      winRate: 0.6,
      avgTrade: 1.0,
      bestTrade: 10.0,
      worstTrade: -5.0,
    });
    getDailySummary = vi.fn().mockResolvedValue({
      date: '2026-03-20',
      totalProfit: 50,
      totalLoss: 20,
      netPnl: 30,
      tradeCount: 10,
      winCount: 6,
      lossCount: 4,
      winRate: 0.6,
      avgWin: 8.33,
      avgLoss: 5.0,
      profitFactor: 2.5,
    });
  },
}));

describe('API Server', () => {
  let app: express.Application;

  beforeAll(async () => {
    const { ApiServer } = await import('../server');
    const apiServer = new ApiServer({ port: 3001 });
    app = apiServer.getApp();
  });

  describe('Health Endpoints', () => {
    it('GET /health should return healthy status', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.redis).toBe('ok');
    });

    it('GET /health/metrics should return system metrics', async () => {
      const res = await request(app).get('/health/metrics');

      console.log('Metrics response:', res.body);
      expect(res.status).toBe(200);
      expect(res.body.redis).toBeDefined();
      expect(res.body.keys).toBeDefined();
      expect(res.body.process).toBeDefined();
    });
  });

  describe('Trades Endpoints', () => {
    it('GET /api/trades should return empty list', async () => {
      const res = await request(app).get('/api/trades');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('GET /api/trades/:id should return 404 for non-existent trade', async () => {
      const res = await request(app).get('/api/trades/non-existent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Trade not found');
    });
  });

  describe('P&L Endpoints', () => {
    it('GET /api/pnl should return performance metrics', async () => {
      const res = await request(app).get('/api/pnl');

      expect(res.status).toBe(200);
      expect(res.body.totalPnl).toBe(100);
      expect(res.body.winRate).toBe(0.6);
      expect(res.body.sharpeRatio).toBe(1.5);
    });

    it('GET /api/pnl/daily should return daily summary', async () => {
      const res = await request(app).get('/api/pnl/daily');

      expect(res.status).toBe(200);
      expect(res.body.tradeCount).toBe(10);
      expect(res.body.winRate).toBe(0.6);
      expect(res.body.netPnl).toBe(30);
    });
  });

  describe('Signals Endpoints', () => {
    it('GET /api/signals should return empty signals', async () => {
      const res = await request(app).get('/api/signals');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.count).toBe(0);
    });

    it('GET /api/signals?minSpread=0.5 should filter by spread', async () => {
      const res = await request(app).get('/api/signals?minSpread=0.5');

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('Admin Endpoints', () => {
    it('POST /api/admin/halt should halt trading', async () => {
      const res = await request(app)
        .post('/api/admin/halt')
        .send({ reason: 'Testing' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/admin/halt should reject without reason', async () => {
      const res = await request(app)
        .post('/api/admin/halt')
        .send({ reason: '' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Reason is required');
    });

    it('POST /api/admin/resume should resume trading', async () => {
      const res = await request(app).post('/api/admin/resume');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('GET /api/admin/status should return system status', async () => {
      const res = await request(app).get('/api/admin/status');

      expect(res.status).toBe(200);
      expect(res.body.trading).toBeDefined();
      expect(res.body.circuitBreaker).toBeDefined();
      expect(res.body.drawdown).toBeDefined();
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const res = await request(app).get('/api/unknown');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
