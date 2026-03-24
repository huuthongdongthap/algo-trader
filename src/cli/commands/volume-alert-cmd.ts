// VolumeAlert command — detect volume anomalies across active markets
// Usage: algo volume-alert [--min-ratio <n>] [--limit <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createVolumeAlertCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'volume-alert',
    description: 'Detect volume anomalies across active markets (insider signal detection)',
    taskType: 'volume-alert',
    options: [
      { flags: '--min-ratio <n>', description: 'minimum volume/liquidity ratio to flag (default: 3.0)', defaultValue: '3.0' },
      { flags: '--limit <n>', description: 'max markets to scan', defaultValue: '100' },
    ],
    buildPayload: (_args, opts) => ({
      minVolumeRatio: parseFloat(opts['min-ratio'] ?? '3.0'),
      limit: parseInt(opts['limit'] ?? '100', 10),
    }),
  });
}
