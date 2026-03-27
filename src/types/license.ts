/**
 * License Management Types
 * ROIaaS Phase 2 - License Management API
 */

export enum LicenseTier {
  FREE = 'FREE',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum LicenseStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  REVOKED = 'revoked',
}

export interface License {
  id: string;
  name: string;
  key: string;
  tier: LicenseTier;
  status: LicenseStatus;
  createdAt: string;
  expiresAt?: string;
  usageCount: number;
  maxUsage?: number;
  userId?: string;
  updatedAt?: string;
  domain?: string;
  overageUnits?: number;
  overageAllowed?: boolean;
  tenantId?: string;
  dailyUsage?: Map<string, number>;
  lastUsageDate?: string;
  thresholdAlertsSent?: number[];
  subscriptionId?: string;
  dunningStatus?: 'active' | 'warning' | 'suspended' | 'reinstated';
  suspensionDate?: string;
}

export interface LicenseAnalytics {
  totalLicenses: number;
  byTier: Record<LicenseTier, number>;
  byStatus: Record<LicenseStatus, number>;
  totalRevenue: number;
  mrr: number;
  avgLicenseValue: number;
  recentActivity: LicenseActivity[];
}

export interface LicenseActivity {
  licenseId: string;
  licenseName: string;
  event: string;
  timestamp: string;
}

export interface CreateLicenseInput {
  name: string;
  tier: LicenseTier;
  expiresAt?: string;
  tenantId?: string;
  domain?: string;
}

export interface LicenseFilters {
  take?: number;
  skip?: number;
  status?: LicenseStatus | 'all';
  tier?: LicenseTier | 'all';
}

export interface LicenseListResponse {
  licenses: License[];
  total: number;
  hasMore: boolean;
}
