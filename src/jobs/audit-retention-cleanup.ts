/**
 * Audit Retention Cleanup Job
 * ROIaaS Phase 6 - Daily cleanup of expired audit logs
 *
 * Runs daily to remove audit logs older than retention period (default: 90 days)
 * Configured via AUDIT_RETENTION_DAYS environment variable
 */

import { AuditLogService } from '../audit/audit-log-service';
import { logger } from '../utils/logger';

export class AuditRetentionCleanup {
  private static instance: AuditRetentionCleanup;
  private auditService: AuditLogService;
  private intervalId: NodeJS.Timeout | null = null;

  private constructor() {
    this.auditService = AuditLogService.getInstance();
  }

  static getInstance(): AuditRetentionCleanup {
    if (!AuditRetentionCleanup.instance) {
      AuditRetentionCleanup.instance = new AuditRetentionCleanup();
    }
    return AuditRetentionCleanup.instance;
  }

  /**
   * Start the cleanup job
   * Runs daily at midnight by default
   */
  start(scheduleMs: number = 24 * 60 * 60 * 1000): void {
    if (this.intervalId) {
      logger.info('Audit retention cleanup job already running');
      return;
    }

    logger.info(`[AuditRetentionCleanup] Starting daily cleanup job (interval: ${scheduleMs}ms)`);

    // Run cleanup immediately on start
    this.runCleanup();

    // Then run on schedule
    this.intervalId = setInterval(() => {
      this.runCleanup();
    }, scheduleMs);
  }

  /**
   * Stop the cleanup job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('[AuditRetentionCleanup] Cleanup job stopped');
    }
  }

  /**
   * Run cleanup manually
   * Returns cleanup statistics
   */
  async runCleanup(): Promise<{
    removed: number;
    cutoffDate: string;
    retentionDays: number;
    timestamp: string;
  }> {
    const retentionDays = this.auditService.getRetentionDays();
    const timestamp = new Date().toISOString();

    logger.info(`[AuditRetentionCleanup] Running cleanup (retention: ${retentionDays} days)`);

    try {
      const result = await this.auditService.cleanupExpiredLogs();

      logger.info(
        `[AuditRetentionCleanup] Cleanup complete: removed ${result.removed} logs, cutoff: ${result.cutoffDate}`
      );

      return {
        ...result,
        retentionDays,
        timestamp,
      };
    } catch (error) {
      logger.error('[AuditRetentionCleanup] Cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Get cleanup statistics without running cleanup
   */
  getCleanupPreview(): {
    expiredCount: number;
    retentionDays: number;
    cutoffDate: string;
  } {
    const retentionDays = this.auditService.getRetentionDays();
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const expiredLogIds = this.auditService.getExpiredLogIds();

    return {
      expiredCount: expiredLogIds.length,
      retentionDays,
      cutoffDate: cutoffDate.toISOString(),
    };
  }
}

// Export singleton for easy access
export const auditRetentionCleanup = AuditRetentionCleanup.getInstance();
