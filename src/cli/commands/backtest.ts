// Backtest command - run strategy simulation against historical data
// Usage: algo-trade backtest --strategy <name> --from <date> --to <date> [--capital <amount>]

import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import type { StrategyName } from '../../core/types.js';

export interface BacktestResult {
  strategy: StrategyName;
  fromDate: string;
  toDate: string;
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;      // decimal, e.g. 0.15 = 15%
  maxDrawdown: number;      // decimal
  sharpeRatio: number;
  totalTrades: number;
  winRate: number;          // decimal
  profitFactor: number;
}

interface BacktestOptions {
  strategy: string;
  from: string;
  to: string;
  capital: string;
}

const VALID_STRATEGIES: StrategyName[] = [
  'cross-market-arb',
  'market-maker',
  'grid-trading',
  'dca-bot',
  'funding-rate-arb',
];

function parseDate(str: string, label: string): Date {
  const d = new Date(str);
  if (isNaN(d.getTime())) {
    console.error(`Error: invalid ${label} date "${str}". Use ISO format: YYYY-MM-DD`);
    process.exit(1);
  }
  return d;
}

function validateStrategy(name: string): name is StrategyName {
  return (VALID_STRATEGIES as string[]).includes(name);
}

export const backtestCommand = new Command('backtest')
  .description('Run historical backtest for a strategy')
  .requiredOption('-s, --strategy <name>', `strategy to backtest (${VALID_STRATEGIES.join(', ')})`)
  .requiredOption('-f, --from <date>', 'start date in YYYY-MM-DD format')
  .requiredOption('-t, --to <date>', 'end date in YYYY-MM-DD format')
  .option('-c, --capital <amount>', 'initial capital in USD', '10000')
  .action((opts: BacktestOptions) => {
    if (!validateStrategy(opts.strategy)) {
      console.error(`Error: unknown strategy "${opts.strategy}"`);
      console.error(`Valid strategies: ${VALID_STRATEGIES.join(', ')}`);
      process.exit(1);
    }

    const fromDate = parseDate(opts.from, '--from');
    const toDate = parseDate(opts.to, '--to');

    if (fromDate >= toDate) {
      console.error('Error: --from date must be before --to date');
      process.exit(1);
    }

    const capital = parseFloat(opts.capital);
    if (isNaN(capital) || capital <= 0) {
      console.error('Error: --capital must be a positive number');
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Config error: ${msg}`);
      process.exit(1);
    }

    logger.setLevel(config.logLevel);

    console.log('\n  === algo-trade backtest ===\n');
    console.log(`  Strategy : ${opts.strategy}`);
    console.log(`  From     : ${opts.from}`);
    console.log(`  To       : ${opts.to}`);
    console.log(`  Capital  : $${capital.toFixed(2)}`);
    console.log('');

    logger.info(
      `Backtesting strategy ${opts.strategy} from ${opts.from} to ${opts.to}...`,
      'cli:backtest',
      { capital, fromDate: opts.from, toDate: opts.to }
    );

    // Stub: backtest engine wired in integration phase
    console.log('  [stub] Backtest engine not yet wired - integration phase pending.\n');
  });
