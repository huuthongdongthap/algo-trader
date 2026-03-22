// Subscription lifecycle management — trial, upgrade, downgrade, churn prevention
// Tracks subscription state transitions and usage metering for RaaS billing

import type { Tier } from '../users/subscription-tier.js';

export type SubscriptionState = 'trial' | 'active' | 'past_due' | 'canceled' | 'expired';

export interface SubscriptionRecord {
  userId: string;
  tier: Tier;
  state: SubscriptionState;
  polarSubscriptionId: string | null;
  trialEndsAt: number | null;
  currentPeriodStart: number;
  currentPeriodEnd: number;
  canceledAt: number | null;
  /** Cumulative API calls this billing period */
  apiCallsThisPeriod: number;
  /** Cumulative trades executed this billing period */
  tradesThisPeriod: number;
  createdAt: number;
  updatedAt: number;
}

export interface UsageSnapshot {
  userId: string;
  period: string;
  apiCalls: number;
  trades: number;
  strategiesActive: number;
  capitalDeployed: string;
}

const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
const BILLING_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // ~30 days

/**
 * Manages subscription lifecycle state machine.
 * In-memory store — production would use database.
 */
export class SubscriptionLifecycle {
  private readonly subscriptions = new Map<string, SubscriptionRecord>();
  private readonly usageHistory: UsageSnapshot[] = [];

  /** Start a free trial for a new user */
  startTrial(userId: string): SubscriptionRecord {
    const now = Date.now();
    const record: SubscriptionRecord = {
      userId,
      tier: 'pro',
      state: 'trial',
      polarSubscriptionId: null,
      trialEndsAt: now + TRIAL_DURATION_MS,
      currentPeriodStart: now,
      currentPeriodEnd: now + TRIAL_DURATION_MS,
      canceledAt: null,
      apiCallsThisPeriod: 0,
      tradesThisPeriod: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.subscriptions.set(userId, record);
    return record;
  }

  /** Activate paid subscription after checkout */
  activate(userId: string, tier: Tier, polarSubscriptionId: string): SubscriptionRecord {
    const now = Date.now();
    const existing = this.subscriptions.get(userId);
    const record: SubscriptionRecord = {
      userId,
      tier,
      state: 'active',
      polarSubscriptionId,
      trialEndsAt: null,
      currentPeriodStart: now,
      currentPeriodEnd: now + BILLING_PERIOD_MS,
      canceledAt: null,
      apiCallsThisPeriod: 0,
      tradesThisPeriod: 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.subscriptions.set(userId, record);
    return record;
  }

  /** Handle cancellation — keep access until period end */
  cancel(userId: string): SubscriptionRecord | null {
    const record = this.subscriptions.get(userId);
    if (!record) return null;
    record.state = 'canceled';
    record.canceledAt = Date.now();
    record.updatedAt = Date.now();
    return record;
  }

  /** Downgrade expired/canceled subscription to free */
  downgradeToFree(userId: string): SubscriptionRecord | null {
    const record = this.subscriptions.get(userId);
    if (!record) return null;
    record.tier = 'free';
    record.state = 'expired';
    record.updatedAt = Date.now();
    return record;
  }

  /** Record an API call for usage metering */
  recordApiCall(userId: string): void {
    const record = this.subscriptions.get(userId);
    if (record) {
      record.apiCallsThisPeriod += 1;
      record.updatedAt = Date.now();
    }
  }

  /** Record a trade execution for usage metering */
  recordTrade(userId: string): void {
    const record = this.subscriptions.get(userId);
    if (record) {
      record.tradesThisPeriod += 1;
      record.updatedAt = Date.now();
    }
  }

  /** Get subscription record */
  getSubscription(userId: string): SubscriptionRecord | null {
    return this.subscriptions.get(userId) ?? null;
  }

  /** Check if user's trial has expired */
  isTrialExpired(userId: string): boolean {
    const record = this.subscriptions.get(userId);
    if (!record || record.state !== 'trial') return false;
    return record.trialEndsAt !== null && Date.now() > record.trialEndsAt;
  }

  /** Check if billing period has ended (needs renewal) */
  isPeriodExpired(userId: string): boolean {
    const record = this.subscriptions.get(userId);
    if (!record) return false;
    return Date.now() > record.currentPeriodEnd;
  }

  /** Snapshot current usage for billing/reporting */
  snapshotUsage(userId: string, strategiesActive: number, capitalDeployed: string): UsageSnapshot | null {
    const record = this.subscriptions.get(userId);
    if (!record) return null;

    const snapshot: UsageSnapshot = {
      userId,
      period: new Date(record.currentPeriodStart).toISOString().slice(0, 10),
      apiCalls: record.apiCallsThisPeriod,
      trades: record.tradesThisPeriod,
      strategiesActive,
      capitalDeployed,
    };
    this.usageHistory.push(snapshot);
    return snapshot;
  }

  /** Get usage history for a user */
  getUsageHistory(userId: string): UsageSnapshot[] {
    return this.usageHistory.filter(s => s.userId === userId);
  }

  /** Total active subscriptions count */
  get activeCount(): number {
    return Array.from(this.subscriptions.values()).filter(s => s.state === 'active' || s.state === 'trial').length;
  }

  /** Revenue summary: count by tier */
  getRevenueBreakdown(): Record<Tier, number> {
    const breakdown: Record<Tier, number> = { free: 0, pro: 0, enterprise: 0 };
    for (const record of this.subscriptions.values()) {
      if (record.state === 'active' || record.state === 'trial') {
        breakdown[record.tier] += 1;
      }
    }
    return breakdown;
  }
}
