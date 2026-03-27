/**
 * Dunning Workflow
 * License suspension/reinstatement workflow helpers
 */

import { LicenseService } from '../license-service';
import { AuditLogService } from '../../audit/audit-log-service';
import { LicenseStatus } from '../../types/license';
import type { DunningRecord, DunningConfig } from '../dunning-service';

export class DunningWorkflow {
  static async suspendLicense(
    licenseId: string,
    record: DunningRecord,
    licenseService: LicenseService,
    auditService: AuditLogService,
    dunningRecords: Map<string, DunningRecord>
  ): Promise<void> {
    const license = licenseService.getLicense(licenseId);
    if (!license) return;

    license.status = LicenseStatus.REVOKED;
    license.updatedAt = new Date().toISOString();

    record.status = 'suspended';
    record.suspensionDate = new Date().toISOString();
    record.updatedAt = new Date().toISOString();

    dunningRecords.set(record.id, record);

    await auditService.log(licenseId, 'revoked', {
      metadata: {
        eventType: 'suspended',
        retryCount: record.retryCount,
        reason: 'payment_failed_dunning',
      },
    });
  }

  static async reinstateLicense(
    licenseId: string,
    record: DunningRecord,
    licenseService: LicenseService,
    auditService: AuditLogService,
    dunningRecords: Map<string, DunningRecord>
  ): Promise<void> {
    const license = licenseService.getLicense(licenseId);
    if (!license) return;

    license.status = LicenseStatus.ACTIVE;
    license.updatedAt = new Date().toISOString();

    record.status = 'reinstated';
    record.reinstatementDate = new Date().toISOString();
    record.updatedAt = new Date().toISOString();

    dunningRecords.set(record.id, record);

    await auditService.log(licenseId, 'activated', {
      metadata: {
        eventType: 'reinstated',
        reason: 'payment_success',
      },
    });
  }

  static getDaysSince(dateString: string): number {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  static shouldSuspend(
    retryCount: number,
    firstFailureDate: string,
    config: DunningConfig
  ): { shouldSuspend: boolean; daysSinceFirstFailure: number } {
    const daysSinceFirstFailure = this.getDaysSince(firstFailureDate);
    const shouldSuspend =
      retryCount >= config.maxRetries ||
      daysSinceFirstFailure >= config.gracePeriodDays;

    return { shouldSuspend, daysSinceFirstFailure };
  }

  static getDaysUntilSuspension(
    firstFailureDate: string,
    config: DunningConfig
  ): number {
    const daysSinceFirstFailure = this.getDaysSince(firstFailureDate);
    return Math.max(0, config.gracePeriodDays - daysSinceFirstFailure);
  }
}
