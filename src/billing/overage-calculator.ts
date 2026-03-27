/**
 * Overage Calculator
 * ROIaaS Phase 4 - End-of-day billing calculation for usage overage
 */

import { LicenseTier } from '../types/license';
import { DAILY_LIMITS, OVERAGE_PRICE_PER_CALL } from '../metering/usage-metering-service';

export interface OverageCharge {
  metric: string;
  overageUnits: number;
  unitPrice: number;
  totalCharge: number;
}

export interface OverageSummary {
  licenseKey: string;
  tenantId?: string;
  tier: LicenseTier;
  period: string;
  charges: OverageCharge[];
  totalOverage: number;
  calculatedAt: string;
}

export interface DailyUsageRecord {
  date: string;
  apiCalls: number;
  dailyLimit: number;
  overageUnits: number;
  overageCost: number;
}

export class OverageCalculator {
  private static instance: OverageCalculator;

  private constructor() {}

  static getInstance(): OverageCalculator {
    if (!OverageCalculator.instance) {
      OverageCalculator.instance = new OverageCalculator();
    }
    return OverageCalculator.instance;
  }

  calculateDailyOverage(
    licenseKey: string,
    tier: LicenseTier,
    apiCalls: number
  ): DailyUsageRecord {
    const date = new Date().toISOString().split('T')[0];
    const dailyLimit = DAILY_LIMITS[tier];
    const unitPrice = OVERAGE_PRICE_PER_CALL[tier];
    const overageUnits = Math.max(0, apiCalls - dailyLimit);
    const overageCost = overageUnits * unitPrice;

    return {
      date,
      apiCalls,
      dailyLimit,
      overageUnits,
      overageCost,
    };
  }

  calculatePeriodOverage(
    licenseKey: string,
    tier: LicenseTier,
    dailyUsage: DailyUsageRecord[]
  ): OverageSummary {
    const charges: OverageCharge[] = [];
    let totalOverage = 0;

    const totalApiCalls = dailyUsage.reduce((sum, day) => sum + day.apiCalls, 0);
    const totalOverageUnits = dailyUsage.reduce((sum, day) => sum + day.overageUnits, 0);
    const totalOverageCost = dailyUsage.reduce((sum, day) => sum + day.overageCost, 0);

    if (totalOverageUnits > 0) {
      charges.push({
        metric: 'api_calls',
        overageUnits: totalOverageUnits,
        unitPrice: OVERAGE_PRICE_PER_CALL[tier],
        totalCharge: totalOverageCost,
      });
      totalOverage = totalOverageCost;
    }

    const period = this.getCurrentPeriod();

    return {
      licenseKey,
      tier,
      period,
      charges,
      totalOverage,
      calculatedAt: new Date().toISOString(),
    };
  }

  async calculateOverageSummary(
    licenseKey: string,
    tier: LicenseTier,
    tenantId?: string
  ): Promise<OverageSummary> {
    const dailyUsage = this.getDailyUsageRecords(licenseKey, tier);
    const summary = this.calculatePeriodOverage(licenseKey, tier, dailyUsage);
    summary.tenantId = tenantId;
    return summary;
  }

  private getDailyUsageRecords(
    licenseKey: string,
    tier: LicenseTier,
    days: number = 30
  ): DailyUsageRecord[] {
    const records: DailyUsageRecord[] = [];
    const now = new Date();

    for (let i = 0; i < days; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const simulatedCalls = Math.floor(Math.random() * DAILY_LIMITS[tier] * 1.2);
      const record = this.calculateDailyOverage(licenseKey, tier, simulatedCalls);
      record.date = dateStr;
      records.push(record);
    }

    return records;
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  }

  generateInvoice(summary: OverageSummary): string {
    let invoice = `OVERAGE INVOICE\n`;
    invoice += `================\n\n`;
    invoice += `License: ${summary.licenseKey}\n`;
    if (summary.tenantId) {
      invoice += `Tenant: ${summary.tenantId}\n`;
    }
    invoice += `Tier: ${summary.tier}\n`;
    invoice += `Period: ${summary.period}\n`;
    invoice += `Generated: ${summary.calculatedAt}\n\n`;
    invoice += `CHARGES\n`;
    invoice += `--------\n`;

    for (const charge of summary.charges) {
      invoice += `${charge.metric}: ${charge.overageUnits} units x $${charge.unitPrice.toFixed(4)} = $${charge.totalCharge.toFixed(2)}\n`;
    }

    invoice += `\nTOTAL: $${summary.totalOverage.toFixed(2)}\n`;
    return invoice;
  }
}

export const overageCalculator = OverageCalculator.getInstance();
