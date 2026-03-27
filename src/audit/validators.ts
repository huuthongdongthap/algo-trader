/**
 * Audit Log Validators
 * Validation and utility functions for audit logs
 */

import type { AuditLog, AuditLogFilters, AuditEventType } from './audit-log-service';

export class AuditLogValidators {
  /**
   * Filter logs by criteria
   */
  static filterLogs(logs: AuditLog[], filters: AuditLogFilters): AuditLog[] {
    let filtered = [...logs];

    if (filters.licenseId) {
      filtered = filtered.filter((l) => l.licenseId === filters.licenseId);
    }

    if (filters.eventType && filters.eventType !== 'all') {
      filtered = filtered.filter((l) => l.event === filters.eventType);
    }

    if (filters.startDate) {
      filtered = filtered.filter((l) => l.createdAt >= filters.startDate!);
    }

    if (filters.endDate) {
      filtered = filtered.filter((l) => l.createdAt <= filters.endDate!);
    }

    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const skip = filters.skip || 0;
    const limit = filters.limit || 100;

    return filtered.slice(skip, skip + limit);
  }

  /**
   * Get recent activity sorted by date
   */
  static getRecentActivity(logs: AuditLog[], limit = 10): AuditLog[] {
    return [...logs]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }
}

/**
 * Create event-specific log options
 */
export function createLogOptions(
  options?: { ip?: string; tier?: string } & Record<string, unknown>
): { tier?: string; ip?: string; metadata?: Record<string, unknown> } {
  const { ip, tier, ...rest } = options || {};
  return {
    tier,
    ip,
    metadata: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
