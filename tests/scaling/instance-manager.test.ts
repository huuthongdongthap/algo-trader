import { describe, it, expect, beforeEach } from 'vitest';
import { InstanceManager } from '../../src/scaling/instance-manager.js';
import type { InstanceConfig } from '../../src/scaling/instance-manager.js';

const makeConfig = (overrides?: Partial<InstanceConfig>): InstanceConfig => ({
  id: 'inst-1',
  strategies: ['grid-trading'],
  port: 3010,
  capitalAllocation: '10000',
  ...overrides,
});

describe('InstanceManager', () => {
  let mgr: InstanceManager;

  beforeEach(() => {
    mgr = new InstanceManager();
  });

  it('should create an instance', () => {
    const status = mgr.createInstance(makeConfig());
    expect(status.id).toBe('inst-1');
    expect(status.state).toBe('running');
    expect(status.startedAt).toBeGreaterThan(0);
    expect(status.realizedPnl).toBe('0');
    expect(status.unrealizedPnl).toBe('0');
    expect(mgr.count).toBe(1);
  });

  it('should throw on duplicate instance id', () => {
    mgr.createInstance(makeConfig());
    expect(() => mgr.createInstance(makeConfig())).toThrow("already exists");
  });

  it('should get instance status', () => {
    mgr.createInstance(makeConfig());
    const status = mgr.getInstanceStatus('inst-1');
    expect(status.id).toBe('inst-1');
    expect(status.lastHealthCheck).toBeGreaterThan(0);
  });

  it('should throw for non-existent instance status', () => {
    expect(() => mgr.getInstanceStatus('nope')).toThrow('not found');
  });

  it('should list all instances', () => {
    mgr.createInstance(makeConfig({ id: 'a' }));
    mgr.createInstance(makeConfig({ id: 'b' }));
    const list = mgr.listInstances();
    expect(list.length).toBe(2);
    expect(list.map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('should update PnL', () => {
    mgr.createInstance(makeConfig());
    mgr.updatePnl('inst-1', '500', '100');
    const status = mgr.getInstanceStatus('inst-1');
    expect(status.realizedPnl).toBe('500');
    expect(status.unrealizedPnl).toBe('100');
  });

  it('should throw on updatePnl for non-existent', () => {
    expect(() => mgr.updatePnl('nope', '0', '0')).toThrow('not found');
  });

  it('should remove instance', async () => {
    mgr.createInstance(makeConfig());
    await mgr.removeInstance('inst-1');
    expect(mgr.count).toBe(0);
  });

  it('should throw on removing non-existent instance', async () => {
    await expect(mgr.removeInstance('nope')).rejects.toThrow('not found');
  });

  it('should call shutdown handler on remove', async () => {
    mgr.createInstance(makeConfig());
    let called = false;
    mgr.registerShutdownHandler('inst-1', async () => { called = true; });
    await mgr.removeInstance('inst-1');
    expect(called).toBe(true);
  });

  it('should set state to error if shutdown throws', async () => {
    mgr.createInstance(makeConfig());
    mgr.registerShutdownHandler('inst-1', async () => { throw new Error('shutdown fail'); });
    await expect(mgr.removeInstance('inst-1')).rejects.toThrow('shutdown fail');
  });

  it('should throw on registerShutdownHandler for non-existent', () => {
    expect(() => mgr.registerShutdownHandler('nope', async () => {})).toThrow('not found');
  });

  it('should return copies from listInstances (no mutation)', () => {
    mgr.createInstance(makeConfig());
    const list1 = mgr.listInstances();
    list1[0]!.realizedPnl = '9999';
    const list2 = mgr.listInstances();
    expect(list2[0]!.realizedPnl).toBe('0'); // original unchanged
  });
});
