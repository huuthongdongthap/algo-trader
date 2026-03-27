/**
 * License Service
 * ROIaaS Phase 2 - License CRUD and key generation
 * Storage: JSON file persistence (no additional deps required)
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  License,
  LicenseTier,
  LicenseStatus,
  CreateLicenseInput,
  LicenseFilters,
  LicenseListResponse,
} from '../types/license';

const LICENSE_PREFIX = 'raas';
const TIER_PREFIXES: Record<LicenseTier, string> = {
  [LicenseTier.FREE]: 'free',
  [LicenseTier.PRO]: 'rpp',
  [LicenseTier.ENTERPRISE]: 'rep',
};

/** Path to the JSON file storing licenses. Configurable via env var. */
const STORE_PATH = process.env.LICENSE_STORE_PATH
  || path.join(process.cwd(), 'data', 'licenses.json');

/** Persist in-memory map to JSON file */
function saveToFile(licenses: Map<string, License>): void {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const data = JSON.stringify(Array.from(licenses.entries()), null, 2);
  fs.writeFileSync(STORE_PATH, data, 'utf-8');
}

/** Load licenses from JSON file into a Map */
function loadFromFile(): Map<string, License> {
  try {
    if (!fs.existsSync(STORE_PATH)) return new Map();
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const entries: [string, License][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    // Corrupted file — start fresh
    return new Map();
  }
}

export class LicenseService {
  private static instance: LicenseService;
  private licenses: Map<string, License>;

  private constructor() {
    this.licenses = loadFromFile();
  }

  static getInstance(): LicenseService {
    if (!LicenseService.instance) {
      LicenseService.instance = new LicenseService();
    }
    return LicenseService.instance;
  }

  generateLicenseKey(tier: LicenseTier): string {
    const tierPrefix = TIER_PREFIXES[tier];
    const segment1 = this.generateRandomSegment(8);
    const segment2 = this.generateRandomSegment(8);
    return `${LICENSE_PREFIX}-${tierPrefix}-${segment1}-${segment2}`.toUpperCase();
  }

  private generateRandomSegment(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  async createLicense(input: CreateLicenseInput): Promise<License> {
    const id = `lic_${this.generateId()}`;
    const key = this.generateLicenseKey(input.tier);
    const now = new Date().toISOString();

    const license: License = {
      id,
      name: input.name,
      key,
      tier: input.tier,
      status: LicenseStatus.ACTIVE,
      createdAt: now,
      updatedAt: now,
      usageCount: 0,
      maxUsage: this.getDefaultMaxUsage(input.tier),
      tenantId: input.tenantId,
      domain: input.domain,
      expiresAt: input.expiresAt,
    };

    this.licenses.set(id, license);
    saveToFile(this.licenses);
    return license;
  }

  private getDefaultMaxUsage(tier: LicenseTier): number {
    switch (tier) {
      case LicenseTier.FREE:
        return 100;
      case LicenseTier.PRO:
        return 10000;
      case LicenseTier.ENTERPRISE:
        return 100000;
    }
  }

  getLicense(id: string): License | undefined {
    return this.licenses.get(id);
  }

  getLicenseByKey(key: string): License | undefined {
    for (const license of this.licenses.values()) {
      if (license.key === key) {
        return license;
      }
    }
    return undefined;
  }

  getLicenseBySubscription(subscriptionId: string): License | undefined {
    for (const license of this.licenses.values()) {
      if (license.subscriptionId === subscriptionId) {
        return license;
      }
    }
    return undefined;
  }

  async listLicenses(filters: LicenseFilters = {}): Promise<LicenseListResponse> {
    let result = Array.from(this.licenses.values());

    if (filters.status && filters.status !== 'all') {
      result = result.filter((l) => l.status === filters.status);
    }

    if (filters.tier && filters.tier !== 'all') {
      result = result.filter((l) => l.tier === filters.tier);
    }

    const total = result.length;
    const skip = filters.skip || 0;
    const take = filters.take || 10;

    result = result.slice(skip, skip + take);

    return {
      licenses: result,
      total,
      hasMore: skip + take < total,
    };
  }

  async revokeLicense(id: string): Promise<License | undefined> {
    const license = this.licenses.get(id);
    if (!license) {
      return undefined;
    }

    license.status = LicenseStatus.REVOKED;
    license.updatedAt = new Date().toISOString();
    this.licenses.set(id, license);
    saveToFile(this.licenses);
    return license;
  }

  async deleteLicense(id: string): Promise<boolean> {
    const deleted = this.licenses.delete(id);
    if (deleted) saveToFile(this.licenses);
    return deleted;
  }

  async getAnalytics() {
    const allLicenses = Array.from(this.licenses.values());

    const byTier = {
      [LicenseTier.FREE]: allLicenses.filter((l) => l.tier === LicenseTier.FREE).length,
      [LicenseTier.PRO]: allLicenses.filter((l) => l.tier === LicenseTier.PRO).length,
      [LicenseTier.ENTERPRISE]: allLicenses.filter((l) => l.tier === LicenseTier.ENTERPRISE).length,
    };

    const byStatus = {
      [LicenseStatus.ACTIVE]: allLicenses.filter((l) => l.status === LicenseStatus.ACTIVE).length,
      [LicenseStatus.EXPIRED]: allLicenses.filter((l) => l.status === LicenseStatus.EXPIRED).length,
      [LicenseStatus.REVOKED]: allLicenses.filter((l) => l.status === LicenseStatus.REVOKED).length,
    };

    const recentActivity = allLicenses
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((l) => ({
        licenseId: l.id,
        licenseName: l.name,
        event: 'created',
        timestamp: l.createdAt,
      }));

    return {
      totalLicenses: allLicenses.length,
      byTier,
      byStatus,
      totalRevenue: 0,
      mrr: 0,
      avgLicenseValue: 0,
      recentActivity,
    };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
