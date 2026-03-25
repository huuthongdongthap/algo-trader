import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EndgameAgent } from '../../src/agents/endgame-agent.js';
import { createTask } from '../../src/agents/agent-base.js';

vi.mock('../../src/polymarket/gamma-client.js', () => ({
  GammaClient: class {
    async getTrending(_limit?: number) {
      await new Promise(r => setTimeout(r, 1));
      return [
        { id: 'market-1', question: 'Will X happen?', slug: 'will-x-happen', conditionId: 'c1', yesTokenId: 't1', noTokenId: 't2', yesPrice: 0.92, noPrice: 0.08, volume: 100000, volume24h: 50000, liquidity: 20000, endDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), active: true, closed: false, resolved: false, outcome: null },
        { id: 'market-2', question: 'Will Y happen?', slug: 'will-y-happen', conditionId: 'c2', yesTokenId: 't3', noTokenId: 't4', yesPrice: 0.70, noPrice: 0.30, volume: 80000, volume24h: 30000, liquidity: 15000, endDate: new Date(Date.now() + 36 * 60 * 60 * 1000).toISOString(), active: true, closed: false, resolved: false, outcome: null },
      ];
    }
  },
}));

describe('EndgameAgent', () => {
  let agent: EndgameAgent;

  beforeEach(() => {
    agent = new EndgameAgent();
  });

  it('validates task type matching', () => {
    const task = createTask('endgame', {});
    expect(agent.canHandle(task)).toBe(true);

    const otherTask = createTask('neg-risk-scan', {});
    expect(agent.canHandle(otherTask)).toBe(false);
  });

  it('agent has correct metadata', () => {
    expect(agent.name).toBe('endgame');
    expect(agent.description).toContain('resolving-soon');
    expect(agent.taskTypes).toContain('endgame');
  });

  it('returns valid result structure', async () => {
    const task = createTask('endgame', { hoursWindow: 48, minPrice: 0.85, limit: 100 });
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.agentName).toBe('endgame');
    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.data).toBeDefined();
  });

  it('result data includes required fields', async () => {
    const task = createTask('endgame', { hoursWindow: 48, minPrice: 0.85, limit: 100 });
    const result = await agent.execute(task);

    expect(result.data).toHaveProperty('scanned');
    expect(result.data).toHaveProperty('opportunities');
    expect(result.data).toHaveProperty('results');
    expect(result.data).toHaveProperty('note');
  });

  it('accepts custom parameters', async () => {
    const task = createTask('endgame', { hoursWindow: 24, minPrice: 0.90, limit: 50 });
    const result = await agent.execute(task);

    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('measures execution time', async () => {
    const task = createTask('endgame', { hoursWindow: 48, minPrice: 0.85, limit: 100 });
    const result = await agent.execute(task);

    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('task type is in supported task types', () => {
    expect(agent.taskTypes).toContain('endgame');
  });

  it('can handle multiple consecutive executions', async () => {
    const task1 = createTask('endgame', { hoursWindow: 48, minPrice: 0.85, limit: 100 });
    const result1 = await agent.execute(task1);
    expect(result1.success).toBeDefined();

    const task2 = createTask('endgame', { hoursWindow: 24, minPrice: 0.90, limit: 50 });
    const result2 = await agent.execute(task2);
    expect(result2.success).toBeDefined();

    expect(result1.taskId).not.toBe(result2.taskId);
  });

  it('returns consistent agent name', async () => {
    const task = createTask('endgame', { hoursWindow: 48, minPrice: 0.85, limit: 100 });
    const result = await agent.execute(task);

    expect(result.agentName).toBe(agent.name);
  });
});
