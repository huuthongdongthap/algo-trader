/**
 * Audit Log Batch Writer
 * Batch write functionality for audit logs
 */

import type { AuditEventType } from './audit-log-service';

export interface BatchWriteEntry {
  licenseId: string;
  event: AuditEventType;
  tier?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface BatchWriteResult {
  success: number;
  failed: number;
  errors: string[];
}

export class AuditLogBatchWriter {
  /**
   * Write multiple log entries up to batch size limit
   */
  static async write(
    entries: BatchWriteEntry[],
    batchSize: number,
    logFn: (entry: BatchWriteEntry) => Promise<void>
  ): Promise<BatchWriteResult> {
    const result: BatchWriteResult = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < entries.length; i++) {
      if (i >= batchSize) {
        result.failed += entries.length - i;
        result.errors.push(`Batch size limit (${batchSize}) exceeded`);
        break;
      }

      try {
        await logFn(entries[i]);
        result.success++;
      } catch (error) {
        result.failed++;
        result.errors.push(`Failed to log event ${entries[i].event}: ${String(error)}`);
      }
    }

    return result;
  }
}
