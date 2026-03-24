// NegRiskScan command — scan multi-outcome events for YES sum arbitrage
// Usage: algo neg-risk-scan [--min-spread <n>] [--limit <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createNegRiskScanCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'neg-risk-scan',
    description: 'Scan multi-outcome events for neg-risk arbitrage (YES sum != $1.00)',
    taskType: 'neg-risk-scan',
    options: [
      { flags: '--min-spread <n>', description: 'minimum spread from $1.00 to flag (default: 0.02)', defaultValue: '0.02' },
      { flags: '--limit <n>', description: 'max events to scan', defaultValue: '50' },
    ],
    buildPayload: (_args, opts) => ({
      minSpread: parseFloat(opts['min-spread'] ?? '0.02'),
      limit: parseInt(opts['limit'] ?? '50', 10),
    }),
  });
}
