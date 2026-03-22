import { describe, it, expect } from 'vitest';
import { TenantManager } from '../../src/users/tenant-manager.js';
import type { User } from '../../src/users/user-store.js';
import type { StrategyConfig } from '../../src/core/types.js';

function makeUser(tier: 'free' | 'pro' | 'enterprise' = 'pro'): User {
  return {
    id: 'u-1',
    email: 'test@test.com',
    apiKey: 'ak_test',
    apiSecretHash: 'hash',
    passwordHash: null,
    tier,
    createdAt: Date.now(),
    active: true,
    polarCustomerId: null,
    polarSubscriptionId: null,
  };
}

function makeConfig(name: string): StrategyConfig {
  return { name: name as any, enabled: true, capitalAllocation: 0.5, params: {} };
}

describe('TenantManager', () => {
  it('should register tenant and get context', () => {
    const tm = new TenantManager();
    const user = makeUser('pro');
    const ctx = tm.registerTenantWithUser(user, [makeConfig('grid-trading'), makeConfig('dca-bot')]);
    expect(ctx.userId).toBe('u-1');
    expect(ctx.strategies).toHaveLength(2);
    expect(ctx.capitalLimit).toBe(50_000);
  });

  it('should clamp strategies to free tier limit', () => {
    const tm = new TenantManager();
    const user = makeUser('free');
    const ctx = tm.registerTenantWithUser(user, [makeConfig('grid-trading'), makeConfig('dca-bot')]);
    expect(ctx.strategies).toHaveLength(1);
  });

  it('should allow unlimited strategies for enterprise', () => {
    const tm = new TenantManager();
    const user = makeUser('enterprise');
    const configs = Array.from({ length: 10 }, (_, i) => makeConfig(`strat-${i}`));
    const ctx = tm.registerTenantWithUser(user, configs);
    expect(ctx.strategies).toHaveLength(10);
  });

  it('should start and stop strategy', () => {
    const tm = new TenantManager();
    tm.registerTenantWithUser(makeUser('pro'), [makeConfig('grid-trading')]);
    expect(tm.startStrategy('u-1', 'grid-trading' as any)).toBe(true);
    expect(tm.stopStrategy('u-1', 'grid-trading' as any)).toBe(true);
  });

  it('should reject starting unregistered strategy', () => {
    const tm = new TenantManager();
    tm.registerTenantWithUser(makeUser('pro'), [makeConfig('grid-trading')]);
    expect(tm.startStrategy('u-1', 'dca-bot' as any)).toBe(false);
  });

  it('should reject starting already active strategy', () => {
    const tm = new TenantManager();
    tm.registerTenantWithUser(makeUser('pro'), [makeConfig('grid-trading')]);
    tm.startStrategy('u-1', 'grid-trading' as any);
    expect(tm.startStrategy('u-1', 'grid-trading' as any)).toBe(false);
  });

  it('should record trades and update PnL', () => {
    const tm = new TenantManager();
    tm.registerTenantWithUser(makeUser('pro'), [makeConfig('grid-trading')]);
    tm.recordTrade('u-1', '100.50');
    tm.recordTrade('u-1', '-20.25');
    const stats = tm.getTenantStats('u-1');
    expect(stats!.tradeCount).toBe(2);
    expect(parseFloat(stats!.realizedPnl)).toBeCloseTo(80.25);
  });

  it('should return null stats for unknown tenant', () => {
    const tm = new TenantManager();
    expect(tm.getTenantStats('unknown')).toBeNull();
  });

  it('should remove tenant', () => {
    const tm = new TenantManager();
    tm.registerTenantWithUser(makeUser('pro'), []);
    expect(tm.removeTenant('u-1')).toBe(true);
    expect(tm.getTenantContext('u-1')).toBeNull();
  });

  it('should check capital within limit', () => {
    const tm = new TenantManager();
    tm.registerTenantWithUser(makeUser('pro'), []);
    expect(tm.isCapitalWithinLimit('u-1', 50_000)).toBe(true);
    expect(tm.isCapitalWithinLimit('u-1', 50_001)).toBe(false);
  });
});
