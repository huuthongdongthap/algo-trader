// EventCluster command — analyze cross-market correlations within events
// Usage: algo event-cluster [--min-markets <n>] [--min-diff <n>] [--limit <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createEventClusterCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'event-cluster',
    description: 'Analyze cross-market correlations within events to find lagging markets',
    taskType: 'event-cluster',
    options: [
      { flags: '--min-markets <n>', description: 'minimum markets per event (default: 3)', defaultValue: '3' },
      { flags: '--min-diff <n>', description: 'minimum price difference to flag (default: 0.10)', defaultValue: '0.10' },
      { flags: '--limit <n>', description: 'max events to scan', defaultValue: '30' },
    ],
    buildPayload: (_args, opts) => ({
      minMarkets: parseInt(opts['min-markets'] ?? '3', 10),
      minPriceDiff: parseFloat(opts['min-diff'] ?? '0.10'),
      limit: parseInt(opts['limit'] ?? '30', 10),
    }),
  });
}
