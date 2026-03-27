/**
 * License Validation Middleware
 * ROIaaS Phase 2 - RaaS gate middleware for license enforcement
 */

import { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { LicenseService } from '../billing/license-service';
import { LicenseTier, LicenseStatus } from '../types/license';

const PUBLIC_PATHS = ['/health', '/ready', '/metrics', '/api/v1/licenses'];

export interface LicenseAuthResult {
  licenseId: string;
  tier: LicenseTier;
  isValid: boolean;
  error?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    licenseAuth?: LicenseAuthResult;
    getLicenseTier: () => LicenseTier | undefined;
    isLicenseValid: () => boolean;
  }
}

export async function licenseValidationPlugin(fastify: FastifyInstance) {
  const licenseService = LicenseService.getInstance();

  fastify.decorateRequest('getLicenseTier', function (this: FastifyRequest) {
    return this.licenseAuth?.isValid ? this.licenseAuth.tier : undefined;
  });

  fastify.decorateRequest('isLicenseValid', function (this: FastifyRequest) {
    return !!this.licenseAuth?.isValid;
  });

  fastify.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url || '';

    if (PUBLIC_PATHS.some((path) => route.startsWith(path))) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      request.licenseAuth = {
        licenseId: '',
        tier: LicenseTier.FREE,
        isValid: false,
        error: 'Missing API key',
      };
      return;
    }

    const license = licenseService.getLicenseByKey(apiKey);

    if (!license) {
      request.licenseAuth = {
        licenseId: '',
        tier: LicenseTier.FREE,
        isValid: false,
        error: 'Invalid license key',
      };
      return;
    }

    if (license.status !== LicenseStatus.ACTIVE) {
      request.licenseAuth = {
        licenseId: license.id,
        tier: license.tier,
        isValid: false,
        error: `License is ${license.status}`,
      };
      return;
    }

    if (license.expiresAt && new Date(license.expiresAt) < new Date()) {
      request.licenseAuth = {
        licenseId: license.id,
        tier: license.tier,
        isValid: false,
        error: 'License expired',
      };
      return;
    }

    request.licenseAuth = {
      licenseId: license.id,
      tier: license.tier,
      isValid: true,
    };
  });
}

export function licenseValidationMiddleware(
  request: FastifyRequest,
  reply: FastifyReply,
  done: () => void
) {
  const licenseService = LicenseService.getInstance();
  const apiKey = request.headers['x-api-key'] as string | undefined;

  if (!apiKey) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'API key required',
    });
  }

  const license = licenseService.getLicenseByKey(apiKey);

  if (!license) {
    return reply.code(401).send({
      error: 'Unauthorized',
      message: 'Invalid license key',
    });
  }

  if (license.status !== LicenseStatus.ACTIVE) {
    return reply.code(403).send({
      error: 'Forbidden',
      message: `License ${license.status}`,
    });
  }

  done();
}
