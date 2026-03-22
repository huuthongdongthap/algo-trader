import { describe, it, expect } from 'vitest';
import { MetricsCollector } from '../../src/metrics/metrics-collector.js';

describe('MetricsCollector', () => {
  // Singleton — all tests share the same instance
  const mc = MetricsCollector.getInstance();

  it('should return singleton instance', () => {
    const mc2 = MetricsCollector.getInstance();
    expect(mc).toBe(mc2);
  });

  it('should have built-in metrics registered', () => {
    const all = mc.getAll();
    const names = all.map(m => m.name);
    expect(names).toContain('trades_total');
    expect(names).toContain('active_strategies');
    expect(names).toContain('api_latency_ms');
  });

  it('should increment counter', () => {
    mc.increment('trades_total');
    mc.increment('trades_total');
    const metric = mc.getAll().find(m => m.name === 'trades_total')!;
    const sample = metric.samples.get('__default__');
    expect(sample!.value).toBeGreaterThanOrEqual(2);
  });

  it('should increment counter with labels', () => {
    mc.increment('api_requests_total', { method: 'GET', path: '/api/health' });
    mc.increment('api_requests_total', { method: 'GET', path: '/api/health' });
    mc.increment('api_requests_total', { method: 'POST', path: '/api/signals' });
    const metric = mc.getAll().find(m => m.name === 'api_requests_total')!;
    expect(metric.samples.size).toBeGreaterThanOrEqual(2);
  });

  it('should set gauge value', () => {
    mc.set('active_strategies', 5);
    const metric = mc.getAll().find(m => m.name === 'active_strategies')!;
    const sample = metric.samples.get('__default__');
    expect(sample!.value).toBe(5);
  });

  it('should observe histogram', () => {
    mc.observe('api_latency_ms', 42);
    mc.observe('api_latency_ms', 100);
    mc.observe('api_latency_ms', 15);
    const metric = mc.getAll().find(m => m.name === 'api_latency_ms')!;
    const sample = metric.samples.get('__default__');
    expect(sample!.observations!.length).toBeGreaterThanOrEqual(3);
  });

  it('should register custom counter', () => {
    mc.counter('custom_events', 'Custom event counter');
    mc.increment('custom_events');
    const metric = mc.getAll().find(m => m.name === 'custom_events')!;
    expect(metric.type).toBe('counter');
  });

  it('should ignore increment on non-counter', () => {
    mc.increment('active_strategies'); // this is a gauge, should no-op
    const metric = mc.getAll().find(m => m.name === 'active_strategies')!;
    expect(metric.type).toBe('gauge');
  });

  it('should ignore set on non-gauge', () => {
    mc.set('trades_total', 999); // this is a counter, should no-op
    const metric = mc.getAll().find(m => m.name === 'trades_total')!;
    expect(metric.type).toBe('counter');
  });
});
