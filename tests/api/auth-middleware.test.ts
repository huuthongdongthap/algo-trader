import { describe, it, expect, beforeEach } from 'vitest';
import { createServer } from 'node:http';
import { createJwt, verifyJwt, generateApiKeyToken, createAuthMiddleware } from '../../src/api/auth-middleware.js';
import { UserStore } from '../../src/users/user-store.js';
import type { User } from '../../src/users/user-store.js';
import type { AuthenticatedRequest } from '../../src/api/auth-middleware.js';

const TEST_DB = '/tmp/test-auth-users.db';
const JWT_SECRET = 'test-secret-key-for-jwt-hs256';

describe('JWT helpers', () => {
  it('should create and verify a valid JWT', () => {
    const user: Pick<User, 'id' | 'email' | 'tier'> = {
      id: 'user-123',
      email: 'test@example.com',
      tier: 'pro',
    };
    const token = createJwt(user, JWT_SECRET);
    expect(token).toBeTruthy();
    expect(token.split('.').length).toBe(3); // JWT format: header.payload.signature

    const payload = verifyJwt(token, JWT_SECRET);
    expect(payload).toBeTruthy();
    expect(payload?.sub).toBe('user-123');
    expect(payload?.email).toBe('test@example.com');
    expect(payload?.tier).toBe('pro');
  });

  it('should reject JWT with wrong secret', () => {
    const user: Pick<User, 'id' | 'email' | 'tier'> = {
      id: 'user-123',
      email: 'test@example.com',
      tier: 'free',
    };
    const token = createJwt(user, JWT_SECRET);
    const result = verifyJwt(token, 'wrong-secret');
    expect(result).toBeNull();
  });

  it('should reject malformed JWT', () => {
    const malformed = 'invalid.jwt.token';
    const result = verifyJwt(malformed, JWT_SECRET);
    expect(result).toBeNull();
  });

  it('should reject JWT with too few parts', () => {
    const result = verifyJwt('only.two', JWT_SECRET);
    expect(result).toBeNull();
  });

  it('should reject expired JWT', () => {
    const user: Pick<User, 'id' | 'email' | 'tier'> = {
      id: 'user-123',
      email: 'test@example.com',
      tier: 'enterprise',
    };
    // Create token that expires in -10 seconds (already expired)
    const token = createJwt(user, JWT_SECRET, -10);
    const result = verifyJwt(token, JWT_SECRET);
    expect(result).toBeNull();
  });

  it('should create JWT with custom expiration', () => {
    const user: Pick<User, 'id' | 'email' | 'tier'> = {
      id: 'user-456',
      email: 'custom@example.com',
      tier: 'pro',
    };
    const token = createJwt(user, JWT_SECRET, 7200); // 2 hours
    const payload = verifyJwt(token, JWT_SECRET);
    expect(payload).toBeTruthy();
    expect(payload?.iat).toBeLessThan(payload?.exp || 0);
    expect((payload?.exp || 0) - (payload?.iat || 0)).toBeGreaterThanOrEqual(7200);
  });

  it('should generate cryptographically random API key tokens', () => {
    const key1 = generateApiKeyToken();
    const key2 = generateApiKeyToken();
    expect(key1).toBeTruthy();
    expect(key2).toBeTruthy();
    expect(key1).not.toBe(key2); // Should be different
    expect(key1.length).toBe(64); // 32 bytes → 64 hex chars
  });

  it('should preserve tier in JWT payload', () => {
    const tiers: Array<'free' | 'pro' | 'enterprise'> = ['free', 'pro', 'enterprise'];
    tiers.forEach(tier => {
      const user = { id: 'test', email: 'test@test.com', tier };
      const token = createJwt(user, JWT_SECRET);
      const payload = verifyJwt(token, JWT_SECRET);
      expect(payload?.tier).toBe(tier);
    });
  });
});

describe('Auth middleware', () => {
  let userStore: UserStore;
  let testUser: User;

  beforeEach(() => {
    // Clean up from previous test
    try {
      const fs = require('node:fs');
      if (fs.existsSync(TEST_DB)) {
        fs.unlinkSync(TEST_DB);
      }
    } catch {
      // ignore
    }

    userStore = new UserStore(TEST_DB);
    testUser = userStore.createUser('user@example.com', 'pro');
  });

  it('should bypass public paths without auth', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let nextCalled = false;
    const req: AuthenticatedRequest = {
      url: '/api/health',
      headers: {},
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user).toBeUndefined(); // Public path doesn't attach user
  });

  it('should reject missing auth header on protected path', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let endCalled = false;
    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: {},
      on: () => {},
    } as any;
    const res = {
      writeHead: (status: number) => {
        expect(status).toBe(401);
      },
      end: () => {
        endCalled = true;
      },
    } as any;

    middleware(req, res, () => {
      throw new Error('Should not call next()');
    });

    expect(endCalled).toBe(true);
  });

  it('should accept valid Bearer JWT', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    const token = createJwt(
      { id: testUser.id, email: testUser.email, tier: testUser.tier },
      JWT_SECRET,
    );

    let nextCalled = false;
    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { authorization: `Bearer ${token}` },
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user?.id).toBe(testUser.id);
    expect(req.user?.email).toBe(testUser.email);
    expect(req.user?.tier).toBe('pro');
  });

  it('should reject invalid Bearer JWT', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let endCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { authorization: 'Bearer invalid.jwt.token' },
      on: () => {},
    } as any;
    const res = {
      writeHead: (status: number) => {
        expect(status).toBe(401);
      },
      end: () => {
        endCalled = true;
      },
    } as any;

    middleware(req, res, () => {
      throw new Error('Should not call next()');
    });

    expect(endCalled).toBe(true);
  });

  it('should accept ApiKey header format', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let nextCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { authorization: `ApiKey ${testUser.apiKey}` },
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user?.id).toBe(testUser.id);
    expect(req.user?.email).toBe(testUser.email);
  });

  it('should reject invalid API key', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let endCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { authorization: 'ApiKey invalid-key-uuid' },
      on: () => {},
    } as any;
    const res = {
      writeHead: (status: number) => {
        expect(status).toBe(401);
      },
      end: () => {
        endCalled = true;
      },
    } as any;

    middleware(req, res, () => {
      throw new Error('Should not call next()');
    });

    expect(endCalled).toBe(true);
  });

  it('should accept legacy X-API-Key header', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let nextCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { 'x-api-key': testUser.apiKey },
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user?.id).toBe(testUser.id);
  });

  it('should reject invalid X-API-Key header', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let endCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { 'x-api-key': 'invalid-key' },
      on: () => {},
    } as any;
    const res = {
      writeHead: (status: number) => {
        expect(status).toBe(401);
      },
      end: () => {
        endCalled = true;
      },
    } as any;

    middleware(req, res, () => {
      throw new Error('Should not call next()');
    });

    expect(endCalled).toBe(true);
  });

  it('should handle X-API-Key as array', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let nextCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: { 'x-api-key': [testUser.apiKey, 'other'] },
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user?.id).toBe(testUser.id);
  });

  it('should prioritize Bearer token over API key', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    const otherUser = userStore.createUser('other@example.com', 'enterprise');
    const token = createJwt(
      { id: otherUser.id, email: otherUser.email, tier: otherUser.tier },
      JWT_SECRET,
    );

    let nextCalled = false;
    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: {
        authorization: `Bearer ${token}`,
        'x-api-key': testUser.apiKey, // This should be ignored
      },
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
    expect(req.user?.id).toBe(otherUser.id); // Bearer token used, not API key
    expect(req.user?.tier).toBe('enterprise');
  });

  it('should respond with JSON on 401', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let responseBody = '';

    const req: AuthenticatedRequest = {
      url: '/api/trades',
      headers: {},
      on: () => {},
    } as any;
    const res = {
      writeHead: (status: number, headers: Record<string, string>) => {
        expect(status).toBe(401);
        expect(headers['Content-Type']).toBe('application/json');
      },
      end: (body: string) => {
        responseBody = body;
      },
    } as any;

    middleware(req, res, () => {});

    const json = JSON.parse(responseBody);
    expect(json.error).toBe('Unauthorized');
    expect(json.message).toBeTruthy();
  });

  it('should handle webhook endpoint as public', () => {
    const middleware = createAuthMiddleware(userStore, JWT_SECRET);
    let nextCalled = false;

    const req: AuthenticatedRequest = {
      url: '/api/webhooks/polar',
      headers: {},
      on: () => {},
    } as any;
    const res = {
      writeHead: () => {},
      end: () => {},
    } as any;

    middleware(req, res, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);
  });
});
