import { describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionLifecycle } from '../../src/billing/subscription-lifecycle.js';

describe('SubscriptionLifecycle', () => {
  let lifecycle: SubscriptionLifecycle;

  beforeEach(() => {
    lifecycle = new SubscriptionLifecycle();
  });

  it('should start a trial', () => {
    const record = lifecycle.startTrial('u1');
    expect(record.userId).toBe('u1');
    expect(record.tier).toBe('pro');
    expect(record.state).toBe('trial');
    expect(record.trialEndsAt).toBeGreaterThan(Date.now());
    expect(record.apiCallsThisPeriod).toBe(0);
  });

  it('should activate a paid subscription', () => {
    lifecycle.startTrial('u1');
    const record = lifecycle.activate('u1', 'enterprise', 'polar-sub-123');
    expect(record.tier).toBe('enterprise');
    expect(record.state).toBe('active');
    expect(record.polarSubscriptionId).toBe('polar-sub-123');
    expect(record.trialEndsAt).toBeNull();
  });

  it('should cancel subscription', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    const record = lifecycle.cancel('u1');
    expect(record).not.toBeNull();
    expect(record!.state).toBe('canceled');
    expect(record!.canceledAt).toBeGreaterThan(0);
  });

  it('should return null for canceling non-existent user', () => {
    expect(lifecycle.cancel('nobody')).toBeNull();
  });

  it('should downgrade to free', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    const record = lifecycle.downgradeToFree('u1');
    expect(record).not.toBeNull();
    expect(record!.tier).toBe('free');
    expect(record!.state).toBe('expired');
  });

  it('should record API calls', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    lifecycle.recordApiCall('u1');
    lifecycle.recordApiCall('u1');
    lifecycle.recordApiCall('u1');
    const record = lifecycle.getSubscription('u1');
    expect(record!.apiCallsThisPeriod).toBe(3);
  });

  it('should record trades', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    lifecycle.recordTrade('u1');
    lifecycle.recordTrade('u1');
    const record = lifecycle.getSubscription('u1');
    expect(record!.tradesThisPeriod).toBe(2);
  });

  it('should get subscription', () => {
    lifecycle.startTrial('u1');
    expect(lifecycle.getSubscription('u1')).not.toBeNull();
    expect(lifecycle.getSubscription('nobody')).toBeNull();
  });

  it('should detect trial not expired', () => {
    lifecycle.startTrial('u1');
    expect(lifecycle.isTrialExpired('u1')).toBe(false);
  });

  it('should return false for non-trial isTrialExpired', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    expect(lifecycle.isTrialExpired('u1')).toBe(false);
  });

  it('should detect period not expired for fresh subscription', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    expect(lifecycle.isPeriodExpired('u1')).toBe(false);
  });

  it('should snapshot usage', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    lifecycle.recordApiCall('u1');
    lifecycle.recordTrade('u1');
    const snapshot = lifecycle.snapshotUsage('u1', 2, '5000');
    expect(snapshot).not.toBeNull();
    expect(snapshot!.apiCalls).toBe(1);
    expect(snapshot!.trades).toBe(1);
    expect(snapshot!.strategiesActive).toBe(2);
    expect(snapshot!.capitalDeployed).toBe('5000');
  });

  it('should return null for snapshot of non-existent user', () => {
    expect(lifecycle.snapshotUsage('nobody', 0, '0')).toBeNull();
  });

  it('should get usage history', () => {
    lifecycle.activate('u1', 'pro', 'sub-1');
    lifecycle.snapshotUsage('u1', 1, '1000');
    lifecycle.snapshotUsage('u1', 2, '2000');
    const history = lifecycle.getUsageHistory('u1');
    expect(history.length).toBe(2);
  });

  it('should count active subscriptions', () => {
    lifecycle.startTrial('u1');
    lifecycle.activate('u2', 'pro', 'sub-2');
    lifecycle.activate('u3', 'enterprise', 'sub-3');
    lifecycle.cancel('u3');
    expect(lifecycle.activeCount).toBe(2); // trial + active, not canceled
  });

  it('should get revenue breakdown', () => {
    lifecycle.startTrial('u1'); // trial pro
    lifecycle.activate('u2', 'pro', 'sub-2');
    lifecycle.activate('u3', 'enterprise', 'sub-3');
    const breakdown = lifecycle.getRevenueBreakdown();
    expect(breakdown.pro).toBe(2); // trial(pro) + active pro
    expect(breakdown.enterprise).toBe(1);
    expect(breakdown.free).toBe(0);
  });

  it('should preserve createdAt on activate after trial', () => {
    const trial = lifecycle.startTrial('u1');
    const createdAt = trial.createdAt;
    const activated = lifecycle.activate('u1', 'pro', 'sub-1');
    expect(activated.createdAt).toBe(createdAt);
  });

  it('should not fail on recordApiCall/recordTrade for non-existent user', () => {
    lifecycle.recordApiCall('nobody'); // should not throw
    lifecycle.recordTrade('nobody');   // should not throw
  });
});
