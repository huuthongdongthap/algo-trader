// Resolution Arb command — find markets in UMA oracle challenge window
// Usage: algo resolution-arb [--min-price <n>] [--limit <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createResolutionArbCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'resolution-arb',
    description: 'Find markets in resolution/challenge window for near risk-free arb',
    taskType: 'resolution-arb',
    options: [
      { flags: '--min-price <n>', description: 'minimum high-side price (default: 0.90)', defaultValue: '0.90' },
      { flags: '--limit <n>', description: 'max markets to scan', defaultValue: '200' },
    ],
    buildPayload: (_args, opts) => ({
      minPrice: parseFloat(opts['min-price'] ?? '0.90'),
      limit: parseInt(opts['limit'] ?? '200', 10),
    }),
  });
}
