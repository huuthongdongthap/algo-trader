import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NewsSniperAgent } from '../../src/agents/news-snipe-agent.js';
import { createTask } from '../../src/agents/agent-base.js';

vi.mock('../../src/polymarket/gamma-client.js', () => ({
  GammaClient: class {
    async getTrending(_limit?: number) {
      await new Promise(r => setTimeout(r, 1));
      return [
        { id: 'market-1', question: 'Will X happen?', slug: 'will-x-happen', conditionId: 'c1', yesTokenId: 't1', noTokenId: 't2', yesPrice: 0.90, noPrice: 0.10, volume: 200000, volume24h: 80000, liquidity: 5000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
        { id: 'market-2', question: 'Will Y happen?', slug: 'will-y-happen', conditionId: 'c2', yesTokenId: 't3', noTokenId: 't4', yesPrice: 0.50, noPrice: 0.50, volume: 80000, volume24h: 30000, liquidity: 15000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
      ];
    }
  },
}));

describe('NewsSniperAgent', () => {
  let agent: NewsSniperAgent;

  beforeEach(() => {
    agent = new NewsSniperAgent();
  });

  it('validates task type matching', () => {
    const task = createTask('news-snipe', {});
    expect(agent.canHandle(task)).toBe(true);

    const otherTask = createTask('contrarian', {});
    expect(agent.canHandle(otherTask)).toBe(false);
  });

  it('agent has correct metadata', () => {
    expect(agent.name).toBe('news-snipe');
    expect(agent.description).toContain('momentum');
    expect(agent.taskTypes).toContain('news-snipe');
  });

  it('returns valid result structure', async () => {
    const task = createTask('news-snipe', { minMomentum: 5.0, limit: 100 });
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.agentName).toBe('news-snipe');
    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('result data includes required fields', async () => {
    const task = createTask('news-snipe', { minMomentum: 5.0, limit: 100 });
    const result = await agent.execute(task);

    expect(result.data).toHaveProperty('scanned');
    expect(result.data).toHaveProperty('signals');
    expect(result.data).toHaveProperty('results');
    expect(result.data).toHaveProperty('note');
  });

  it('accepts custom parameters', async () => {
    const task = createTask('news-snipe', { minMomentum: 10.0, limit: 50 });
    const result = await agent.execute(task);

    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('measures execution time', async () => {
    const task = createTask('news-snipe', { minMomentum: 5.0, limit: 100 });
    const result = await agent.execute(task);

    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('task type is in supported task types', () => {
    expect(agent.taskTypes).toContain('news-snipe');
  });

  it('can handle multiple consecutive executions', async () => {
    const task1 = createTask('news-snipe', { minMomentum: 5.0, limit: 100 });
    const result1 = await agent.execute(task1);
    expect(result1.success).toBeDefined();

    const task2 = createTask('news-snipe', { minMomentum: 10.0, limit: 50 });
    const result2 = await agent.execute(task2);
    expect(result2.success).toBeDefined();

    expect(result1.taskId).not.toBe(result2.taskId);
  });

  it('returns consistent agent name', async () => {
    const task = createTask('news-snipe', { minMomentum: 5.0, limit: 100 });
    const result = await agent.execute(task);

    expect(result.agentName).toBe(agent.name);
  });

  it('handles default parameters', async () => {
    const task = createTask('news-snipe', {});
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.data).toHaveProperty('scanned');
  });
});
