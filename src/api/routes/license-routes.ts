/**
 * License API Routes
 * ROIaaS Phase 2 - License Management API Endpoints
 *
 * Endpoints:
 * - GET    /api/v1/licenses          - List licenses (pagination)
 * - GET    /api/v1/licenses/:id      - Get single license
 * - POST   /api/v1/licenses          - Create license
 * - PATCH  /api/v1/licenses/:id/revoke - Revoke license
 * - DELETE /api/v1/licenses/:id      - Delete license
 * - GET    /api/v1/licenses/:id/audit - Get audit logs
 * - GET    /api/v1/licenses/analytics - Get aggregate analytics
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LicenseService } from '../../billing/license-service';
import { AuditLogService } from '../../audit/audit-log-service';
import { LicenseTier, LicenseStatus, CreateLicenseInput, LicenseFilters } from '../../types/license';

interface LicenseParams {
  id: string;
}

interface LicenseListQuery {
  take?: number;
  skip?: number;
  status?: LicenseStatus | 'all';
  tier?: LicenseTier | 'all';
}

export async function licenseRoutes(fastify: FastifyInstance) {
  const licenseService = LicenseService.getInstance();
  const auditService = AuditLogService.getInstance();

  fastify.get(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            take: { type: 'number', default: 10 },
            skip: { type: 'number', default: 0 },
            status: { type: 'string', enum: ['active', 'expired', 'revoked', 'all'] },
            tier: { type: 'string', enum: ['FREE', 'PRO', 'ENTERPRISE', 'all'] },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: LicenseListQuery }>, reply: FastifyReply) => {
      const filters: LicenseFilters = {
        take: request.query.take || 10,
        skip: request.query.skip || 0,
        status: request.query.status,
        tier: request.query.tier,
      };

      const result = await licenseService.listLicenses(filters);
      return reply.send(result);
    }
  );

  fastify.get(
    '/:id',
    async (request: FastifyRequest<{ Params: LicenseParams }>, reply: FastifyReply) => {
      const license = licenseService.getLicense(request.params.id);

      if (!license) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `License ${request.params.id} not found`,
        });
      }

      return reply.send(license);
    }
  );

  fastify.post(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'tier'],
          properties: {
            name: { type: 'string' },
            tier: { type: 'string', enum: ['FREE', 'PRO', 'ENTERPRISE'] },
            expiresAt: { type: 'string', format: 'date-time' },
            tenantId: { type: 'string' },
            domain: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: CreateLicenseInput }>,
      reply: FastifyReply
    ) => {
      const { name, tier, expiresAt, tenantId, domain } = request.body;

      const license = await licenseService.createLicense({
        name,
        tier: tier as LicenseTier,
        expiresAt,
        tenantId,
        domain,
      });

      await auditService.log(license.id, 'created', {
        tier: license.tier,
        metadata: { name },
      });

      return reply.code(201).send(license);
    }
  );

  fastify.patch(
    '/:id/revoke',
    async (request: FastifyRequest<{ Params: LicenseParams }>, reply: FastifyReply) => {
      const license = await licenseService.revokeLicense(request.params.id);

      if (!license) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `License ${request.params.id} not found`,
        });
      }

      await auditService.log(license.id, 'revoked', {
        tier: license.tier,
      });

      return reply.send(license);
    }
  );

  fastify.delete(
    '/:id',
    async (request: FastifyRequest<{ Params: LicenseParams }>, reply: FastifyReply) => {
      const license = licenseService.getLicense(request.params.id);

      if (!license) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `License ${request.params.id} not found`,
        });
      }

      await auditService.log(license.id, 'deleted', {
        tier: license.tier,
      });

      await licenseService.deleteLicense(request.params.id);

      return reply.code(204).send();
    }
  );

  fastify.get(
    '/:id/audit',
    async (request: FastifyRequest<{ Params: LicenseParams }>, reply: FastifyReply) => {
      const license = licenseService.getLicense(request.params.id);

      if (!license) {
        return reply.code(404).send({
          error: 'Not Found',
          message: `License ${request.params.id} not found`,
        });
      }

      const logs = await auditService.getLogsByLicense(request.params.id);

      return reply.send({ logs });
    }
  );

  fastify.get(
    '/analytics',
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const analytics = await licenseService.getAnalytics();
      return reply.send(analytics);
    }
  );
}
