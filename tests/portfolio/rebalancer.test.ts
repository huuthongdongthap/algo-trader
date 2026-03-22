import { describe, it, expect } from 'vitest';
import { Rebalancer } from '../../src/portfolio/rebalancer.js';

describe('Rebalancer', () => {
  it('should not rebalance within minimum interval', () => {
    const r = new Rebalancer({ driftThreshold: 0.05, intervalMs: 60_000 });
    r.markRebalanced(Date.now());
    const current = new Map([['a', 1000]]);
    const target = new Map([['a', 2000]]); // 100% drift
    expect(r.shouldRebalance(current, target)).toBe(false);
  });

  it('should rebalance when drift exceeds threshold after interval', () => {
    const r = new Rebalancer({ driftThreshold: 0.05, intervalMs: 0 });
    const current = new Map([['a', 900]]);
    const target = new Map([['a', 1000]]); // 10% drift
    expect(r.shouldRebalance(current, target)).toBe(true);
  });

  it('should not rebalance when drift is within threshold', () => {
    const r = new Rebalancer({ driftThreshold: 0.10, intervalMs: 0 });
    const current = new Map([['a', 950]]);
    const target = new Map([['a', 1000]]); // 5% drift < 10% threshold
    expect(r.shouldRebalance(current, target)).toBe(false);
  });

  it('should skip zero targets', () => {
    const r = new Rebalancer({ driftThreshold: 0.05, intervalMs: 0 });
    const current = new Map([['a', 500]]);
    const target = new Map([['a', 0]]);
    expect(r.shouldRebalance(current, target)).toBe(false);
  });

  it('should calculate rebalance orders', () => {
    const r = new Rebalancer({ driftThreshold: 0.05, intervalMs: 0 });
    const current = new Map([['a', 800], ['b', 1200]]);
    const target = new Map([['a', 1000], ['b', 1000]]);
    const orders = r.calculateRebalanceOrders(current, target);
    expect(orders.length).toBe(2);
    const orderA = orders.find(o => o.strategy === 'a');
    const orderB = orders.find(o => o.strategy === 'b');
    expect(orderA!.action).toBe('increase');
    expect(orderA!.amount).toBe(200);
    expect(orderB!.action).toBe('decrease');
    expect(orderB!.amount).toBe(200);
  });

  it('should skip negligible drifts in orders', () => {
    const r = new Rebalancer({ driftThreshold: 0.05, intervalMs: 0 });
    const current = new Map([['a', 999.995]]);
    const target = new Map([['a', 1000]]);
    const orders = r.calculateRebalanceOrders(current, target);
    expect(orders.length).toBe(0);
  });

  it('should sort orders by amount descending', () => {
    const r = new Rebalancer({ driftThreshold: 0.01, intervalMs: 0 });
    const current = new Map([['a', 500], ['b', 200]]);
    const target = new Map([['a', 600], ['b', 500]]);
    const orders = r.calculateRebalanceOrders(current, target);
    expect(orders[0].amount).toBeGreaterThanOrEqual(orders[1]?.amount ?? 0);
  });

  it('should compute msUntilNextEligible', () => {
    const r = new Rebalancer({ driftThreshold: 0.05, intervalMs: 60_000 });
    const now = Date.now();
    r.markRebalanced(now);
    expect(r.msUntilNextEligible(now + 10_000)).toBeCloseTo(50_000, -2);
    expect(r.msUntilNextEligible(now + 60_000)).toBe(0);
  });

  it('should expose config', () => {
    const r = new Rebalancer({ driftThreshold: 0.10, intervalMs: 5000 });
    expect(r.getConfig().driftThreshold).toBe(0.10);
    expect(r.getConfig().intervalMs).toBe(5000);
  });
});
