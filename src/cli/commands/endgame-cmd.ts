// Endgame command — find markets resolving soon with near-certain outcomes
// Usage: algo endgame [--hours <n>] [--min-price <n>] [--limit <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createEndgameCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'endgame',
    description: 'Find resolving-soon markets with high-confidence near-certain outcomes',
    taskType: 'endgame',
    options: [
      { flags: '--hours <n>', description: 'resolution window in hours (default: 48)', defaultValue: '48' },
      { flags: '--min-price <n>', description: 'minimum YES/NO price to flag (default: 0.85)', defaultValue: '0.85' },
      { flags: '--limit <n>', description: 'max markets to scan', defaultValue: '100' },
    ],
    buildPayload: (_args, opts) => ({
      hoursWindow: parseInt(opts['hours'] ?? '48', 10),
      minPrice: parseFloat(opts['min-price'] ?? '0.85'),
      limit: parseInt(opts['limit'] ?? '100', 10),
    }),
  });
}
