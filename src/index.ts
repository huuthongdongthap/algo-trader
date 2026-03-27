/**
 * Algo Trader - Main entry point
 * Algorithmic trading platform with zero-config onboarding
 */

import { Command } from 'commander';
import { initSentry } from './utils/sentry-init';
import { runMigrations } from './db/migration-runner';
import { runGruStrategy } from './commands/gru-strategy';
import { runSetupWizard } from './commands/setup-wizard';
import { runQuickstart } from './commands/quickstart';
import { runActivateCommand } from './commands/activate-license';
import { runArbAuto } from './commands/arb-auto';
import { logger } from './utils/logger';

// Initialize Sentry before anything else
initSentry();

export interface GruStrategyOptions {
  inputSteps: string;
  gruUnits: string;
  epochs: string;
  threshold: string;
  symbol: string;
  mode: string;
}

export interface ArbAutoOptions {
  symbols: string;
  exchanges: string;
  minSpread: string;
  dryRun: boolean;
  verbose: boolean;
}

export const version = '1.0.0';

export function main(): void {
  logger.info(`Algo Trader v${version} started`);
  // Run migrations on startup (non-blocking if DB not configured)
  runMigrations().catch((err) => {
    logger.warn('[Startup] Migration runner skipped (DB may not be configured):', { err });
  });
}

// CLI setup - only run in non-test environment
const isTest = process.env.NODE_ENV === 'test' || process.argv.includes('vitest');

if (!isTest) {
  const program = new Command();

  program
    .name('algo-trader')
    .description('Algorithmic trading bot with ML strategies and zero-config onboarding')
    .version(version);

  program
    .command('gru')
    .description('Run GRU Neural Network trading strategy')
    .option('-i, --input-steps <number>', 'Number of historical candles', '60')
    .option('-u, --gru-units <number>', 'GRU layer units', '64')
    .option('-e, --epochs <number>', 'Training epochs', '50')
    .option('-t, --threshold <number>', 'Confidence threshold (0-1)', '0.7')
    .option('-s, --symbol <symbol>', 'Trading pair', 'BTC/USDT')
    .option('-m, --mode <mode>', 'Running mode (live/backtest)', 'backtest')
    .action(async (options: GruStrategyOptions) => {
      await runGruStrategy({
        inputSteps: parseInt(options.inputSteps),
        gruUnits: parseInt(options.gruUnits),
        epochs: parseInt(options.epochs),
        confidenceThreshold: parseFloat(options.threshold),
        symbol: options.symbol,
        mode: options.mode as 'live' | 'backtest',
      });
    });

  program
    .command('setup')
    .description('Interactive setup wizard - configure API keys, risk preferences, trading mode')
    .action(async () => {
      await runSetupWizard();
    });

  program
    .command('quickstart')
    .description('Zero-config start - instant trading with defaults')
    .action(async () => {
      await runQuickstart();
    });

  program
    .command('activate [key]')
    .description('Activate beta invite license key')
    .action(async (key?: string) => {
      await runActivateCommand(key);
    });

  program
    .command('arb:auto')
    .description('Autonomous arbitrage trading - WS feeds, spread detection, atomic execution')
    .option('-s, --symbols <symbols>', 'Trading pairs (comma-separated)', 'BTC/USDT,ETH/USDT,SOL/USDT')
    .option('-e, --exchanges <exchanges>', 'Exchanges (comma-separated)', 'binance,okx,bybit')
    .option('--min-spread <percent>', 'Minimum spread percentage', '0.05')
    .option('--dry-run', 'Dry run mode (no real trades)', true)
    .option('--no-dry-run', 'Live trading mode (real trades)')
    .option('-v, --verbose', 'Verbose logging', true)
    .action(async (options: ArbAutoOptions) => {
      await runArbAuto({
        symbols: options.symbols,
        exchanges: options.exchanges,
        minSpread: parseFloat(options.minSpread),
        dryRun: options.dryRun,
        verbose: options.verbose,
      });
    });

  program.parse(process.argv);

  // Run main if no command specified
  if (!process.argv.slice(2).length) {
    main();
    program.help();
  }
}
