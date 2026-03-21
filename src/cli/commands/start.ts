// Start trading bot command
// Usage: algo-trade start --strategy <name> [--dry-run] [--capital <amount>]

import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

const VALID_STRATEGIES: StrategyName[] = [
  'cross-market-arb',
  'market-maker',
  'grid-trading',
  'dca-bot',
  'funding-rate-arb',
];

interface StartOptions {
  strategy?: string;
  dryRun: boolean;
  capital?: string;
}

function printBanner(opts: StartOptions, configEnv: string): void {
  const mode = opts.dryRun ? 'PAPER TRADING (dry-run)' : 'LIVE TRADING';
  const capital = opts.capital ? `$${opts.capital}` : 'from config';
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║         ALGO-TRADE PLATFORM          ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log(`  Mode     : ${mode}`);
  console.log(`  Strategy : ${opts.strategy ?? 'all enabled'}`);
  console.log(`  Capital  : ${capital}`);
  console.log(`  Env      : ${configEnv}`);
  console.log('');
}

function validateStrategy(name: string): name is StrategyName {
  return (VALID_STRATEGIES as string[]).includes(name);
}

export const startCommand = new Command('start')
  .description('Start one or all trading strategies')
  .option('-s, --strategy <name>', `strategy to run (${VALID_STRATEGIES.join(', ')})`)
  .option('-d, --dry-run', 'paper trading mode - no real orders', false)
  .option('-c, --capital <amount>', 'initial capital in USD (overrides config)')
  .action((opts: StartOptions) => {
    // Validate strategy name if provided
    if (opts.strategy && !validateStrategy(opts.strategy)) {
      console.error(`Error: unknown strategy "${opts.strategy}"`);
      console.error(`Valid strategies: ${VALID_STRATEGIES.join(', ')}`);
      process.exit(1);
    }

    // Load config (validates env vars)
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Config error: ${msg}`);
      process.exit(1);
    }

    logger.setLevel(config.logLevel);

    printBanner(opts, config.env);

    if (opts.strategy) {
      logger.info(`Starting strategy ${opts.strategy}...`, 'cli:start', {
        dryRun: opts.dryRun,
        capital: opts.capital,
      });
      console.log(`  Starting strategy: ${opts.strategy}`);
    } else {
      logger.info('Starting all enabled strategies...', 'cli:start', { dryRun: opts.dryRun });
      console.log('  Starting all enabled strategies...');
    }

    // Stub: actual strategy wiring happens in integration phase
    console.log('\n  [stub] Strategy engine not yet wired - integration phase pending.\n');
  });
