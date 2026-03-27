/**
 * Audit Log Retention
 * Retention policy and cleanup functionality for audit logs
 */

import type { AuditLog } from './audit-log-service';

export class AuditLogRetention {
  /**
   * Get logs older than retention period
   * Returns list of log IDs eligible for cleanup
   */
  static getExpiredLogIds(logs: Map<string, AuditLog>, retentionDays: number): string[] {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffISOString = cutoffDate.toISOString();

    const expiredIds: string[] = [];

    for (const [id, log] of logs.entries()) {
      if (log.createdAt < cutoffISOString) {
        expiredIds.push(id);
      }
    }

    return expiredIds;
  }

  /**
   * Cleanup expired logs based on retention policy
   * Returns number of logs removed and cutoff date
   */
  static cleanupExpiredLogs(
    logs: Map<string, AuditLog>,
    licenseLogs: Map<string, AuditLog[]>,
    retentionDays: number
  ): {
    removed: number;
    cutoffDate: string;
  } {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
    const cutoffISOString = cutoffDate.toISOString();

    let removed = 0;

    // Remove from main logs map
    for (const [id, log] of logs.entries()) {
      if (log.createdAt < cutoffISOString) {
        logs.delete(id);
        removed++;
      }
    }

    // Clean up licenseLogs map
    for (const [licenseId, logsList] of licenseLogs.entries()) {
      const filteredLogs = logsList.filter((log) => log.createdAt >= cutoffISOString);
      if (filteredLogs.length !== logsList.length) {
        licenseLogs.set(licenseId, filteredLogs);
      }
      // Remove empty license entries
      if (filteredLogs.length === 0) {
        licenseLogs.delete(licenseId);
      }
    }

    return {
      removed,
      cutoffDate: cutoffISOString,
    };
  }
}
