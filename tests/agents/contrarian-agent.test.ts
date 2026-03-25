import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ContrarianAgent } from '../../src/agents/contrarian-agent.js';
import { createTask } from '../../src/agents/agent-base.js';

vi.mock('../../src/polymarket/gamma-client.js', () => ({
  GammaClient: class {
    async getTrending(_limit?: number) {
      await new Promise(r => setTimeout(r, 1));
      return [
        { id: 'market-1', question: 'Will X happen?', slug: 'will-x-happen', conditionId: 'c1', yesTokenId: 't1', noTokenId: 't2', yesPrice: 0.85, noPrice: 0.15, volume: 100000, volume24h: 50000, liquidity: 20000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
        { id: 'market-2', question: 'Will Y happen?', slug: 'will-y-happen', conditionId: 'c2', yesTokenId: 't3', noTokenId: 't4', yesPrice: 0.70, noPrice: 0.30, volume: 80000, volume24h: 30000, liquidity: 15000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
      ];
    }
  },
}));

describe('ContrarianAgent', () => {
  let agent: ContrarianAgent;

  beforeEach(() => {
    agent = new ContrarianAgent();
  });

  it('validates task type matching', () => {
    const task = createTask('contrarian', {});
    expect(agent.canHandle(task)).toBe(true);

    const otherTask = createTask('news-snipe', {});
    expect(agent.canHandle(otherTask)).toBe(false);
  });

  it('agent has correct metadata', () => {
    expect(agent.name).toBe('contrarian');
    expect(agent.description).toContain('herding');
    expect(agent.taskTypes).toContain('contrarian');
  });

  it('returns valid result structure', async () => {
    const task = createTask('contrarian', { minHerding: 0.70, maxPrice: 0.92, limit: 100 });
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.agentName).toBe('contrarian');
    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('result data includes required fields', async () => {
    const task = createTask('contrarian', { minHerding: 0.70, maxPrice: 0.92, limit: 100 });
    const result = await agent.execute(task);

    expect(result.data).toHaveProperty('scanned');
    expect(result.data).toHaveProperty('opportunities');
    expect(result.data).toHaveProperty('results');
    expect(result.data).toHaveProperty('note');
  });

  it('accepts custom parameters', async () => {
    const task = createTask('contrarian', { minHerding: 0.80, maxPrice: 0.90, limit: 50 });
    const result = await agent.execute(task);

    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('measures execution time', async () => {
    const task = createTask('contrarian', { minHerding: 0.70, maxPrice: 0.92, limit: 100 });
    const result = await agent.execute(task);

    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('task type is in supported task types', () => {
    expect(agent.taskTypes).toContain('contrarian');
  });

  it('can handle multiple consecutive executions', async () => {
    const task1 = createTask('contrarian', { minHerding: 0.70, maxPrice: 0.92, limit: 100 });
    const result1 = await agent.execute(task1);
    expect(result1.success).toBeDefined();

    const task2 = createTask('contrarian', { minHerding: 0.80, maxPrice: 0.90, limit: 50 });
    const result2 = await agent.execute(task2);
    expect(result2.success).toBeDefined();

    expect(result1.taskId).not.toBe(result2.taskId);
  });

  it('returns consistent agent name', async () => {
    const task = createTask('contrarian', { minHerding: 0.70, maxPrice: 0.92, limit: 100 });
    const result = await agent.execute(task);

    expect(result.agentName).toBe(agent.name);
  });

  it('handles default parameters', async () => {
    const task = createTask('contrarian', {});
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.data).toHaveProperty('scanned');
  });

  it('detects task correctly', () => {
    const contrarianTask = createTask('contrarian', {});
    expect(agent.canHandle(contrarianTask)).toBe(true);

    const otherTasks = ['neg-risk-scan', 'endgame', 'resolution-arb', 'whale-watch', 'event-cluster', 'volume-alert', 'split-merge-arb', 'news-snipe'];
    otherTasks.forEach(taskType => {
      const task = createTask(taskType as any, {});
      expect(agent.canHandle(task)).toBe(false);
    });
  });
});
