import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all external deps BEFORE import
const mockPipeline = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
};

const mockLandingServer = { listen: vi.fn(), close: vi.fn() };

const mockWsHandle = {
  shutdown: vi.fn().mockResolvedValue(undefined),
  getClientCount: vi.fn().mockReturnValue(0),
  broadcast: vi.fn(),
};

vi.mock('../../src/polymarket/trading-pipeline.js', () => ({
  TradingPipeline: vi.fn(() => mockPipeline),
}));

vi.mock('../../src/landing/landing-server.js', () => ({
  createLandingServer: vi.fn(() => mockLandingServer),
  stopLandingServer: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/ws/ws-server.js', () => ({
  createWsServer: vi.fn(() => mockWsHandle),
}));

vi.mock('../../src/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  createTradingPipeline,
  startLandingServer,
  startWsServer,
  startAllServers,
  stopAllServers,
} from '../../src/wiring/servers-wiring.js';

describe('servers-wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['LIVE_TRADING'];
    delete process.env['DB_PATH'];
    delete process.env['POLYMARKET_PRIVATE_KEY'];
  });

  describe('createTradingPipeline', () => {
    it('returns pipeline instance', () => {
      const p = createTradingPipeline();
      expect(p).toBeDefined();
    });

    it('registers event handlers on pipeline', () => {
      createTradingPipeline();
      expect(mockPipeline.on).toHaveBeenCalledWith('started', expect.any(Function));
      expect(mockPipeline.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockPipeline.on).toHaveBeenCalledWith('stream_disconnected', expect.any(Function));
    });
  });

  describe('startLandingServer', () => {
    it('creates landing server on port', () => {
      const srv = startLandingServer(3002);
      expect(srv).toBeDefined();
    });
  });

  describe('startWsServer', () => {
    it('creates WS server on port', () => {
      const ws = startWsServer(3003);
      expect(ws).toBeDefined();
    });
  });

  describe('startAllServers', () => {
    it('returns ServersBundle', async () => {
      const bundle = await startAllServers(3002, 3003);
      expect(bundle).toHaveProperty('pipeline');
      expect(bundle).toHaveProperty('landingServer');
      expect(bundle).toHaveProperty('wsHandle');
    });

    it('starts pipeline in background', async () => {
      await startAllServers(3002, 3003);
      expect(mockPipeline.start).toHaveBeenCalled();
    });
  });

  describe('stopAllServers', () => {
    it('stops all services', async () => {
      const bundle = { pipeline: mockPipeline as any, landingServer: mockLandingServer as any, wsHandle: mockWsHandle as any };
      await stopAllServers(bundle);
      expect(mockPipeline.stop).toHaveBeenCalled();
      expect(mockWsHandle.shutdown).toHaveBeenCalled();
    });

    it('handles partial failures gracefully', async () => {
      mockPipeline.stop.mockRejectedValueOnce(new Error('stop fail'));
      const bundle = { pipeline: mockPipeline as any, landingServer: mockLandingServer as any, wsHandle: mockWsHandle as any };
      await expect(stopAllServers(bundle)).resolves.toBeUndefined();
    });
  });
});
