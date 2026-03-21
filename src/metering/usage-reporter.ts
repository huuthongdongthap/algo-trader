// Usage reporting module for algo-trade RaaS billing metering
// Generates per-user and system-wide reports, CSV export, revenue estimation

import type { Tier } from '../users/subscription-tier.js';
import type { UsageTracker } from './usage-tracker.js';

export interface UsageReport {
  userId: string;
  period: { startMs: number; endMs: number };
  totalCalls: number;
  avgResponseTime: number;
  /** Top 5 endpoints by call count */
  topEndpoints: Array<{ endpoint: string; calls: number }>;
  /** Hour of day (0-23) with the most API calls */
  peakHour: number;
  /** Fraction of per-minute rate limit consumed on average (0–1) */
  quotaUtilization: number;
}

export interface SystemReport {
  period: { startMs: number; endMs: number };
  totalCalls: number;
  activeUsers: number;
  avgResponseTime: number;
  topEndpoints: Array<{ endpoint: string; calls: number }>;
  perUser: UsageReport[];
}

export interface TierPricing {
  tier: Tier;
  pricePerCall: number; // USD per API call (usage-based component)
}

export class UsageReporter {
  constructor(private readonly tracker: UsageTracker) {}

  /**
   * Generate a usage report for a single user over the given period.
   */
  generateUserReport(userId: string, periodMs: number): UsageReport {
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const records = this.tracker.getUserRecords(userId, periodMs);

    const totalCalls = records.length;
    const avgResponseTime =
      totalCalls === 0
        ? 0
        : records.reduce((sum, r) => sum + r.responseTimeMs, 0) / totalCalls;

    // Endpoint breakdown → top 5
    const endpointCounts: Record<string, number> = {};
    for (const r of records) {
      endpointCounts[r.endpoint] = (endpointCounts[r.endpoint] ?? 0) + 1;
    }
    const topEndpoints = Object.entries(endpointCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([endpoint, calls]) => ({ endpoint, calls }));

    // Peak hour (0–23) by call count
    const hourBuckets = new Array<number>(24).fill(0);
    for (const r of records) {
      const hour = new Date(r.timestamp).getHours();
      hourBuckets[hour]++;
    }
    const peakHour = hourBuckets.indexOf(Math.max(...hourBuckets));

    // Quota utilisation: avg calls-per-minute vs per-minute limit is computed
    // by the caller who knows the tier; here we expose raw minute-window usage
    // as a ratio of the period length in minutes.
    const periodMinutes = periodMs / 60_000;
    const avgCallsPerMinute = periodMinutes > 0 ? totalCalls / periodMinutes : 0;
    // Normalised to 1.0 = 100 calls/min baseline; callers can rescale
    const quotaUtilization = avgCallsPerMinute / 100;

    return {
      userId,
      period: { startMs, endMs },
      totalCalls,
      avgResponseTime,
      topEndpoints,
      peakHour,
      quotaUtilization,
    };
  }

  /**
   * Generate an aggregate system report across all tracked users.
   */
  generateSystemReport(periodMs: number): SystemReport {
    const endMs = Date.now();
    const startMs = endMs - periodMs;
    const activeUserIds = this.tracker.getActiveUsers(periodMs);
    const perUser = activeUserIds.map((id) => this.generateUserReport(id, periodMs));

    const totalCalls = perUser.reduce((s, r) => s + r.totalCalls, 0);
    const avgResponseTime =
      perUser.length === 0
        ? 0
        : perUser.reduce((s, r) => s + r.avgResponseTime, 0) / perUser.length;

    // Merge endpoint counts across users
    const merged: Record<string, number> = {};
    for (const report of perUser) {
      for (const { endpoint, calls } of report.topEndpoints) {
        merged[endpoint] = (merged[endpoint] ?? 0) + calls;
      }
    }
    const topEndpoints = Object.entries(merged)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([endpoint, calls]) => ({ endpoint, calls }));

    return {
      period: { startMs, endMs },
      totalCalls,
      activeUsers: activeUserIds.length,
      avgResponseTime,
      topEndpoints,
      perUser,
    };
  }

  /**
   * Export a single UsageReport (or array of them) to CSV string.
   * Suitable for dropping into a billing integration pipeline.
   */
  exportToCsv(report: UsageReport | UsageReport[]): string {
    const rows = Array.isArray(report) ? report : [report];
    const header = [
      'userId',
      'periodStart',
      'periodEnd',
      'totalCalls',
      'avgResponseTimeMs',
      'peakHour',
      'quotaUtilization',
      'topEndpoint1',
      'topEndpoint1Calls',
      'topEndpoint2',
      'topEndpoint2Calls',
    ].join(',');

    const lines = rows.map((r) => {
      const e1 = r.topEndpoints[0];
      const e2 = r.topEndpoints[1];
      return [
        r.userId,
        new Date(r.period.startMs).toISOString(),
        new Date(r.period.endMs).toISOString(),
        r.totalCalls,
        r.avgResponseTime.toFixed(2),
        r.peakHour,
        r.quotaUtilization.toFixed(4),
        e1?.endpoint ?? '',
        e1?.calls ?? 0,
        e2?.endpoint ?? '',
        e2?.calls ?? 0,
      ].join(',');
    });

    return [header, ...lines].join('\n');
  }

  /**
   * Estimate projected revenue from a set of user reports given per-call pricing.
   * Returns total USD and a per-user breakdown.
   */
  estimateRevenue(
    reports: UsageReport[],
    tierPricing: TierPricing[],
  ): { totalUsd: number; perUser: Array<{ userId: string; calls: number; revenueUsd: number }> } {
    // Build a quick lookup; fall back to the cheapest tier price when unknown
    const priceMap = new Map<Tier, number>(tierPricing.map((p) => [p.tier, p.pricePerCall]));
    const defaultPrice = Math.min(...tierPricing.map((p) => p.pricePerCall), 0);

    // Since reports don't carry tier info, we apply the default price unless the
    // caller enriches the data. For a richer calculation, callers should pass
    // reports tagged with tier (extend UsageReport if needed).
    const perUser = reports.map((r) => {
      // Attempt to find a matching entry in tierPricing by userId convention (no-op here)
      const price = defaultPrice;
      void priceMap; // kept for future enrichment
      const revenueUsd = r.totalCalls * price;
      return { userId: r.userId, calls: r.totalCalls, revenueUsd };
    });

    const totalUsd = perUser.reduce((s, u) => s + u.revenueUsd, 0);
    return { totalUsd, perUser };
  }
}
