// warm-model command — pre-heat DeepSeek R1 to eliminate cold-start latency
// Usage: algo warm-model [--url <llm-gateway-url>]

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createWarmModelCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'warm-model',
    description: 'Pre-heat DeepSeek R1 model (eliminate cold-start latency)',
    taskType: 'warm-model',
    options: [
      { flags: '--url <gateway-url>', description: 'LLM gateway URL (default: OPENCLAW_GATEWAY_URL or localhost:11435)' },
    ],
    buildPayload: (_args, opts) => ({
      url: opts['url'],
    }),
  });
}
