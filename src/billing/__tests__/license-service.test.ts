/**
 * License Service Tests
 * ROIaaS Phase 2 - License CRUD and key generation tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LicenseService } from '../license-service';
import { LicenseTier, LicenseStatus, CreateLicenseInput } from '../../types/license';

describe('LicenseService', () => {
  let service: LicenseService;

  beforeEach(() => {
    // Get singleton instance and clear licenses
    service = LicenseService.getInstance();
    (service as any).licenses.clear();
  });

  describe('generateLicenseKey', () => {
    it('should generate license key with FREE tier prefix', () => {
      const key = service.generateLicenseKey(LicenseTier.FREE);
      expect(key).toMatch(/^RAAS-FREE-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should generate license key with PRO tier prefix', () => {
      const key = service.generateLicenseKey(LicenseTier.PRO);
      expect(key).toMatch(/^RAAS-RPP-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should generate license key with ENTERPRISE tier prefix', () => {
      const key = service.generateLicenseKey(LicenseTier.ENTERPRISE);
      expect(key).toMatch(/^RAAS-REP-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
    });

    it('should generate unique keys for multiple calls', () => {
      const keys = new Set();
      for (let i = 0; i < 10; i++) {
        keys.add(service.generateLicenseKey(LicenseTier.PRO));
      }
      expect(keys.size).toBe(10);
    });
  });

  describe('createLicense', () => {
    it('should create license with correct properties', async () => {
      const input: CreateLicenseInput = {
        name: 'Test License',
        tier: LicenseTier.PRO,
        tenantId: 'tenant-123',
        domain: 'example.com',
      };

      const license = await service.createLicense(input);

      expect(license.id).toMatch(/^lic_/);
      expect(license.name).toBe('Test License');
      expect(license.tier).toBe(LicenseTier.PRO);
      expect(license.status).toBe(LicenseStatus.ACTIVE);
      expect(license.key).toMatch(/^RAAS-RPP-[A-Z0-9]{8}-[A-Z0-9]{8}$/);
      expect(license.tenantId).toBe('tenant-123');
      expect(license.domain).toBe('example.com');
      expect(license.usageCount).toBe(0);
      expect(license.maxUsage).toBe(10000);
    });

    it('should set correct maxUsage for FREE tier', async () => {
      const license = await service.createLicense({
        name: 'Free License',
        tier: LicenseTier.FREE,
      });
      expect(license.maxUsage).toBe(100);
    });

    it('should set correct maxUsage for ENTERPRISE tier', async () => {
      const license = await service.createLicense({
        name: 'Enterprise License',
        tier: LicenseTier.ENTERPRISE,
      });
      expect(license.maxUsage).toBe(100000);
    });

    it('should set expiresAt if provided', async () => {
      const expiresAt = new Date('2027-12-31').toISOString();
      const license = await service.createLicense({
        name: 'Expiring License',
        tier: LicenseTier.PRO,
        expiresAt,
      });
      expect(license.expiresAt).toBe(expiresAt);
    });
  });

  describe('getLicense', () => {
    it('should get license by id', async () => {
      const created = await service.createLicense({
        name: 'Get Test',
        tier: LicenseTier.PRO,
      });

      const retrieved = service.getLicense(created.id);

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.key).toBe(created.key);
    });

    it('should return undefined for non-existent license', () => {
      const result = service.getLicense('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getLicenseByKey', () => {
    it('should get license by key', async () => {
      const created = await service.createLicense({
        name: 'Key Lookup Test',
        tier: LicenseTier.FREE,
      });

      const retrieved = service.getLicenseByKey(created.key);

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.name).toBe('Key Lookup Test');
    });

    it('should return undefined for non-existent key', () => {
      const result = service.getLicenseByKey('NON-EXISTENT-KEY');
      expect(result).toBeUndefined();
    });
  });

  describe('getLicenseBySubscription', () => {
    it('should get license by subscriptionId', async () => {
      const created = await service.createLicense({
        name: 'Subscription Test',
        tier: LicenseTier.PRO,
      });

      // Manually set subscriptionId for testing
      (service as any).licenses.set(created.id, {
        ...created,
        subscriptionId: 'sub-123',
      });

      const retrieved = service.getLicenseBySubscription('sub-123');

      expect(retrieved?.id).toBe(created.id);
    });

    it('should return undefined when no subscriptionId matches', () => {
      const result = service.getLicenseBySubscription('non-existent-sub');
      expect(result).toBeUndefined();
    });
  });

  describe('listLicenses', () => {
    beforeEach(async () => {
      // Create test data
      await service.createLicense({ name: 'License 1', tier: LicenseTier.FREE });
      await service.createLicense({ name: 'License 2', tier: LicenseTier.PRO });
      await service.createLicense({ name: 'License 3', tier: LicenseTier.ENTERPRISE });
    });

    it('should list all licenses without filters', async () => {
      const result = await service.listLicenses();

      expect(result.licenses.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.hasMore).toBe(false);
    });

    it('should filter by status', async () => {
      const result = await service.listLicenses({ status: LicenseStatus.ACTIVE });

      expect(result.licenses.length).toBe(3);
      expect(result.licenses.every((l) => l.status === LicenseStatus.ACTIVE)).toBe(true);
    });

    it('should filter by tier', async () => {
      const result = await service.listLicenses({ tier: LicenseTier.PRO });

      expect(result.licenses.length).toBe(1);
      expect(result.licenses[0].tier).toBe(LicenseTier.PRO);
    });

    it('should paginate with skip and take', async () => {
      const result1 = await service.listLicenses({ skip: 0, take: 2 });
      expect(result1.licenses.length).toBe(2);
      expect(result1.hasMore).toBe(true);

      const result2 = await service.listLicenses({ skip: 2, take: 2 });
      expect(result2.licenses.length).toBe(1);
      expect(result2.hasMore).toBe(false);
    });
  });

  describe('revokeLicense', () => {
    it('should revoke active license', async () => {
      const license = await service.createLicense({
        name: 'Revoke Test',
        tier: LicenseTier.PRO,
      });

      const revoked = await service.revokeLicense(license.id);

      expect(revoked?.status).toBe(LicenseStatus.REVOKED);
      expect(revoked?.updatedAt).toBeDefined();
    });

    it('should return undefined for non-existent license', async () => {
      const result = await service.revokeLicense('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('deleteLicense', () => {
    it('should delete license', async () => {
      const license = await service.createLicense({
        name: 'Delete Test',
        tier: LicenseTier.FREE,
      });

      const deleted = await service.deleteLicense(license.id);

      expect(deleted).toBe(true);
      expect(service.getLicense(license.id)).toBeUndefined();
    });

    it('should return false for non-existent license', async () => {
      const result = await service.deleteLicense('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('getAnalytics', () => {
    beforeEach(async () => {
      await service.createLicense({ name: 'Free 1', tier: LicenseTier.FREE });
      await service.createLicense({ name: 'Free 2', tier: LicenseTier.FREE });
      await service.createLicense({ name: 'Pro 1', tier: LicenseTier.PRO });
      await service.createLicense({ name: 'Enterprise 1', tier: LicenseTier.ENTERPRISE });
    });

    it('should return analytics with correct tier counts', async () => {
      const analytics = await service.getAnalytics();

      expect(analytics.totalLicenses).toBe(4);
      expect(analytics.byTier[LicenseTier.FREE]).toBe(2);
      expect(analytics.byTier[LicenseTier.PRO]).toBe(1);
      expect(analytics.byTier[LicenseTier.ENTERPRISE]).toBe(1);
    });

    it('should return analytics with correct status counts', async () => {
      const analytics = await service.getAnalytics();

      expect(analytics.byStatus[LicenseStatus.ACTIVE]).toBe(4);
      expect(analytics.byStatus[LicenseStatus.EXPIRED]).toBe(0);
      expect(analytics.byStatus[LicenseStatus.REVOKED]).toBe(0);
    });

    it('should return recent activity sorted by date', async () => {
      const analytics = await service.getAnalytics();

      expect(analytics.recentActivity.length).toBeLessThanOrEqual(10);
      expect(analytics.recentActivity.every((a) => a.event === 'created')).toBe(true);
    });
  });
});
