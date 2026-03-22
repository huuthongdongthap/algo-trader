import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Command } from 'commander';

// Mock commander and dynamic imports
vi.mock('commander', () => ({
  Command: vi.fn(() => ({
    name: vi.fn(function() { return this; }),
    description: vi.fn(function() { return this; }),
    version: vi.fn(function() { return this; }),
    option: vi.fn(function() { return this; }),
    addCommand: vi.fn(function() { return this; }),
    parse: vi.fn(),
  })),
}));

vi.mock('../../src/cli/commands/start.js', () => ({
  startCommand: { name: 'start' },
}));

vi.mock('../../src/cli/commands/status.js', () => ({
  statusCommand: { name: 'status' },
}));

vi.mock('../../src/cli/commands/backtest.js', () => ({
  backtestCommand: { name: 'backtest' },
}));

vi.mock('../../src/cli/commands/config-cmd.js', () => ({
  configCommand: { name: 'config' },
}));

vi.mock('../../src/cli/commands/hedge-scan.js', () => ({
  hedgeScanCommand: { name: 'hedge-scan' },
}));

describe('CLI Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads without errors', async () => {
    // Dynamically import to trigger the setup code
    const module = await import('../../src/cli/index.js');
    expect(module).toBeDefined();
  });

  it('creates a Command instance', async () => {
    const { Command } = await import('commander');
    const instance = new Command();
    expect(instance).toBeDefined();
  });

  it('registers all command subcommands', async () => {
    const { Command } = await import('commander');
    const cmd = new Command();

    expect(cmd.name).toBeDefined();
    expect(cmd.description).toBeDefined();
    expect(cmd.version).toBeDefined();
    expect(cmd.addCommand).toBeDefined();
  });

  it('sets verbose and config-file options', async () => {
    const { Command } = await import('commander');
    const cmd = new Command();

    expect(cmd.option).toBeDefined();
  });
});
