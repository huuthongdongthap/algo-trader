// Whale Watch command — monitor Polygon CTF for large position transfers
// Usage: algo whale-watch [--min-value <n>] [--blocks <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createWhaleWatchCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'whale-watch',
    description: 'Monitor Polygon CTF Exchange for whale movements (large TransferSingle events)',
    taskType: 'whale-watch',
    options: [
      { flags: '--min-value <n>', description: 'minimum USDC value to flag (default: 10000)', defaultValue: '10000' },
      { flags: '--blocks <n>', description: 'number of recent blocks to scan (default: 500)', defaultValue: '500' },
    ],
    buildPayload: (_args, opts) => ({
      minValueUsdc: parseInt(opts['min-value'] ?? '10000', 10),
      blockRange: parseInt(opts['blocks'] ?? '500', 10),
    }),
  });
}
