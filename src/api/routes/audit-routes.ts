/**
 * Audit Logs API Routes
 *
 * Admin-only endpoints for querying audit logs.
 * Requires admin JWT scope for all operations.
 *
 * Endpoints:
 * - GET /api/v1/audit/logs?licenseId=xxx&eventType=xxx&startDate=xxx&endDate=xxx&limit=xxx&skip=xxx
 * - GET /api/v1/audit/export?format=csv|json&licenseId=xxx&eventType=xxx&startDate=xxx&endDate=xxx
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuditLogService, AuditLogFilters, AuditEventType } from '../../audit/audit-log-service';
import { LicenseService } from '../../billing/license-service';

interface AuditLogQuery {
  licenseId?: string;
  eventType?: AuditEventType | 'all';
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

interface AuditExportQuery {
  format?: 'csv' | 'json';
  licenseId?: string;
  eventType?: AuditEventType | 'all';
  startDate?: string;
  endDate?: string;
}

interface AuditParams {
  id: string;
}

export async function registerAuditRoutes(server: FastifyInstance) {
  const auditService = AuditLogService.getInstance();
  const licenseService = LicenseService.getInstance();

  /**
   * GET /api/v1/audit/logs
   * Query audit logs with filters
   */
  server.get(
    '/logs',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            licenseId: { type: 'string' },
            eventType: { type: 'string', enum: ['all', 'created', 'activated', 'revoked', 'api_call', 'ml_feature', 'rate_limit', 'deleted', 'suspension_warning', 'suspended', 'reinstated'] },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            limit: { type: 'number', default: 100, maximum: 1000 },
            skip: { type: 'number', default: 0 },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: AuditLogQuery }>, reply: FastifyReply) => {
      const filters: AuditLogFilters = {
        licenseId: request.query.licenseId,
        eventType: request.query.eventType,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        limit: request.query.limit || 100,
        skip: request.query.skip || 0,
      };

      const logs = await auditService.getAllLogs(filters);

      return reply.send({
        logs,
        total: logs.length,
        hasMore: logs.length === filters.limit,
      });
    }
  );

  /**
   * GET /api/v1/audit/logs/:id
   * Get specific audit log by ID
   */
  server.get(
    '/logs/:id',
    async (request: FastifyRequest<{ Params: AuditParams }>, reply: FastifyReply) => {
      // This would need a method to get single log by ID
      // For now, return not implemented
      return reply.code(501).send({
        error: 'Not Implemented',
        message: 'Get single audit log by ID is not implemented',
      });
    }
  );

  /**
   * GET /api/v1/audit/export
   * Export audit logs as CSV or JSON
   */
  server.get(
    '/export',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['csv', 'json'], default: 'json' },
            licenseId: { type: 'string' },
            eventType: { type: 'string', enum: ['all', 'created', 'activated', 'revoked', 'api_call', 'ml_feature', 'rate_limit', 'deleted', 'suspension_warning', 'suspended', 'reinstated'] },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request: FastifyRequest<{ Querystring: AuditExportQuery }>, reply: FastifyReply) => {
      const format = request.query.format || 'json';
      const filters: AuditLogFilters = {
        licenseId: request.query.licenseId,
        eventType: request.query.eventType,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
        limit: 10000, // Higher limit for exports
      };

      const logs = await auditService.getAllLogs(filters);
      let content: string;
      let contentType: string;

      if (format === 'csv') {
        content = auditService.exportToCsv(logs);
        contentType = 'text/csv';
      } else {
        content = auditService.exportToJson(logs);
        contentType = 'application/json';
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `audit-logs-${timestamp}.${format}`;

      return reply
        .header('Content-Type', contentType)
        .header('Content-Disposition', `attachment; filename="${filename}"`)
        .send(content);
    }
  );

  /**
   * GET /api/v1/licenses/:id/audit
   * Get audit logs for a specific license
   * (This is also available in license-routes.ts, kept here for consistency)
   */
  server.get(
    '/license/:id/audit',
    async (request: FastifyRequest<{ Params: AuditParams }>, reply: FastifyReply) => {
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

  server.log.info('Audit routes registered');
}
