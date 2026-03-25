// hft-loop command — continuous HFT-style OpenClaw command chain (24/7)
// Chain: warm → scan → estimate → risk → calibrate → report → repeat
// Usage: algo hft-loop [--interval <seconds>] [--max-cycles <n>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createHftLoopCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'hft-loop',
    description: 'Continuous HFT-style command chain — OpenClaw + DeepSeek R1 24/7',
    taskType: 'hft-loop',
    options: [
      { flags: '--interval <seconds>', description: 'seconds between cycles (default: 60)', defaultValue: '60' },
      { flags: '--max-cycles <n>', description: 'max cycles before exit (0=infinite)', defaultValue: '0' },
    ],
    buildPayload: (_args, opts) => ({
      interval: parseInt(opts['interval'] ?? '60', 10),
      maxCycles: parseInt(opts['maxCycles'] ?? '0', 10),
    }),
  });
}
