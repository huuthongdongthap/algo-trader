/**
 * Audit Log Service
 * ROIaaS Phase 6 - Complete governance system with retention, batch ops, and exports
 */

import { config } from '../config/env';
import { AuditLogExporter } from './exporters';
import { AuditLogRetention } from './retention';
import { AuditLogValidators } from './validators';
import { AuditLogBatchWriter, type BatchWriteEntry, type BatchWriteResult } from './batch-writer';

export interface AuditLog {
  id: string;
  licenseId: string;
  event: AuditEventType;
  tier?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export type AuditEventType =
  | 'created'
  | 'activated'
  | 'revoked'
  | 'api_call'
  | 'ml_feature'
  | 'rate_limit'
  | 'deleted'
  | 'suspension_warning'
  | 'suspended'
  | 'reinstated';

export interface AuditLogFilters {
  licenseId?: string;
  eventType?: AuditEventType | 'all';
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

// Re-export types from batch-writer
export type { BatchWriteEntry, BatchWriteResult };

export class AuditLogService {
  private static instance: AuditLogService;
  private logs: Map<string, AuditLog> = new Map();
  private licenseLogs: Map<string, AuditLog[]> = new Map();
  private retentionDays: number;
  private batchSize: number;

  private constructor() {
    this.retentionDays = parseInt(config.AUDIT_RETENTION_DAYS || '90', 10);
    this.batchSize = parseInt(config.AUDIT_BATCH_SIZE || '100', 10);
  }

  static getInstance(): AuditLogService {
    if (!AuditLogService.instance) {
      AuditLogService.instance = new AuditLogService();
    }
    return AuditLogService.instance;
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  getBatchSize(): number {
    return this.batchSize;
  }

  async log(
    licenseId: string,
    event: AuditEventType,
    options?: {
      tier?: string;
      ip?: string;
      metadata?: Record<string, unknown>;
    }
  ): Promise<AuditLog> {
    const id = `audit_${this.generateId()}`;
    const now = new Date().toISOString();

    const log: AuditLog = {
      id,
      licenseId,
      event,
      tier: options?.tier,
      ip: options?.ip,
      metadata: options?.metadata,
      createdAt: now,
    };

    this.logs.set(id, log);

    if (!this.licenseLogs.has(licenseId)) {
      this.licenseLogs.set(licenseId, []);
    }
    this.licenseLogs.get(licenseId)?.push(log);

    return log;
  }

  async getLogsByLicense(licenseId: string, filters: AuditLogFilters = {}): Promise<AuditLog[]> {
    let logs = this.licenseLogs.get(licenseId) || [];
    return AuditLogValidators.filterLogs(logs, { ...filters, licenseId });
  }

  async getAllLogs(filters: AuditLogFilters = {}): Promise<AuditLog[]> {
    let logs = Array.from(this.logs.values());
    return AuditLogValidators.filterLogs(logs, filters);
  }

  async getRecentActivity(limit = 10): Promise<AuditLog[]> {
    return AuditLogValidators.getRecentActivity(Array.from(this.logs.values()), limit);
  }

  async logApiCall(
    licenseId: string,
    endpoint: string,
    options?: { ip?: string; tier?: string }
  ): Promise<AuditLog> {
    return this.log(licenseId, 'api_call', {
      tier: options?.tier,
      ip: options?.ip,
      metadata: { endpoint },
    });
  }

  async logMlFeature(
    licenseId: string,
    feature: string,
    options?: { ip?: string; tier?: string }
  ): Promise<AuditLog> {
    return this.log(licenseId, 'ml_feature', {
      tier: options?.tier,
      ip: options?.ip,
      metadata: { feature },
    });
  }

  async logRateLimit(
    licenseId: string,
    limit: number,
    current: number,
    options?: { ip?: string; tier?: string }
  ): Promise<AuditLog> {
    return this.log(licenseId, 'rate_limit', {
      tier: options?.tier,
      ip: options?.ip,
      metadata: { limit, current },
    });
  }

  // Batch write audit logs
  async batchWrite(entries: BatchWriteEntry[]): Promise<BatchWriteResult> {
    return AuditLogBatchWriter.write(entries, this.batchSize, async (entry) => {
      await this.log(entry.licenseId, entry.event, {
        tier: entry.tier,
        ip: entry.ip,
        metadata: entry.metadata,
      });
    });
  }

  getExpiredLogIds(): string[] {
    return AuditLogRetention.getExpiredLogIds(this.logs, this.retentionDays);
  }

  async cleanupExpiredLogs(): Promise<{ removed: number; cutoffDate: string }> {
    return AuditLogRetention.cleanupExpiredLogs(this.logs, this.licenseLogs, this.retentionDays);
  }

  exportToCsv(logs: AuditLog[]): string {
    return AuditLogExporter.toCsv(logs);
  }

  exportToJson(logs: AuditLog[]): string {
    return AuditLogExporter.toJson(logs);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
