import { describe, it, expect } from 'vitest';
import { StrategyRunner } from '../../src/engine/strategy-runner.js';
import type { RunnableStrategy } from '../../src/engine/strategy-runner.js';

function makeMockStrategy(failStart = false, failStop = false): RunnableStrategy {
  return {
    start: async () => { if (failStart) throw new Error('start-fail'); },
    stop: async () => { if (failStop) throw new Error('stop-fail'); },
    getStatus: () => ({ mock: true }),
  };
}

describe('StrategyRunner', () => {
  it('should register a strategy', () => {
    const runner = new StrategyRunner();
    runner.register('test-strat', makeMockStrategy());
    const statuses = runner.getAllStatus();
    expect(statuses.length).toBe(1);
    expect(statuses[0].name).toBe('test-strat');
    expect(statuses[0].state).toBe('stopped');
  });

  it('should throw on duplicate registration', () => {
    const runner = new StrategyRunner();
    runner.register('dup', makeMockStrategy());
    expect(() => runner.register('dup', makeMockStrategy())).toThrow('already registered');
  });

  it('should start a strategy', async () => {
    const runner = new StrategyRunner();
    runner.register('s1', makeMockStrategy());
    await runner.startStrategy('s1');
    const status = runner.getAllStatus().find(s => s.name === 's1');
    expect(status!.state).toBe('running');
    expect(status!.uptime).toBeGreaterThanOrEqual(0);
  });

  it('should not start already running strategy', async () => {
    const runner = new StrategyRunner();
    runner.register('s1', makeMockStrategy());
    await runner.startStrategy('s1');
    await runner.startStrategy('s1'); // no error
    expect(runner.getAllStatus()[0].state).toBe('running');
  });

  it('should stop a strategy', async () => {
    const runner = new StrategyRunner();
    runner.register('s1', makeMockStrategy());
    await runner.startStrategy('s1');
    await runner.stopStrategy('s1');
    expect(runner.getAllStatus()[0].state).toBe('stopped');
  });

  it('should handle stop of already stopped strategy', async () => {
    const runner = new StrategyRunner();
    runner.register('s1', makeMockStrategy());
    await runner.stopStrategy('s1'); // no-op
    expect(runner.getAllStatus()[0].state).toBe('stopped');
  });

  it('should set error state on failed start', async () => {
    const runner = new StrategyRunner();
    runner.register('fail', makeMockStrategy(true));
    await expect(runner.startStrategy('fail')).rejects.toThrow('start-fail');
    expect(runner.getAllStatus()[0].state).toBe('error');
    expect(runner.getAllStatus()[0].error).toBe('start-fail');
  });

  it('should set error state on failed stop', async () => {
    const runner = new StrategyRunner();
    runner.register('fail-stop', makeMockStrategy(false, true));
    await runner.startStrategy('fail-stop');
    await runner.stopStrategy('fail-stop');
    expect(runner.getAllStatus()[0].state).toBe('error');
  });

  it('should throw for unregistered strategy', async () => {
    const runner = new StrategyRunner();
    await expect(runner.startStrategy('unknown')).rejects.toThrow('not registered');
  });

  it('should startAll enabled strategies', async () => {
    const runner = new StrategyRunner();
    runner.register('a', makeMockStrategy());
    runner.register('b', makeMockStrategy());
    runner.register('c', makeMockStrategy());

    await runner.startAll([
      { name: 'a', enabled: true, capitalAllocation: '1000', params: {} },
      { name: 'b', enabled: false, capitalAllocation: '1000', params: {} },
      { name: 'c', enabled: true, capitalAllocation: '1000', params: {} },
    ]);

    const statuses = runner.getAllStatus();
    expect(statuses.find(s => s.name === 'a')!.state).toBe('running');
    expect(statuses.find(s => s.name === 'b')!.state).toBe('stopped');
    expect(statuses.find(s => s.name === 'c')!.state).toBe('running');
  });

  it('should stopAll running strategies', async () => {
    const runner = new StrategyRunner();
    runner.register('a', makeMockStrategy());
    runner.register('b', makeMockStrategy());
    await runner.startStrategy('a');
    await runner.startStrategy('b');
    await runner.stopAll();
    expect(runner.getAllStatus().every(s => s.state === 'stopped')).toBe(true);
  });
});
