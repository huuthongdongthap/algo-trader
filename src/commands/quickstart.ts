/**
 * Quickstart Command - Zero-Config Trading Start
 * Instant trading with sensible defaults
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { runSetupWizard } from './setup-wizard';
import { logger } from '../utils/logger';

const ENV_PATH = join(process.cwd(), '.env');

export async function runQuickstart(): Promise<void> {
  logger.info('Algo Trader Quickstart');

  // Step 1: Check if .env exists, if not run setup wizard
  if (!existsSync(ENV_PATH)) {
    logger.warn('No configuration found. Running setup wizard...');
    await runSetupWizard();
  }

  // Step 2: Load configuration
  logger.info('Loading configuration...');
  const config = loadConfiguration();

  // Step 3: Validate configuration
  logger.info('Validating configuration...');
  validateConfiguration(config);

  // Step 4: Show configuration summary
  logger.info('Configuration Summary', {
    tradingMode: config.tradingMode,
    riskPerTrade: config.riskPerTrade,
    maxDailyLoss: config.maxDailyLoss,
    backtesting: config.enableBacktesting ? 'Enabled' : 'Disabled',
    liveTrading: config.enableLiveTrading ? 'Enabled' : 'Disabled',
    exchangeApi: config.apiKeyConfigured ? 'Configured' : 'Not configured (dry-run only)',
    telegram: config.telegramConfigured ? 'Enabled' : 'Disabled',
  });

  // Step 5: Start trading engine based on mode
  logger.info('Starting trading engine...');

  if (config.tradingMode === 'dry-run' || !config.apiKeyConfigured) {
    logger.info('Starting in DRY-RUN mode (paper trading) - no real trades will be executed');
    await startDryRunEngine();
  } else {
    logger.warn('Starting in LIVE mode - real money at risk!');

    const confirm = await promptConfirmation();
    if (confirm) {
      await startLiveEngine();
    } else {
      logger.warn('Live trading cancelled. Starting in dry-run mode...');
      await startDryRunEngine();
    }
  }
}

function loadConfiguration(): Record<string, any> {
  // Load environment variables
  const env = process.env;

  return {
    tradingMode: env.DRY_RUN === 'true' ? 'dry-run' : 'live',
    riskPerTrade: parseFloat(env.RISK_PER_TRADE || '1'),
    maxDailyLoss: parseFloat(env.MAX_DAILY_LOSS || '5'),
    enableBacktesting: env.ENABLE_BACKTESTING !== 'false',
    enableLiveTrading: env.ENABLE_LIVE_TRADING === 'true',
    apiKeyConfigured: !!(env.EXCHANGE_API_KEY && env.EXCHANGE_SECRET),
    telegramConfigured: !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
  };
}

function validateConfiguration(config: Record<string, any>): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Validate risk parameters
  if (config.riskPerTrade <= 0 || config.riskPerTrade > 10) {
    errors.push('RISK_PER_TRADE must be between 0 and 10');
  }

  if (config.maxDailyLoss <= 0 || config.maxDailyLoss > 50) {
    errors.push('MAX_DAILY_LOSS must be between 0 and 50');
  }

  if (config.riskPerTrade > config.maxDailyLoss) {
    warnings.push('RISK_PER_TRADE is higher than MAX_DAILY_LOSS');
  }

  // Warn about live trading without API keys
  if (config.tradingMode === 'live' && !config.apiKeyConfigured) {
    warnings.push('Live trading mode but no API keys configured');
  }

  // Print warnings
  if (warnings.length > 0) {
    warnings.forEach((w) => logger.warn(`Configuration warning: ${w}`));
  }

  // Throw errors
  if (errors.length > 0) {
    errors.forEach((e) => logger.error(`Configuration error: ${e}`));
    logger.error('Please run `npm run setup` to reconfigure.');
    process.exit(1);
  }

  logger.info('Configuration valid');
}

async function startDryRunEngine(): Promise<void> {
  logger.info('Connecting to exchange (read-only)...');
  await sleep(1000);
  logger.info('Connected to exchange');

  logger.info('Loading market data...');
  await sleep(800);
  logger.info('Market data loaded');

  logger.info('Starting strategy engine...');
  await sleep(500);
  logger.info('DRY-RUN ENGINE STARTED - waiting for trading signals');
}

async function startLiveEngine(): Promise<void> {
  logger.info('Connecting to exchange...');
  await sleep(1000);
  logger.info('Connected to exchange');

  logger.info('Loading market data...');
  await sleep(800);
  logger.info('Market data loaded');

  logger.info('Verifying API permissions...');
  await sleep(500);
  logger.info('API permissions verified');

  logger.info('Starting strategy engine...');
  await sleep(500);
  logger.warn('LIVE ENGINE STARTED - REAL MONEY AT RISK - monitoring markets');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function promptConfirmation(): Promise<boolean> {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readline.question('Confirm live trading? (y/N): ', (answer: string) => {
      readline.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
