/**
 * Audit Log Service Tests
 * ROIaaS Phase 6 - Complete governance system with retention, batch ops, and exports tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogService } from '../audit-log-service';
import type { AuditLogFilters } from '../audit-log-service';

describe('AuditLogService', () => {
  let service: AuditLogService;

  beforeEach(() => {
    service = AuditLogService.getInstance();
    (service as any).logs.clear();
    (service as any).licenseLogs.clear();
  });

  describe('log', () => {
    it('should create audit log entry', async () => {
      const log = await service.log('lic-123', 'created');

      expect(log.id).toMatch(/^audit_/);
      expect(log.licenseId).toBe('lic-123');
      expect(log.event).toBe('created');
      expect(log.createdAt).toBeDefined();
    });

    it('should include optional metadata', async () => {
      const log = await service.log('lic-123', 'activated', {
        tier: 'PRO',
        ip: '192.168.1.1',
        metadata: { subscriptionId: 'sub-123' },
      });

      expect(log.tier).toBe('PRO');
      expect(log.ip).toBe('192.168.1.1');
      expect(log.metadata?.subscriptionId).toBe('sub-123');
    });
  });

  describe('getLogsByLicense', () => {
    it('should get logs by license id', async () => {
      await service.log('lic-123', 'created');
      await service.log('lic-123', 'activated');
      await service.log('lic-456', 'created');

      const logs = await service.getLogsByLicense('lic-123');

      expect(logs.length).toBe(2);
      expect(logs.every((l) => l.licenseId === 'lic-123')).toBe(true);
    });

    it('should filter by event type', async () => {
      await service.log('lic-123', 'created');
      await service.log('lic-123', 'activated');
      await service.log('lic-123', 'api_call');

      const logs = await service.getLogsByLicense('lic-123', { eventType: 'created' });

      expect(logs.length).toBe(1);
      expect(logs[0].event).toBe('created');
    });

    it('should filter by date range', async () => {
      const now = new Date();
      const startDate = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
      const endDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days in future

      await service.log('lic-123', 'created');

      const logs = await service.getLogsByLicense('lic-123', {
        startDate,
        endDate,
      });

      expect(logs.length).toBe(1);
    });

    it('should paginate with skip and limit', async () => {
      for (let i = 0; i < 15; i++) {
        await service.log('lic-123', 'api_call');
      }

      const page1 = await service.getLogsByLicense('lic-123', { skip: 0, limit: 10 });
      const page2 = await service.getLogsByLicense('lic-123', { skip: 10, limit: 10 });

      expect(page1.length).toBe(10);
      expect(page2.length).toBe(5);
    });
  });

  describe('getAllLogs', () => {
    it('should get all logs', async () => {
      await service.log('lic-123', 'created');
      await service.log('lic-456', 'activated');

      const logs = await service.getAllLogs();

      expect(logs.length).toBe(2);
    });

    it('should filter by license id', async () => {
      await service.log('lic-123', 'created');
      await service.log('lic-456', 'activated');

      const logs = await service.getAllLogs({ licenseId: 'lic-123' });

      expect(logs.length).toBe(1);
      expect(logs[0].licenseId).toBe('lic-123');
    });

    it('should sort by createdAt descending', async () => {
      const log1 = await service.log('lic-123', 'created');
      await new Promise((resolve) => setTimeout(resolve, 10));
      const log2 = await service.log('lic-456', 'created');

      const logs = await service.getAllLogs();

      expect(logs[0].createdAt).toBe(log2.createdAt);
      expect(logs[1].createdAt).toBe(log1.createdAt);
    });
  });

  describe('getRecentActivity', () => {
    it('should get recent logs sorted by date', async () => {
      for (let i = 0; i < 15; i++) {
        await service.log(`lic-${i}`, 'created');
      }

      const recent = await service.getRecentActivity(10);

      expect(recent.length).toBe(10);
    });
  });

  describe('logApiCall', () => {
    it('should log API call event', async () => {
      const log = await service.logApiCall('lic-123', '/api/v1/trades', {
        ip: '192.168.1.1',
        tier: 'PRO',
      });

      expect(log.event).toBe('api_call');
      expect(log.metadata?.endpoint).toBe('/api/v1/trades');
      expect(log.ip).toBe('192.168.1.1');
    });
  });

  describe('logMlFeature', () => {
    it('should log ML feature usage', async () => {
      const log = await service.logMlFeature('lic-123', 'hyperparameter_tuning', {
        tier: 'ENTERPRISE',
      });

      expect(log.event).toBe('ml_feature');
      expect(log.metadata?.feature).toBe('hyperparameter_tuning');
      expect(log.tier).toBe('ENTERPRISE');
    });
  });

  describe('logRateLimit', () => {
    it('should log rate limit event', async () => {
      const log = await service.logRateLimit('lic-123', 100, 95, {
        tier: 'FREE',
        ip: '192.168.1.1',
      });

      expect(log.event).toBe('rate_limit');
      expect(log.metadata?.limit).toBe(100);
      expect(log.metadata?.current).toBe(95);
    });
  });

  describe('batchWrite', () => {
    it('should write multiple logs in batch', async () => {
      const entries = [
        { licenseId: 'lic-1', event: 'created' as const },
        { licenseId: 'lic-2', event: 'created' as const },
        { licenseId: 'lic-3', event: 'created' as const },
      ];

      const result = await service.batchWrite(entries);

      expect(result.success).toBe(3);
      expect(result.failed).toBe(0);
      expect(result.errors.length).toBe(0);
    });

    it('should respect batch size limit', async () => {
      const entries = Array(150).fill({ licenseId: 'lic-1', event: 'created' as const });

      const result = await service.batchWrite(entries);

      expect(result.success).toBeLessThanOrEqual(100);
      expect(result.failed).toBeGreaterThan(0);
    });
  });

  describe('getExpiredLogIds', () => {
    it('should return empty array when no logs expired', () => {
      const expiredIds = service.getExpiredLogIds();
      expect(expiredIds.length).toBe(0);
    });
  });

  describe('cleanupExpiredLogs', () => {
    it('should remove expired logs', async () => {
      await service.log('lic-123', 'created');

      const result = await service.cleanupExpiredLogs();

      expect(result).toHaveProperty('removed');
      expect(result).toHaveProperty('cutoffDate');
    });
  });

  describe('exportToCsv', () => {
    it('should export logs as CSV', async () => {
      const log1 = await service.log('lic-123', 'created', { tier: 'PRO' });
      const log2 = await service.log('lic-456', 'activated', { tier: 'FREE' });

      const csv = service.exportToCsv([log1, log2]);

      expect(csv).toContain('id,licenseId,event,tier,ip,metadata,createdAt');
      expect(csv).toContain('lic-123');
      expect(csv).toContain('lic-456');
    });

    it('should handle empty logs array', () => {
      const csv = service.exportToCsv([]);
      expect(csv).toContain('id,licenseId,event,tier,ip,metadata,createdAt');
    });
  });

  describe('exportToJson', () => {
    it('should export logs as JSON', async () => {
      const log = await service.log('lic-123', 'created', { tier: 'PRO' });

      const json = service.exportToJson([log]);

      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].id).toBe(log.id);
      expect(parsed[0].licenseId).toBe('lic-123');
    });
  });

  describe('getRetentionDays', () => {
    it('should return retention days config', () => {
      const retentionDays = service.getRetentionDays();
      expect(retentionDays).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getBatchSize', () => {
    it('should return batch size config', () => {
      const batchSize = service.getBatchSize();
      expect(batchSize).toBeGreaterThanOrEqual(1);
    });
  });
});
