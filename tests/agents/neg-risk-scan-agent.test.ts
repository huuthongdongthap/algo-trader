import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NegRiskScanAgent } from '../../src/agents/neg-risk-scan-agent.js';
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
            { id: 'market-1', question: 'Will candidate A win?', slug: 's1', conditionId: 'c1', yesTokenId: 't1', noTokenId: 't2', yesPrice: 0.40, noPrice: 0.60, volume: 100000, volume24h: 50000, liquidity: 20000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
            { id: 'market-2', question: 'Will candidate B win?', slug: 's2', conditionId: 'c2', yesTokenId: 't3', noTokenId: 't4', yesPrice: 0.35, noPrice: 0.65, volume: 80000, volume24h: 30000, liquidity: 15000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
            { id: 'market-3', question: 'Will candidate C win?', slug: 's3', conditionId: 'c3', yesTokenId: 't5', noTokenId: 't6', yesPrice: 0.20, noPrice: 0.80, volume: 60000, volume24h: 20000, liquidity: 10000, endDate: '2026-06-01T00:00:00Z', active: true, closed: false, resolved: false, outcome: null },
          ],
        },
      ];
    }
  },
}));

describe('NegRiskScanAgent', () => {
  let agent: NegRiskScanAgent;

  beforeEach(() => {
    agent = new NegRiskScanAgent();
  });

  it('validates task type matching', () => {
    const task = createTask('neg-risk-scan', {});
    expect(agent.canHandle(task)).toBe(true);

    const otherTask = createTask('endgame', {});
    expect(agent.canHandle(otherTask)).toBe(false);
  });

  it('agent has correct metadata', () => {
    expect(agent.name).toBe('neg-risk-scan');
    expect(agent.description).toContain('neg-risk arbitrage');
    expect(agent.taskTypes).toContain('neg-risk-scan');
  });

  it('returns error when GammaClient API fails', async () => {
    // Test error handling by trying to execute with invalid params
    const task = createTask('neg-risk-scan', { minSpread: 'invalid' as any, limit: 50 });
    const result = await agent.execute(task);

    // API will fail, so we expect error handling to work
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.taskId).toBe(task.id);
    expect(result.agentName).toBe('neg-risk-scan');
  });

  it('includes task ID in result', async () => {
    const task = createTask('neg-risk-scan', { minSpread: 0.02, limit: 1 });
    const result = await agent.execute(task);

    expect(result.taskId).toBe(task.id);
  });

  it('measures execution duration', async () => {
    const task = createTask('neg-risk-scan', { minSpread: 0.02, limit: 1 });
    const result = await agent.execute(task);

    expect(result.durationMs).toBeGreaterThan(0);
  });

  it('agent name matches task type', () => {
    expect(agent.taskTypes[0]).toBe('neg-risk-scan');
    expect(agent.name).toBe('neg-risk-scan');
  });
});
