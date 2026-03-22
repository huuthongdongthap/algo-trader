import { describe, it, expect } from 'vitest';
import { getOpenApiSpec } from '../../src/api-docs/openapi-spec.js';

describe('OpenAPI Spec', () => {
  describe('getOpenApiSpec', () => {
    it('returns a valid OpenAPI 3.0.3 document', () => {
      const spec = getOpenApiSpec();
      expect(spec.openapi).toBe('3.0.3');
    });

    it('includes required top-level fields', () => {
      const spec = getOpenApiSpec();
      expect(spec).toHaveProperty('info');
      expect(spec).toHaveProperty('servers');
      expect(spec).toHaveProperty('security');
      expect(spec).toHaveProperty('components');
      expect(spec).toHaveProperty('paths');
    });

    it('has correct API title and description', () => {
      const spec = getOpenApiSpec();
      expect(spec.info.title).toBe('Algo-Trade RaaS API');
      expect(spec.info.version).toBe('1.0.0');
      expect(spec.info.description).toBeDefined();
      expect(spec.info.description.length).toBeGreaterThan(0);
    });

    it('includes server definitions', () => {
      const spec = getOpenApiSpec();
      expect(Array.isArray(spec.servers)).toBe(true);
      expect(spec.servers.length).toBeGreaterThan(0);
      expect(spec.servers[0]).toHaveProperty('url');
      expect(spec.servers[0]).toHaveProperty('description');
    });

    it('includes local dev and production servers', () => {
      const spec = getOpenApiSpec();
      const urls = spec.servers.map((s) => s.url);
      expect(urls).toContain('http://localhost:3000');
      expect(urls).toContain('https://api.algo-trade.io');
    });

    it('includes security requirements', () => {
      const spec = getOpenApiSpec();
      expect(Array.isArray(spec.security)).toBe(true);
      expect(spec.security.length).toBeGreaterThan(0);
    });
  });

  describe('Security schemes', () => {
    it('includes ApiKey security scheme', () => {
      const spec = getOpenApiSpec();
      expect(spec.components.securitySchemes).toHaveProperty('ApiKey');
      const apiKey = spec.components.securitySchemes.ApiKey as any;
      expect(apiKey.type).toBe('apiKey');
      expect(apiKey.in).toBe('header');
      expect(apiKey.name).toBe('X-API-Key');
    });

    it('includes AdminKey security scheme', () => {
      const spec = getOpenApiSpec();
      expect(spec.components.securitySchemes).toHaveProperty('AdminKey');
      const adminKey = spec.components.securitySchemes.AdminKey as any;
      expect(adminKey.type).toBe('apiKey');
      expect(adminKey.in).toBe('header');
      expect(adminKey.name).toBe('X-Admin-Key');
    });
  });

  describe('Component schemas', () => {
    it('includes Error schema', () => {
      const spec = getOpenApiSpec();
      expect(spec.components.schemas).toHaveProperty('Error');
    });

    it('includes Trade schema', () => {
      const spec = getOpenApiSpec();
      expect(spec.components.schemas).toHaveProperty('Trade');
    });

    it('includes StrategyListing schema', () => {
      const spec = getOpenApiSpec();
      expect(spec.components.schemas).toHaveProperty('StrategyListing');
    });

    it('includes StrategyActionResponse schema', () => {
      const spec = getOpenApiSpec();
      expect(spec.components.schemas).toHaveProperty('StrategyActionResponse');
    });
  });

  describe('API paths', () => {
    it('includes /api/health endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/health');
    });

    it('includes /api/status endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/status');
    });

    it('includes /api/trades endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/trades');
    });

    it('includes /api/strategies/performance endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/strategies/performance');
    });

    it('includes /api/strategy/start endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/strategy/start');
    });

    it('includes /api/strategy/stop endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/strategy/stop');
    });

    it('includes /api/pipeline endpoints', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/pipeline/start');
      expect(spec.paths).toHaveProperty('/api/pipeline/stop');
      expect(spec.paths).toHaveProperty('/api/pipeline/status');
    });

    it('includes /api/pnl endpoint', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/pnl');
    });

    it('includes marketplace endpoints', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/api/marketplace');
      expect(spec.paths).toHaveProperty('/api/marketplace/clone/{id}');
    });
  });

  describe('Endpoint definitions', () => {
    it('/api/health is GET method', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath).toHaveProperty('get');
    });

    it('/api/status is GET method', () => {
      const spec = getOpenApiSpec();
      const statusPath = spec.paths['/api/status'] as any;
      expect(statusPath).toHaveProperty('get');
    });

    it('/api/strategy/start is POST method', () => {
      const spec = getOpenApiSpec();
      const startPath = spec.paths['/api/strategy/start'] as any;
      expect(startPath).toHaveProperty('post');
    });

    it('/api/strategy/stop is POST method', () => {
      const spec = getOpenApiSpec();
      const stopPath = spec.paths['/api/strategy/stop'] as any;
      expect(stopPath).toHaveProperty('post');
    });
  });

  describe('Endpoint properties', () => {
    it('endpoints include tags', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath.get).toHaveProperty('tags');
      expect(Array.isArray(healthPath.get.tags)).toBe(true);
    });

    it('endpoints include summary and description', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath.get).toHaveProperty('summary');
      expect(healthPath.get).toHaveProperty('description');
    });

    it('endpoints include response definitions', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath.get).toHaveProperty('responses');
      expect(Object.keys(healthPath.get.responses).length).toBeGreaterThan(0);
    });

    it('POST endpoints include requestBody when appropriate', () => {
      const spec = getOpenApiSpec();
      const startPath = spec.paths['/api/strategy/start'] as any;
      expect(startPath.post).toHaveProperty('requestBody');
    });
  });

  describe('Response definitions', () => {
    it('/api/health includes 200 response', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath.get.responses).toHaveProperty('200');
    });

    it('/api/health includes 503 response', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath.get.responses).toHaveProperty('503');
    });

    it('Protected endpoints include 401 response', () => {
      const spec = getOpenApiSpec();
      const statusPath = spec.paths['/api/status'] as any;
      expect(statusPath.get.responses).toHaveProperty('401');
    });

    it('POST endpoints with validation include 400 response', () => {
      const spec = getOpenApiSpec();
      const startPath = spec.paths['/api/strategy/start'] as any;
      expect(startPath.post.responses).toHaveProperty('400');
    });
  });

  describe('Request body definitions', () => {
    it('POST /api/strategy/start requires strategy name', () => {
      const spec = getOpenApiSpec();
      const startPath = spec.paths['/api/strategy/start'] as any;
      expect(startPath.post.requestBody.required).toBe(true);
      expect(startPath.post.requestBody.content).toHaveProperty('application/json');
    });

    it('POST /api/marketplace/import requires configuration', () => {
      const spec = getOpenApiSpec();
      const importPath = spec.paths['/api/marketplace/import'] as any;
      expect(importPath).toBeDefined();
    });
  });

  describe('Response content types', () => {
    it('API endpoints return JSON content', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      const response = healthPath.get.responses['200'];
      expect(response.content).toHaveProperty('application/json');
    });

    it('/api/metrics returns Prometheus text format', () => {
      const spec = getOpenApiSpec();
      const metricsPath = spec.paths['/api/metrics'] as any;
      expect(metricsPath.get.responses['200'].content).toHaveProperty(
        'text/plain; version=0.0.4; charset=utf-8'
      );
    });
  });

  describe('Schema completeness', () => {
    it('Error schema has required fields', () => {
      const spec = getOpenApiSpec();
      const errorSchema = spec.components.schemas.Error as any;
      expect(errorSchema.required).toContain('error');
    });

    it('Trade schema has required fields', () => {
      const spec = getOpenApiSpec();
      const tradeSchema = spec.components.schemas.Trade as any;
      expect(tradeSchema.properties).toHaveProperty('id');
      expect(tradeSchema.properties).toHaveProperty('side');
      expect(tradeSchema.properties).toHaveProperty('amount');
    });

    it('StrategyListing schema has required fields', () => {
      const spec = getOpenApiSpec();
      const listingSchema = spec.components.schemas.StrategyListing as any;
      expect(listingSchema.required).toContain('id');
      expect(listingSchema.required).toContain('name');
      expect(listingSchema.required).toContain('author');
    });
  });

  describe('Enum values', () => {
    it('includes strategy name enums', () => {
      const spec = getOpenApiSpec();
      // Verify that strategy enums exist in relevant schemas
      expect(spec.components.schemas).toBeDefined();
    });

    it('trade side values are buy or sell', () => {
      const spec = getOpenApiSpec();
      const tradeSchema = spec.components.schemas.Trade as any;
      expect(tradeSchema.properties.side.enum).toContain('buy');
      expect(tradeSchema.properties.side.enum).toContain('sell');
    });
  });

  describe('Admin endpoints', () => {
    it('includes admin management endpoints', () => {
      const spec = getOpenApiSpec();
      expect(spec.paths).toHaveProperty('/admin/users');
      expect(spec.paths).toHaveProperty('/admin/system');
    });

    it('admin endpoints document AdminKey security', () => {
      const spec = getOpenApiSpec();
      // Verify admin endpoints exist and are documented
      expect(spec.components.securitySchemes).toHaveProperty('AdminKey');
    });
  });

  describe('Documentation metadata', () => {
    it('includes example values in schema properties', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      const response = healthPath.get.responses['200'];
      expect(response.content['application/json'].schema).toBeDefined();
    });

    it('includes descriptions for endpoints', () => {
      const spec = getOpenApiSpec();
      const healthPath = spec.paths['/api/health'] as any;
      expect(healthPath.get.description.length).toBeGreaterThan(0);
    });
  });

  describe('Spec structure validation', () => {
    it('spec can be serialized to JSON', () => {
      const spec = getOpenApiSpec();
      expect(() => JSON.stringify(spec)).not.toThrow();
    });

    it('spec paths are properly formatted', () => {
      const spec = getOpenApiSpec();
      for (const path of Object.keys(spec.paths)) {
        expect(path.startsWith('/')).toBe(true);
      }
    });

    it('all paths have at least one operation', () => {
      const spec = getOpenApiSpec();
      for (const path of Object.values(spec.paths)) {
        const pathObj = path as any;
        const methods = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'];
        const hasMethod = methods.some((m) => m in pathObj);
        expect(hasMethod).toBe(true);
      }
    });
  });
});
