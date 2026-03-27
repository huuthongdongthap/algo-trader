/**
 * Admin Authentication Middleware
 * ROIaaS Phase 2 - Admin API key validation
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

const ADMIN_API_KEYS = new Set<string>(
  (process.env.ADMIN_API_KEYS || '').split(',').filter(Boolean)
);

const DEFAULT_ADMIN_KEY = process.env.ADMIN_API_KEY;

if (DEFAULT_ADMIN_KEY) {
  ADMIN_API_KEYS.add(DEFAULT_ADMIN_KEY);
}

export interface AdminAuthDecorator {
  isAdminAuthenticated(): boolean;
  getAdminApiKey(): string | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    isAdminAuthenticated: () => boolean;
    getAdminApiKey: () => string | undefined;
  }
}

export async function adminAuthPlugin(fastify: FastifyInstance) {
  fastify.decorateRequest('isAdminAuthenticated', function (this: FastifyRequest) {
    const apiKey = this.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return false;
    }
    return ADMIN_API_KEYS.has(apiKey);
  });

  fastify.decorateRequest('getAdminApiKey', function (this: FastifyRequest) {
    return this.headers['x-api-key'] as string | undefined;
  });

  fastify.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url || '';
    if (route.startsWith('/api/v1/licenses')) {
      if (!request.isAdminAuthenticated()) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: 'Valid X-API-Key header required',
        });
      }
    }
  });
}

export function adminAuthMiddleware(request: FastifyRequest, reply: FastifyReply, done: () => void) {
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'X-API-Key header missing',
    });
  }

  if (!ADMIN_API_KEYS.has(apiKey)) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid API key',
    });
  }

  done();
}
