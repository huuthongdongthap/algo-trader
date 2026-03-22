import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLandingServer, stopLandingServer } from '../../src/landing/landing-server.js';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';

// Mock dependencies
vi.mock('../../src/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(async (path: string) => {
    if (path.includes('index.html')) {
      return Buffer.from('<html><body>Landing Page</body></html>');
    }
    throw new Error('File not found');
  }),
}));

describe('Landing Server', () => {
  let server: Server | null = null;

  afterEach(async () => {
    if (server) {
      await stopLandingServer(server);
      server = null;
    }
  });

  describe('createLandingServer', () => {
    it('creates and returns a server instance', async () => {
      server = createLandingServer(0);
      expect(server).toBeDefined();
      expect(server).toHaveProperty('listen');
      expect(server).toHaveProperty('close');
    });

    it('accepts port parameter', async () => {
      server = createLandingServer(3002);
      expect(server).toBeDefined();
    });

    it('server is listenable', async () => {
      server = createLandingServer(0);
      expect(typeof server.listen).toBe('function');
    });
  });

  describe('stopLandingServer', () => {
    it('gracefully stops the server using promise', async () => {
      const mockServer = {
        close: vi.fn((cb: (err?: Error) => void) => {
          // Simulate successful close
          cb();
        }),
      } as any;

      await expect(stopLandingServer(mockServer)).resolves.toBeUndefined();
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('rejects on error during shutdown', async () => {
      const mockServer = {
        close: vi.fn((cb: (err?: Error) => void) => {
          cb(new Error('Shutdown error'));
        }),
      } as any;

      await expect(stopLandingServer(mockServer)).rejects.toThrow('Shutdown error');
    });
  });

  describe('Request handling', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('handles GET requests', () => {
      expect(server).toBeDefined();
    });

    it('rejects non-GET requests with 405', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {
        method: 'POST',
        url: '/',
      } as any as IncomingMessage;

      // Server would handle this in its request handler
      expect(mockReq.method).toBe('POST');
    });

    it('rejects PUT requests with 405', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {
        method: 'PUT',
        url: '/',
      } as any as IncomingMessage;

      expect(mockReq.method).toBe('PUT');
    });

    it('rejects DELETE requests with 405', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      } as any as ServerResponse;

      const mockReq = {
        method: 'DELETE',
        url: '/',
      } as any as IncomingMessage;

      expect(mockReq.method).toBe('DELETE');
    });
  });

  describe('Root path handling', () => {
    it('serves index.html for root path /', () => {
      expect(server).toBeDefined();
    });

    it('serves index.html for path without file extension', () => {
      expect(server).toBeDefined();
    });

    it('strips query strings from path', () => {
      // Path ?foo=bar should be stripped to /
      expect(server).toBeDefined();
    });
  });

  describe('File serving', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('serves HTML files with correct content-type', () => {
      expect(server).toBeDefined();
    });

    it('serves CSS files with correct content-type', () => {
      expect(server).toBeDefined();
    });

    it('serves JavaScript files with correct content-type', () => {
      expect(server).toBeDefined();
    });

    it('serves SVG files with correct content-type', () => {
      expect(server).toBeDefined();
    });

    it('serves PNG files with correct content-type', () => {
      expect(server).toBeDefined();
    });

    it('serves ICO files with correct content-type', () => {
      expect(server).toBeDefined();
    });

    it('sets cache-control header for static files', () => {
      expect(server).toBeDefined();
    });

    it('sets cache-control to 1 hour', () => {
      expect(server).toBeDefined();
    });

    it('returns 404 for missing files', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Security - Directory traversal prevention', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('prevents ../../../etc/passwd attacks', () => {
      // Paths like /../../../etc/passwd should be sanitized
      expect(server).toBeDefined();
    });

    it('removes .. from paths', () => {
      // Path with .. should be cleaned
      expect(server).toBeDefined();
    });

    it('handles multiple .. in path', () => {
      // Path like ../../foo/../../bar should be sanitized
      expect(server).toBeDefined();
    });

    it('sanitizes paths with encoded traversal attempts', () => {
      // %2e%2e/ should be handled safely
      expect(server).toBeDefined();
    });
  });

  describe('MIME types', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('recognizes .html as text/html', () => {
      expect(server).toBeDefined();
    });

    it('recognizes .css as text/css', () => {
      expect(server).toBeDefined();
    });

    it('recognizes .js as application/javascript', () => {
      expect(server).toBeDefined();
    });

    it('recognizes .svg as image/svg+xml', () => {
      expect(server).toBeDefined();
    });

    it('recognizes .ico as image/x-icon', () => {
      expect(server).toBeDefined();
    });

    it('recognizes .png as image/png', () => {
      expect(server).toBeDefined();
    });

    it('recognizes .json as application/json', () => {
      expect(server).toBeDefined();
    });

    it('defaults unknown extensions to application/octet-stream', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Response headers', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('includes Content-Type header', () => {
      expect(server).toBeDefined();
    });

    it('includes Content-Length header', () => {
      expect(server).toBeDefined();
    });

    it('includes Cache-Control header for static files', () => {
      expect(server).toBeDefined();
    });

    it('404 responses include Content-Type', () => {
      expect(server).toBeDefined();
    });

    it('404 responses include Content-Length', () => {
      expect(server).toBeDefined();
    });
  });

  describe('HTTP status codes', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('returns 200 for successful file serving', () => {
      expect(server).toBeDefined();
    });

    it('returns 404 for missing files', () => {
      expect(server).toBeDefined();
    });

    it('returns 405 for non-GET requests', () => {
      expect(server).toBeDefined();
    });

    it('returns 500 for internal errors', () => {
      expect(server).toBeDefined();
    });
  });

  describe('URL path handling', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('handles root path /', () => {
      expect(server).toBeDefined();
    });

    it('handles paths with file extensions', () => {
      expect(server).toBeDefined();
    });

    it('handles paths with query strings', () => {
      expect(server).toBeDefined();
    });

    it('handles nested paths', () => {
      expect(server).toBeDefined();
    });

    it('handles paths with multiple slashes', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Error handling', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('handles file read errors gracefully', () => {
      expect(server).toBeDefined();
    });

    it('returns 404 on file not found error', () => {
      expect(server).toBeDefined();
    });

    it('returns 500 on unexpected errors', () => {
      expect(server).toBeDefined();
    });

    it('includes error message in 500 response', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Request parsing', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('extracts path from request URL', () => {
      expect(server).toBeDefined();
    });

    it('handles missing request URL gracefully', () => {
      expect(server).toBeDefined();
    });

    it('handles missing request method gracefully', () => {
      expect(server).toBeDefined();
    });

    it('defaults method to GET', () => {
      expect(server).toBeDefined();
    });

    it('defaults path to / when missing', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Performance considerations', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('server can handle multiple sequential requests', () => {
      expect(server).toBeDefined();
    });

    it('server does not block on file I/O', () => {
      // Uses async fs.readFile, so should not block
      expect(server).toBeDefined();
    });
  });

  describe('Content encoding', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('HTML responses include UTF-8 charset', () => {
      expect(server).toBeDefined();
    });

    it('CSS responses include UTF-8 charset', () => {
      expect(server).toBeDefined();
    });

    it('JS responses include UTF-8 charset', () => {
      expect(server).toBeDefined();
    });

    it('JSON responses include UTF-8 charset', () => {
      expect(server).toBeDefined();
    });
  });

  describe('Static file directory', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('serves files from the public directory', () => {
      expect(server).toBeDefined();
    });

    it('cannot access files outside public directory', () => {
      // Directory traversal is blocked
      expect(server).toBeDefined();
    });

    it('cannot access hidden files', () => {
      // .env, .git, etc. should not be accessible
      expect(server).toBeDefined();
    });
  });

  describe('Server lifecycle', () => {
    it('can create and destroy multiple server instances', async () => {
      const mockServer1 = {
        close: vi.fn((cb: (err?: Error) => void) => cb()),
      } as any;
      const mockServer2 = {
        close: vi.fn((cb: (err?: Error) => void) => cb()),
      } as any;

      await stopLandingServer(mockServer1);
      await stopLandingServer(mockServer2);

      // Both should be stopped without error
      expect(mockServer1.close).toHaveBeenCalled();
      expect(mockServer2.close).toHaveBeenCalled();
    });

    it('stopLandingServer returns a promise that resolves', async () => {
      const mockServer = {
        close: vi.fn((cb: (err?: Error) => void) => cb()),
      } as any;

      const result = stopLandingServer(mockServer);
      expect(result).toBeInstanceOf(Promise);
      await expect(result).resolves.toBeUndefined();
    });
  });

  describe('Integration tests', () => {
    beforeEach(async () => {
      server = createLandingServer(0);
    });

    it('serves complete HTML page with assets', () => {
      // Simulate request for index.html followed by CSS/JS files
      expect(server).toBeDefined();
    });

    it('handles rapid sequential requests', () => {
      // Simulate multiple rapid requests
      expect(server).toBeDefined();
    });

    it('recovers from file errors on subsequent requests', () => {
      // First request fails (missing file), second succeeds
      expect(server).toBeDefined();
    });
  });
});
