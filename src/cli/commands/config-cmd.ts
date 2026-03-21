// Config command - show and validate current configuration
// Usage: algo-trade config show | algo-trade config validate

import { Command } from 'commander';
import { loadConfig, validateConfig } from '../../core/config.js';
import type { AppConfig } from '../../core/types.js';

function printConfig(config: AppConfig): void {
  console.log('\n  === algo-trade config ===\n');
  console.log(`  env          : ${config.env}`);
  console.log(`  logLevel     : ${config.logLevel}`);
  console.log(`  dbPath       : ${config.dbPath}`);
  console.log('');
  console.log('  Risk Limits:');
  console.log(`    maxPositionSize  : $${config.riskLimits.maxPositionSize}`);
  console.log(`    maxDrawdown      : ${(config.riskLimits.maxDrawdown * 100).toFixed(0)}%`);
  console.log(`    maxOpenPositions : ${config.riskLimits.maxOpenPositions}`);
  console.log(`    stopLossPercent  : ${(config.riskLimits.stopLossPercent * 100).toFixed(0)}%`);
  console.log(`    maxLeverage      : ${config.riskLimits.maxLeverage}x`);
  console.log('');
  console.log('  Exchanges configured:');
  const exchanges = Object.keys(config.exchanges);
  if (exchanges.length === 0) {
    console.log('    (none)');
  } else {
    for (const ex of exchanges) {
      console.log(`    ${ex} : apiKey=${config.exchanges[ex]?.apiKey.slice(0, 8)}...`);
    }
  }
  console.log('');
  console.log('  Polymarket:');
  console.log(`    clobUrl : ${config.polymarket.clobUrl}`);
  console.log(`    chainId : ${config.polymarket.chainId}`);
  console.log(`    rpcUrl  : ${config.polymarket.rpcUrl}`);
  console.log('');
  console.log(`  Strategies enabled: ${config.strategies.filter(s => s.enabled).length} / ${config.strategies.length}`);
  console.log('');
}

const showSubCommand = new Command('show')
  .description('Print current configuration (redacts secrets)')
  .action(() => {
    try {
      const config = loadConfig();
      printConfig(config);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Config load error: ${msg}`);
      process.exit(1);
    }
  });

const validateSubCommand = new Command('validate')
  .description('Validate .env configuration and report issues')
  .action(() => {
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n  Config load failed: ${msg}\n`);
      process.exit(1);
    }

    const errors = validateConfig(config);
    if (errors.length === 0) {
      console.log('\n  Config valid - all checks passed.\n');
    } else {
      console.error('\n  Config validation errors:');
      for (const e of errors) {
        console.error(`    - ${e}`);
      }
      console.error('');
      process.exit(1);
    }
  });

export const configCommand = new Command('config')
  .description('View or validate configuration')
  .addCommand(showSubCommand)
  .addCommand(validateSubCommand);
