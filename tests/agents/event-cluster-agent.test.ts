import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventClusterAgent } from '../../src/agents/event-cluster-agent.js';
import { createTask } from '../../src/agents/agent-base.js';

vi.mock('../../src/polymarket/gamma-client.js', () => ({
  GammaClient: class {
    async getEvents(_limit?: number) {
      await new Promise(r => setTimeout(r, 1));
      return [
        {
          id: 'event-1',
          title: 'US Election Results',
          slug: 'us-election-results',
          description: 'Markets related to US elections',
          markets: [
            { id: 'market-1', question: 'Will candidate A win state X?', slug: 's1', conditionId: 'c1', yesTokenId: 't1', noTokenId: 't2', yesPrice: 0.85, noPrice: 0.15, volume: 100000, volume24h: 50000, liquidity: 20000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
            { id: 'market-2', question: 'Will candidate A win state Y?', slug: 's2', conditionId: 'c2', yesTokenId: 't3', noTokenId: 't4', yesPrice: 0.60, noPrice: 0.40, volume: 80000, volume24h: 30000, liquidity: 15000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
            { id: 'market-3', question: 'Will candidate A win state Z?', slug: 's3', conditionId: 'c3', yesTokenId: 't5', noTokenId: 't6', yesPrice: 0.45, noPrice: 0.55, volume: 60000, volume24h: 20000, liquidity: 10000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
            { id: 'market-4', question: 'Will candidate A win state W?', slug: 's4', conditionId: 'c4', yesTokenId: 't7', noTokenId: 't8', yesPrice: 0.90, noPrice: 0.10, volume: 70000, volume24h: 25000, liquidity: 12000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
          ],
        },
      ];
    }
  },
}));

describe('EventClusterAgent', () => {
  let agent: EventClusterAgent;

  beforeEach(() => {
    agent = new EventClusterAgent();
  });

  it('validates task type matching', () => {
    const task = createTask('event-cluster', {});
    expect(agent.canHandle(task)).toBe(true);

    const otherTask = createTask('volume-alert', {});
    expect(agent.canHandle(otherTask)).toBe(false);
  });

  it('agent has correct metadata', () => {
    expect(agent.name).toBe('event-cluster');
    expect(agent.description).toContain('correlation');
    expect(agent.taskTypes).toContain('event-cluster');
  });

  it('returns valid result structure', async () => {
    const task = createTask('event-cluster', { minMarkets: 3, minPriceDiff: 0.10, limit: 30 });
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.agentName).toBe('event-cluster');
    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('result data includes required fields', async () => {
    const task = createTask('event-cluster', { minMarkets: 3, minPriceDiff: 0.10, limit: 30 });
    const result = await agent.execute(task);

    expect(result.data).toHaveProperty('scanned');
    expect(result.data).toHaveProperty('clustersFound');
    expect(result.data).toHaveProperty('results');
    expect(result.data).toHaveProperty('note');
  });

  it('accepts custom parameters', async () => {
    const task = createTask('event-cluster', { minMarkets: 2, minPriceDiff: 0.20, limit: 50 });
    const result = await agent.execute(task);

    expect(result.taskId).toBe(task.id);
    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('measures execution time', async () => {
    const task = createTask('event-cluster', { minMarkets: 3, minPriceDiff: 0.10, limit: 30 });
    const result = await agent.execute(task);

    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('task type is in supported task types', () => {
    expect(agent.taskTypes).toContain('event-cluster');
  });

  it('can handle multiple consecutive executions', async () => {
    const task1 = createTask('event-cluster', { minMarkets: 3, minPriceDiff: 0.10, limit: 30 });
    const result1 = await agent.execute(task1);
    expect(result1.success).toBeDefined();

    const task2 = createTask('event-cluster', { minMarkets: 2, minPriceDiff: 0.20, limit: 50 });
    const result2 = await agent.execute(task2);
    expect(result2.success).toBeDefined();

    expect(result1.taskId).not.toBe(result2.taskId);
  });

  it('returns consistent agent name', async () => {
    const task = createTask('event-cluster', { minMarkets: 3, minPriceDiff: 0.10, limit: 30 });
    const result = await agent.execute(task);

    expect(result.agentName).toBe(agent.name);
  });

  it('handles default parameters', async () => {
    const task = createTask('event-cluster', {});
    const result = await agent.execute(task);

    expect(result.success).toBeDefined();
    expect(result.data).toHaveProperty('scanned');
  });
});
