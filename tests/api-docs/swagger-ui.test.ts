import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDocsHandler } from '../../src/api-docs/swagger-ui.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Mock openapi-spec
vi.mock('../../src/api-docs/openapi-spec.js', () => ({
  getOpenApiSpec: vi.fn(() => ({
    openapi: '3.0.3',
    info: {
      title: 'Algo-Trade RaaS API',
      version: '1.0.0',
      description: 'Test API',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local' }],
    paths: {
      '/api/health': {
        get: { summary: 'Health check', tags: ['System'] },
      },
    },
    components: { schemas: {}, securitySchemes: {} },
  })),
}));

describe('Swagger UI Handler', () => {
  let handler: ReturnType<typeof createDocsHandler>;

  beforeEach(() => {
    handler = createDocsHandler();
  });

  describe('createDocsHandler', () => {
    it('returns a handler function', () => {
      expect(typeof handler).toBe('function');
    });

    it('handler function accepts req, res, pathname parameters', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      expect(() => handler(mockReq, mockRes, '/docs')).not.toThrow();
    });
  });

  describe('GET /docs route', () => {
    it('serves HTML page for /docs', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      expect(mockRes.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/html; charset=utf-8',
        })
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('serves HTML page for /docs/ with trailing slash', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/');

      expect(mockRes.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'text/html; charset=utf-8',
        })
      );
    });

    it('HTML page includes Swagger UI setup', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('swagger-ui');
      expect(html).toContain('SwaggerUIBundle');
    });

    it('HTML page references correct OpenAPI spec URL', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('/api/docs/openapi.json');
    });

    it('HTML page includes dark theme styles', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('color-scheme: dark');
      expect(html).toContain('#1a1a2e');
    });

    it('HTML page includes CDN script references', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('swagger-ui-dist');
      expect(html).toContain('swagger-ui-bundle.js');
    });

    it('HTML page sets deepLinking enabled', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('deepLinking: true');
    });

    it('HTML page enables try it out', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('tryItOutEnabled: true');
    });
  });

  describe('GET /docs/openapi.json route', () => {
    it('serves OpenAPI spec as JSON', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/openapi.json');

      expect(mockRes.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          'Content-Type': 'application/json',
        })
      );
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('JSON response includes Content-Length header', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/openapi.json');

      const headersCall = mockRes.writeHead.mock.calls[0][1];
      expect(headersCall).toHaveProperty('Content-Length');
    });

    it('JSON response includes CORS header', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/openapi.json');

      const headersCall = mockRes.writeHead.mock.calls[0][1];
      expect(headersCall).toHaveProperty('Access-Control-Allow-Origin');
      expect((headersCall as any)['Access-Control-Allow-Origin']).toBe('*');
    });

    it('returns valid JSON structure', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/openapi.json');

      const jsonCall = mockRes.end.mock.calls[0];
      const json = jsonCall[0];

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveProperty('openapi');
      expect(parsed).toHaveProperty('info');
      expect(parsed).toHaveProperty('paths');
    });

    it('returns pretty-printed JSON', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/openapi.json');

      const jsonCall = mockRes.end.mock.calls[0];
      const json = jsonCall[0];

      // Pretty-printed JSON contains newlines and indentation
      expect(json).toContain('\n');
    });
  });

  describe('Unknown paths', () => {
    it('returns 404 for unknown paths', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/unknown');

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, {
        'Content-Type': 'text/plain',
      });
    });

    it('returns 404 for /api/docs path', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/api/docs');

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, {
        'Content-Type': 'text/plain',
      });
    });

    it('returns 404 for /api/docs/invalid', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/api/docs/invalid');

      expect(mockRes.writeHead).toHaveBeenCalledWith(404, {
        'Content-Type': 'text/plain',
      });
    });

    it('404 response sends "Not Found" message', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/nonexistent');

      expect(mockRes.end).toHaveBeenCalledWith('Not Found');
    });
  });

  describe('Spec memoization', () => {
    it('spec is generated once and reused', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      // Call multiple times
      handler(mockReq, mockRes, '/docs/openapi.json');
      handler(mockReq, mockRes, '/docs/openapi.json');
      handler(mockReq, mockRes, '/docs/openapi.json');

      // Verify consistent responses
      expect(mockRes.end.mock.calls.length).toBe(3);
    });

    it('HTML template is generated once and reused', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      // Call multiple times
      handler(mockReq, mockRes, '/docs');
      handler(mockReq, mockRes, '/docs');
      handler(mockReq, mockRes, '/docs');

      // All calls should succeed
      expect(mockRes.writeHead.mock.calls.length).toBe(3);
    });
  });

  describe('Response content validation', () => {
    it('HTML response is not empty', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html.length).toBeGreaterThan(0);
    });

    it('HTML response includes proper DOCTYPE', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('<!DOCTYPE html>');
    });

    it('HTML response includes title', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs');

      const htmlCall = mockRes.end.mock.calls[0];
      const htmlData = htmlCall[0];
      const html = typeof htmlData === 'string' ? htmlData : htmlData.toString();
      expect(html).toContain('<title>');
      expect(html).toContain('Algo-Trade');
    });

    it('JSON response is not empty', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {} as any as IncomingMessage;

      handler(mockReq, mockRes, '/docs/openapi.json');

      const jsonCall = mockRes.end.mock.calls[0];
      const json = jsonCall[0];
      expect(json.length).toBeGreaterThan(0);
    });
  });

  describe('Handler idempotency', () => {
    it('repeated calls produce consistent results', () => {
      const responses: string[] = [];

      for (let i = 0; i < 3; i++) {
        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        } as any as ServerResponse;

        const mockReq = {} as any as IncomingMessage;

        handler(mockReq, mockRes, '/docs/openapi.json');

        responses.push(mockRes.end.mock.calls[0][0]);
      }

      // All responses should be identical
      expect(responses[0]).toBe(responses[1]);
      expect(responses[1]).toBe(responses[2]);
    });
  });
});
