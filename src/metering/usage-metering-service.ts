/**
 * Usage Metering Service
 * ROIaaS Phase 4 - Daily API usage tracking and threshold alerts
 */

import { LicenseTier } from '../types/license';
import { EventEmitter } from 'events';

export interface UsageStatus {
  licenseKey: string;
  date: string;
  tier: LicenseTier;
  dailyLimit: number;
  currentUsage: number;
  remaining: number;
  percentUsed: number;
  isExceeded: boolean;
  overageUnits: number;
  overageCost: number;
}

export interface ThresholdAlert {
  licenseKey: string;
  threshold: number;
  currentUsage: number;
  dailyLimit: number;
  percentUsed: number;
  timestamp: string;
}

export const DAILY_LIMITS: Record<LicenseTier, number> = {
  [LicenseTier.FREE]: 100,
  [LicenseTier.PRO]: 10000,
  [LicenseTier.ENTERPRISE]: 100000,
};

export const OVERAGE_PRICE_PER_CALL: Record<LicenseTier, number> = {
  [LicenseTier.FREE]: 0,
  [LicenseTier.PRO]: 0.01,
  [LicenseTier.ENTERPRISE]: 0.005,
};

const ALERT_THRESHOLDS = [80, 90, 100];

export class UsageMeteringService extends EventEmitter {
  private static instance: UsageMeteringService;
  private dailyUsage: Map<string, Map<string, number>> = new Map();
  private alertedThresholds: Map<string, Set<number>> = new Map();

  private constructor() {
    super();
  }

  static getInstance(): UsageMeteringService {
    if (!UsageMeteringService.instance) {
      UsageMeteringService.instance = new UsageMeteringService();
    }
    return UsageMeteringService.instance;
  }

  getCurrentDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  async trackApiCall(
    licenseKey: string,
    tier: LicenseTier,
    endpoint?: string,
    userId?: string
  ): Promise<UsageStatus> {
    const date = this.getCurrentDate();
    const usageKey = `${licenseKey}:${date}`;

    const currentUsage = this.getTodayUsage(licenseKey);
    const newUsage = currentUsage + 1;
    this.setUsage(licenseKey, date, newUsage);

    const status = this.getUsageStatus(licenseKey, tier);

    if (endpoint) {
      this.emit('api_call', { licenseKey, endpoint, userId, timestamp: new Date().toISOString() });
    }

    this.checkThresholds(licenseKey, status);

    return status;
  }

  private getTodayUsage(licenseKey: string): number {
    const date = this.getCurrentDate();
    return this.dailyUsage.get(licenseKey)?.get(date) || 0;
  }

  private setUsage(licenseKey: string, date: string, count: number): void {
    if (!this.dailyUsage.has(licenseKey)) {
      this.dailyUsage.set(licenseKey, new Map());
    }
    this.dailyUsage.get(licenseKey)!.set(date, count);
  }

  getUsageStatus(licenseKey: string, tier: LicenseTier): UsageStatus {
    const date = this.getCurrentDate();
    const dailyLimit = DAILY_LIMITS[tier];
    const currentUsage = this.getTodayUsage(licenseKey);
    const remaining = Math.max(0, dailyLimit - currentUsage);
    const percentUsed = (currentUsage / dailyLimit) * 100;
    const isExceeded = currentUsage > dailyLimit;
    const overageUnits = isExceeded ? currentUsage - dailyLimit : 0;
    const overageCost = overageUnits * OVERAGE_PRICE_PER_CALL[tier];

    return {
      licenseKey,
      date,
      tier,
      dailyLimit,
      currentUsage,
      remaining,
      percentUsed,
      isExceeded,
      overageUnits,
      overageCost,
    };
  }

  calculateOverage(licenseKey: string, tier: LicenseTier): number {
    const status = this.getUsageStatus(licenseKey, tier);
    return status.overageCost;
  }

  private checkThresholds(licenseKey: string, status: UsageStatus): void {
    if (!this.alertedThresholds.has(licenseKey)) {
      this.alertedThresholds.set(licenseKey, new Set());
    }
    const alerted = this.alertedThresholds.get(licenseKey)!;

    for (const threshold of ALERT_THRESHOLDS) {
      if (status.percentUsed >= threshold && !alerted.has(threshold)) {
        alerted.add(threshold);

        const alert: ThresholdAlert = {
          licenseKey,
          threshold,
          currentUsage: status.currentUsage,
          dailyLimit: status.dailyLimit,
          percentUsed: status.percentUsed,
          timestamp: new Date().toISOString(),
        };

        this.emit('threshold_alert', alert);
      }
    }
  }

  resetDailyUsage(licenseKey: string): void {
    const date = this.getCurrentDate();
    const usageMap = this.dailyUsage.get(licenseKey);
    if (usageMap) {
      usageMap.delete(date);
    }
    this.alertedThresholds.delete(licenseKey);
  }

  cleanupOldData(daysToKeep: number = 30): void {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString().split('T')[0];

    for (const [licenseKey, dateMap] of this.dailyUsage.entries()) {
      for (const date of dateMap.keys()) {
        if (date < cutoffStr) {
          dateMap.delete(date);
        }
      }
      if (dateMap.size === 0) {
        this.dailyUsage.delete(licenseKey);
      }
    }
  }
}
