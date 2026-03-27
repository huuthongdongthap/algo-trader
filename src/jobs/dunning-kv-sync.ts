#!/usr/bin/env ts-node
/**
 * Dunning KV Sync Job
 * ROIaaS Phase 5 - Daily dunning sync for license suspension
 *
 * Runs daily to:
 * - Check licenses past grace period
 * - Suspend licenses with max retries exceeded
 * - Log suspension events
 *
 * Usage:
 *   pnpm run sync-dunning-kv
 *   # Or via cron: 0 2 * * * (daily at 2 AM)
 */

import { DunningService } from '../billing/dunning-service';
import { LicenseService } from '../billing/license-service';
import { AuditLogService } from '../audit/audit-log-service';
import { logger } from '../utils/logger';

interface SyncResult {
  timestamp: string;
  checked: number;
  suspended: string[];
  errors: string[];
}

async function runDunningSync(): Promise<SyncResult> {
  const result: SyncResult = {
    timestamp: new Date().toISOString(),
    checked: 0,
    suspended: [],
    errors: [],
  };

  try {
    const dunningService = DunningService.getInstance();
    const licenseService = LicenseService.getInstance();
    const auditService = AuditLogService.getInstance();

    logger.info('[Dunning Sync] Starting daily dunning sync...');
    logger.info(`[Dunning Sync] Timestamp: ${result.timestamp}`);

    // Check and suspend licenses past grace period
    const suspensionResult = await dunningService.checkAndSuspendExpiredGracePeriods();
    result.checked = suspensionResult.checked;
    result.suspended = suspensionResult.suspended;

    logger.info(`[Dunning Sync] Checked ${result.checked} dunning records`);
    logger.info(`[Dunning Sync] Suspended ${result.suspended.length} licenses`);

    if (result.suspended.length > 0) {
      logger.info(`[Dunning Sync] Suspended license IDs: ${result.suspended.join(', ')}`);

      // Log batch suspension event
      await auditService.log('system', 'rate_limit', {
        metadata: {
          eventType: 'dunning_sync_batch',
          suspendedCount: result.suspended.length,
          suspendedLicenseIds: result.suspended,
          syncTimestamp: result.timestamp,
        },
      });
    }

    // Summary
    const allLicenses = await licenseService.listLicenses({ status: 'all' });
    const suspendedCount = allLicenses.licenses.filter(
      (l) => l.status === 'revoked'
    ).length;

    logger.info(`[Dunning Sync] Total suspended licenses: ${suspendedCount}`);
    logger.info('[Dunning Sync] Sync completed successfully');

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    result.errors.push(errorMessage);
    logger.error('[Dunning Sync] Error during sync:', errorMessage);

    return result;
  }
}

// Main execution
async function main() {
  logger.info('DUNNING KV SYNC - Daily License Suspension Check');

  const result = await runDunningSync();

  logger.info('SYNC SUMMARY', {
    timestamp: result.timestamp,
    checked: result.checked,
    suspended: result.suspended.length,
    errors: result.errors.length,
  });

  if (result.errors.length > 0) {
    logger.error('ERRORS:', { errors: result.errors });
    process.exit(1);
  }

  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('[Dunning Sync] Fatal error:', { error });
    process.exit(1);
  });
}

export { runDunningSync };
