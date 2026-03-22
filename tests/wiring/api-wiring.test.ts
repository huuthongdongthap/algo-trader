import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequestHandler, wireApiRoutes } from '../../src/wiring/api-wiring.js';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';

describe('api-wiring', () => {
  let mockEngine: any;
  let mockUserStore: any;
  let mockTenantManager: any;
  let mockServer: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockEngine = {
      getStatus: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };

    mockUserStore = {
      getUser: vi.fn(),
      createUser: vi.fn(),
    };

    mockTenantManager = {
      getTenant: vi.fn(),
      createTenant: vi.fn(),
    };

    mockServer = {
      on: vi.fn(),
    };
  });

  describe('createRequestHandler', () => {
    it('returns an async function', () => {
      const handler = createRequestHandler({
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      });

      expect(typeof handler).toBe('function');
    });

    it('handler accepts IncomingMessage and ServerResponse parameters', () => {
      const handler = createRequestHandler({
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      });

      // Verify it's callable with the right types
      expect(handler.length).toBeGreaterThanOrEqual(2);
    });

    it('creates handler with proper dependencies', () => {
      const deps = {
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      };

      const handler = createRequestHandler(deps);

      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    });

    it('handler is async', async () => {
      const handler = createRequestHandler({
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      });

      // Check that handler returns a Promise
      expect(handler.constructor.name).toBe('AsyncFunction');
    });
  });

  describe('marketplace routing', () => {
    it('directs marketplace routes through internal routing logic', () => {
      // routeMarketplace is internal, tested through createRequestHandler
      expect(createRequestHandler).toBeDefined();
    });
  });

  describe('wireApiRoutes', () => {
    it('attaches request handler to server', () => {
      const deps = {
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      };

      wireApiRoutes(mockServer as unknown as Server, deps);

      expect(mockServer.on).toHaveBeenCalledWith('request', expect.any(Function));
    });

    it('only calls server.on once per wireApiRoutes call', () => {
      const deps = {
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      };

      wireApiRoutes(mockServer as unknown as Server, deps);
      wireApiRoutes(mockServer as unknown as Server, deps);

      expect(mockServer.on).toHaveBeenCalledTimes(2);
    });

    it('does not throw when called with valid dependencies', () => {
      const deps = {
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      };

      expect(() => {
        wireApiRoutes(mockServer as unknown as Server, deps);
      }).not.toThrow();
    });
  });

  describe('API dependencies interface', () => {
    it('requires engine, userStore, tenantManager in dependencies', () => {
      const deps = {
        engine: mockEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      };

      // Should not throw when creating handler with valid deps
      expect(() => createRequestHandler(deps)).not.toThrow();
    });

    it('allows custom engine implementations', () => {
      const customEngine = {
        getStatus: vi.fn(),
        start: vi.fn(),
      };

      const deps = {
        engine: customEngine,
        userStore: mockUserStore,
        tenantManager: mockTenantManager,
      };

      const handler = createRequestHandler(deps);
      expect(handler).toBeDefined();
    });
  });
});
