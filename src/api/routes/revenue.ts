/**
 * Revenue Analytics API Routes
 * Week 3-4: Billing - MRR, usage by customer, overage revenue, churn tracking
 *
 * Endpoints:
 * - GET /revenue/summary - Full revenue summary
 * - GET /revenue/mrr - Monthly Recurring Revenue
 * - GET /revenue/usage - Usage by customer
 * - GET /revenue/overage - Overage revenue
 * - GET /revenue/churn - Churn metrics
 */

import { Router, Request, Response } from 'express';
import { UsageMeteringService } from '../../billing/usage-metering';
import { logger } from '../../utils/logger';

export const revenueRouter: Router = Router();
const usageMetering = UsageMeteringService.getInstance();

interface RevenueSummary {
  period: string;
  mrr: number;
  arr: number;
  overageRevenue: number;
  totalRevenue: number;
  customerCount: number;
  averageRevenuePerCustomer: number;
  growthRate: number;
}

interface CustomerUsage {
  licenseKey: string;
  tier: string;
  tradesUsed: number;
  tradesLimit: number;
  percentUsed: number;
  overageUnits: number;
  overageCost: number;
  lastActiveAt: number;
}

interface ChurnMetrics {
  period: string;
  totalCustomers: number;
  churnedCustomers: number;
  churnRate: number;
  revenueChurn: number;
  reasons: Record<string, number>;
}

interface MRRResponse {
  currentMRR: number;
  previousMRR: number;
  mrrGrowth: number;
  mrrGrowthRate: number;
  breakdown: {
    subscriptionMRR: number;
    overageMRR: number;
  };
}

/**
 * GET /revenue/summary
 * Get complete revenue analytics
 */
revenueRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const period = getCurrentPeriod();
    const revenueSummary = await usageMetering.getRevenueSummary(period);
    const mrrData = calculateMRR();

    const response: RevenueSummary = {
      period,
      mrr: mrrData.currentMRR,
      arr: mrrData.currentMRR * 12,
      overageRevenue: revenueSummary.overageRevenue,
      totalRevenue: revenueSummary.totalRevenue,
      customerCount: revenueSummary.customerCount,
      averageRevenuePerCustomer: revenueSummary.averageRevenuePerCustomer,
      growthRate: mrrData.mrrGrowthRate,
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch revenue summary',
    });
  }
});

/**
 * GET /revenue/mrr
 * Get MRR metrics
 */
revenueRouter.get('/mrr', async (req: Request, res: Response) => {
  try {
    const mrrData = calculateMRR();
    res.json(mrrData);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch MRR data',
    });
  }
});

/**
 * GET /revenue/usage
 * Get usage by customer
 */
revenueRouter.get('/usage', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || getCurrentPeriod();
    const limit = parseInt((req.query.limit as string) || '100');

    const usageData = await usageMetering.getAllUsageData(period);

    const customerUsage: CustomerUsage[] = usageData.slice(0, limit).map(usage => ({
      licenseKey: usage.licenseKey,
      tier: usage.tier,
      tradesUsed: usage.currentUsage,
      tradesLimit: usage.monthlyLimit,
      percentUsed: usage.percentUsed,
      overageUnits: usage.overageUnits,
      overageCost: usage.overageCost,
      lastActiveAt: usage.lastSyncedAt || 0,
    }));

    res.json({
      period,
      customers: customerUsage,
      total: usageData.length,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch usage data',
    });
  }
});

/**
 * GET /revenue/overage
 * Get overage revenue details
 */
revenueRouter.get('/overage', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || getCurrentPeriod();
    const revenueSummary = await usageMetering.getRevenueSummary(period);
    const usageData = await usageMetering.getAllUsageData(period);

    const overageCustomers = usageData
      .filter(u => u.overageUnits > 0)
      .map(u => ({
        licenseKey: u.licenseKey,
        overageUnits: u.overageUnits,
        overageCost: u.overageCost,
      }));

    res.json({
      period,
      totalOverageRevenue: revenueSummary.overageRevenue,
      customersWithOverage: overageCustomers.length,
      details: overageCustomers,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch overage data',
    });
  }
});

/**
 * GET /revenue/churn
 * Get churn metrics
 */
revenueRouter.get('/churn', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || getCurrentPeriod();
    const churnData = calculateChurn(period);
    res.json(churnData);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch churn data',
    });
  }
});

/**
 * Helper functions
 */

function getCurrentPeriod(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function calculateMRR(): MRRResponse {
  // Placeholder - would integrate with PolarService for actual subscription data
  const subscriptionMRR = 0;
  const overageMRR = 0;
  const currentMRR = subscriptionMRR + overageMRR;
  const previousMRR = 0;

  return {
    currentMRR,
    previousMRR,
    mrrGrowth: currentMRR - previousMRR,
    mrrGrowthRate: previousMRR > 0 ? ((currentMRR - previousMRR) / previousMRR) * 100 : 0,
    breakdown: {
      subscriptionMRR,
      overageMRR,
    },
  };
}

function calculateChurn(period: string): ChurnMetrics {
  // Placeholder - would integrate with PolarService for actual churn data
  return {
    period,
    totalCustomers: 0,
    churnedCustomers: 0,
    churnRate: 0,
    revenueChurn: 0,
    reasons: {},
  };
}

logger.info('[RevenueRoutes] Registered');
