/**
 * Audit Log Exporters
 * CSV and JSON export functionality for audit logs
 */

import type { AuditLog } from './audit-log-service';

export class AuditLogExporter {
  /**
   * Export logs as CSV format
   */
  static toCsv(logs: AuditLog[]): string {
    const headers = ['id', 'licenseId', 'event', 'tier', 'ip', 'metadata', 'createdAt'];
    const csvRows: string[] = [headers.join(',')];

    for (const log of logs) {
      const row = [
        log.id,
        log.licenseId,
        log.event,
        log.tier || '',
        log.ip || '',
        log.metadata ? JSON.stringify(log.metadata) : '',
        log.createdAt,
      ];
      csvRows.push(row.join(','));
    }

    return csvRows.join('\n');
  }

  /**
   * Export logs as JSON format
   */
  static toJson(logs: AuditLog[]): string {
    return JSON.stringify(logs, null, 2);
  }
}
