// seed-admin command — register or promote a user to admin role
// Usage: algo seed-admin --email <email> --password <pass>

import type { Command } from 'commander';
import type { AgentDispatcher } from '../../agents/agent-dispatcher.js';
import { registerCommand } from '../../agents/command-registry.js';

export function createSeedAdminCommand(program: Command, dispatcher: AgentDispatcher): Command {
  return registerCommand(program, dispatcher, {
    name: 'seed-admin',
    description: 'Register or promote a user to admin role',
    taskType: 'seed-admin',
    options: [
      { flags: '--email <email>', description: 'admin user email address' },
      { flags: '--password <pass>', description: 'admin user password (min 8 chars)' },
    ],
    buildPayload: (_args, opts) => ({
      email: opts['email'],
      password: opts['password'],
    }),
  });
}
