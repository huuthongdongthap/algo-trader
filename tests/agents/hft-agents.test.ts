// Tests for HFT + Admin agents: seed-admin, warm-model, hft-loop
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTask } from '../../src/agents/agent-base.js';
import { SeedAdminAgent } from '../../src/agents/seed-admin-agent.js';
import { WarmModelAgent } from '../../src/agents/warm-model-agent.js';
import { HftLoopAgent } from '../../src/agents/hft-loop-agent.js';
import { AgentDispatcher } from '../../src/agents/agent-dispatcher.js';
import { unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── SeedAdminAgent ─────────────────────────────────────────────────────

describe('SeedAdminAgent', () => {
  const agent = new SeedAdminAgent();
  const TEST_DB = join(tmpdir(), `test-seed-admin-${Date.now()}.db`);

  beforeEach(() => {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    process.env['USER_DB_PATH'] = TEST_DB;
  });

  afterEach(() => {
    delete process.env['USER_DB_PATH'];
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('has correct metadata', () => {
    expect(agent.name).toBe('seed-admin');
    expect(agent.taskTypes).toContain('seed-admin');
  });

  it('canHandle seed-admin tasks', () => {
    expect(agent.canHandle(createTask('seed-admin'))).toBe(true);
    expect(agent.canHandle(createTask('scan'))).toBe(false);
  });

  it('fails without email/password', async () => {
    const result = await agent.execute(createTask('seed-admin', {}));
    expect(result.success).toBe(false);
    expect(result.error).toContain('email and password required');
  });

  it('fails with short password', async () => {
    const result = await agent.execute(createTask('seed-admin', { email: 'a@b.com', password: '123' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('>= 8 chars');
  });

  it('creates admin user successfully', async () => {
    const result = await agent.execute(createTask('seed-admin', {
      email: 'admin@test.com',
      password: 'TestPass123!',
    }));
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.action).toBe('created');
    expect(data.role).toBe('admin');
    expect(data.email).toBe('admin@test.com');
  });

  it('promotes existing user to admin (idempotent)', async () => {
    // Create first
    await agent.execute(createTask('seed-admin', { email: 'user@test.com', password: 'TestPass123!' }));
    // Create again — should promote
    const result = await agent.execute(createTask('seed-admin', { email: 'user@test.com', password: 'TestPass123!' }));
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.action).toBe('promoted');
    expect(data.role).toBe('admin');
  });
});

// ── WarmModelAgent ─────────────────────────────────────────────────────

describe('WarmModelAgent', () => {
  const agent = new WarmModelAgent();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct metadata', () => {
    expect(agent.name).toBe('warm-model');
    expect(agent.taskTypes).toContain('warm-model');
  });

  it('canHandle warm-model tasks', () => {
    expect(agent.canHandle(createTask('warm-model'))).toBe(true);
    expect(agent.canHandle(createTask('scan'))).toBe(false);
  });

  it('returns warm status on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ model: 'test-model', usage: { total_tokens: 5 } }),
    }));

    const result = await agent.execute(createTask('warm-model', { url: 'http://fake:11435/v1' }));
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.status).toBe('warm');
    expect(data.model).toBe('test-model');
  });

  it('reports failure on gateway error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service unavailable'),
    }));

    const result = await agent.execute(createTask('warm-model', { url: 'http://fake:11435/v1' }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('503');
  });
});

// ── HftLoopAgent ───────────────────────────────────────────────────────

describe('HftLoopAgent', () => {
  const agent = new HftLoopAgent();

  it('has correct metadata', () => {
    expect(agent.name).toBe('hft-loop');
    expect(agent.taskTypes).toContain('hft-loop');
  });

  it('fails without dispatcher', async () => {
    const result = await agent.execute(createTask('hft-loop', { maxCycles: 1 }));
    expect(result.success).toBe(false);
    expect(result.error).toContain('Dispatcher not injected');
  });

  it('runs limited cycles with mock dispatcher', async () => {
    const dispatcher = new AgentDispatcher();
    // Register mock agents for each step in the chain
    const mockAgent = {
      name: 'mock',
      description: 'mock',
      taskTypes: ['scan', 'estimate', 'risk', 'calibrate', 'report', 'warm-model'] as import('../../src/agents/agent-base.js').AgentTaskType[],
      canHandle: () => true,
      execute: async (task: import('../../src/agents/agent-base.js').AgentTask) => ({
        agentName: 'mock',
        taskId: task.id,
        success: true,
        data: { mock: true },
        durationMs: 1,
      }),
    };
    dispatcher.register(mockAgent);

    agent.setDispatcher(dispatcher);
    const result = await agent.execute(createTask('hft-loop', { maxCycles: 2, interval: 0 }));
    expect(result.success).toBe(true);
    const data = result.data as Record<string, unknown>;
    expect(data.totalCycles).toBe(2);
  });

  it('stop() halts the loop', () => {
    agent.stop();
    // No crash — just verifies method exists and is callable
  });
});
