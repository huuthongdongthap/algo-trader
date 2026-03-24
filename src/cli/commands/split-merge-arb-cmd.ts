// SplitMergeArb command — monitor YES+NO prices for split/merge arbitrage
// Usage: algo split-merge-arb [--min-spread <n>] [--limit <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createSplitMergeArbCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'split-merge-arb',
    description: 'Monitor YES+NO prices vs $1.00 for split/merge arbitrage opportunities',
    taskType: 'split-merge-arb',
    options: [
      { flags: '--min-spread <n>', description: 'minimum spread in basis points (default: 100 = 1%)', defaultValue: '100' },
      { flags: '--limit <n>', description: 'max markets to scan', defaultValue: '100' },
    ],
    buildPayload: (_args, opts) => ({
      minSpreadBps: parseInt(opts['min-spread'] ?? '100', 10),
      limit: parseInt(opts['limit'] ?? '100', 10),
    }),
  });
}
