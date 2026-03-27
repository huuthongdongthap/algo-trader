/**
 * Usage Tracking Middleware
 * ROIaaS Phase 4 - Auto-track API calls on every request
 * Integrated with Phase 6 - Audit Logging
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify';
import { UsageMeteringService } from '../metering/usage-metering-service';
import { LicenseService } from '../billing/license-service';
import { AuditLogService } from '../audit/audit-log-service';

export interface UsageTrackingOptions {
  enabled: boolean;
  excludePaths?: string[];
  includeComputeTiming?: boolean;
  enableAuditLogging?: boolean;
}

const DEFAULT_EXCLUDE_PATHS = ['/health', '/ready', '/metrics', '/api/v1/licenses'];

export const usageTrackingPlugin: FastifyPluginAsync<UsageTrackingOptions> = async (
  fastify,
  options
) => {
  const {
    enabled,
    excludePaths = DEFAULT_EXCLUDE_PATHS,
    includeComputeTiming = false,
    enableAuditLogging = true,
  } = options;
  const meteringService = UsageMeteringService.getInstance();
  const licenseService = LicenseService.getInstance();
  const auditService = AuditLogService.getInstance();

  if (!enabled) {
    fastify.log.info('Usage tracking disabled');
    return;
  }

  fastify.addHook('onResponse', async (request, reply) => {
    const route = request.routeOptions.url || request.url;

    if (excludePaths.some((path) => route.startsWith(path))) {
      return;
    }

    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return;
    }

    const license = licenseService.getLicenseByKey(apiKey);
    if (!license) {
      return;
    }

    try {
      const startTime = includeComputeTiming ? Date.now() : undefined;

      await meteringService.trackApiCall(
        license.key,
        license.tier,
        route,
        license.userId
      );

      // Log audit event for API calls (Phase 6 integration)
      if (enableAuditLogging) {
        await auditService.logApiCall(license.id, route, {
          ip: request.ip,
          tier: license.tier,
        });
      }

      if (includeComputeTiming && startTime !== undefined) {
        const elapsed = Date.now() - startTime;
        fastify.log.debug({
          licenseKey: license.key,
          endpoint: route,
          computeMs: elapsed,
        }, 'API call tracked');
      }
    } catch (error) {
      fastify.log.error({ error, licenseKey: license.key }, 'Failed to track API call');
    }
  });

  fastify.decorateRequest('getUsageStatus', function (this: FastifyRequest) {
    const apiKey = this.headers['x-api-key'] as string | undefined;
    if (!apiKey) {
      return null;
    }

    const license = licenseService.getLicenseByKey(apiKey);
    if (!license) {
      return null;
    }

    return meteringService.getUsageStatus(license.key, license.tier);
  });

  fastify.log.info('Usage tracking middleware initialized');
};

export function getEventTypeInfo(
  method: string,
  url: string
): { type: string; units: number } {
  if (url.startsWith('/api/ml') || url.startsWith('/api/predict')) {
    return { type: 'ml_inference', units: 1 };
  }

  if (url.startsWith('/api/backtest') && method === 'POST') {
    return { type: 'backtest_run', units: 1 };
  }

  if (
    (url.startsWith('/api/trade') || url.startsWith('/api/orders')) &&
    (method === 'POST' || method === 'PUT')
  ) {
    return { type: 'trade_execution', units: 1 };
  }

  if (url.startsWith('/api/strategy')) {
    return { type: 'strategy_execution', units: 1 };
  }

  return { type: 'api_call', units: 1 };
}
