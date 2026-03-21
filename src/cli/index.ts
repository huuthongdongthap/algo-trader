// CLI entry point - Commander.js program setup
// algo-trade: Algorithmic trading platform CLI

import { Command } from 'commander';
import { createRequire } from 'module';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { backtestCommand } from './commands/backtest.js';
import { configCommand } from './commands/config-cmd.js';

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const pkg = require('../../package.json') as { version: string; description: string };

const program = new Command();

program
  .name('algo-trade')
  .description(pkg.description)
  .version(pkg.version)
  .option('-v, --verbose', 'enable verbose/debug logging')
  .option('--config-file <path>', 'path to .env config file (default: .env)');

program.addCommand(startCommand);
program.addCommand(statusCommand);
program.addCommand(backtestCommand);
program.addCommand(configCommand);

program.parse(process.argv);
