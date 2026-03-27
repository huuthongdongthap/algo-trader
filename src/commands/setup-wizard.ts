/**
 * Setup Wizard - Interactive CLI for Zero-Config Onboarding
 * Prompts for API keys, risk preferences, and trading mode
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from '../utils/logger';
import { join } from 'path';
import * as readline from 'readline';

interface SetupConfig {
  exchangeApiKey: string;
  exchangeSecret: string;
  tradingMode: 'dry-run' | 'live';
  riskPerTrade: number;
  maxDailyLoss: number;
  telegramBotToken?: string;
  telegramChatId?: string;
}

const ENV_EXAMPLE_PATH = join(process.cwd(), '.env.example');
const ENV_PATH = join(process.cwd(), '.env');

const RISK_PRESETS = {
  conservative: { riskPerTrade: 0.5, maxDailyLoss: 2 },
  moderate: { riskPerTrade: 1, maxDailyLoss: 5 },
  aggressive: { riskPerTrade: 2, maxDailyLoss: 10 },
} as const;

// Async prompt helper
function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

async function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question + ' ', (answer: string) => {
      resolve(answer);
    });
  });
}

export async function runSetupWizard(): Promise<void> {
  const rl = createPrompt();

  try {
    logger.info('\n🚀 Algo Trader Setup Wizard\n');
    logger.info('This wizard will help you configure your trading bot.\n');

    const config: Partial<SetupConfig> = {};

    // Step 1: Exchange API Keys
    logger.info('━━━ Step 1: Exchange API Keys ━━━\n');
    logger.info('Enter your exchange API credentials.');
    logger.info('Leave blank to skip (required for live trading).\n');

    config.exchangeApiKey = await prompt(rl, 'Exchange API Key:') || '';
    config.exchangeSecret = await prompt(rl, 'Exchange API Secret:') || '';

    if (config.exchangeApiKey && config.exchangeSecret) {
      logger.info('✅ API keys saved\n');
    } else {
      logger.info('⚠️  Skipping API keys (dry-run mode only)\n');
    }

    // Step 2: Trading Mode
    logger.info('━━━ Step 2: Trading Mode ━━━\n');
    logger.info('Select your trading mode:');
    logger.info('  1) dry-run - Paper trading, no real money');
    logger.info('  2) live - Real trading with real money\n');

    const modeChoice = await prompt(rl, 'Enter choice (1 or 2):') || '1';
    config.tradingMode = modeChoice === '2' ? 'live' : 'dry-run';
    logger.info(`✅ Trading mode: ${config.tradingMode}\n`);

    // Step 3: Risk Preferences
    logger.info('━━━ Step 3: Risk Preferences ━━━\n');
    logger.info('Choose your risk profile:');
    logger.info('  1) Conservative - 0.5% per trade, 2% daily max');
    logger.info('  2) Moderate - 1% per trade, 5% daily max (recommended)');
    logger.info('  3) Aggressive - 2% per trade, 10% daily max');
    logger.info('  4) Custom - Enter your own values\n');

    const riskChoice = await prompt(rl, 'Enter choice (1-4):') || '2';

    if (riskChoice === '4') {
      const riskPerTrade = parseFloat(await prompt(rl, 'Risk per trade (%)?') || '1');
      const maxDailyLoss = parseFloat(await prompt(rl, 'Max daily loss (%)?') || '5');
      config.riskPerTrade = riskPerTrade;
      config.maxDailyLoss = maxDailyLoss;
    } else {
      const presetKeys = Object.keys(RISK_PRESETS);
      const presetIndex = parseInt(riskChoice) - 1;
      if (presetIndex >= 0 && presetIndex < presetKeys.length) {
        const preset = RISK_PRESETS[presetKeys[presetIndex] as keyof typeof RISK_PRESETS];
        config.riskPerTrade = preset.riskPerTrade;
        config.maxDailyLoss = preset.maxDailyLoss;
      } else {
        config.riskPerTrade = 1;
        config.maxDailyLoss = 5;
      }
    }
    logger.info(`✅ Risk: ${config.riskPerTrade}% per trade, ${config.maxDailyLoss}% daily max\n`);

    // Step 4: Telegram Notifications (Optional)
    logger.info('━━━ Step 4: Telegram Notifications (Optional) ━━━\n');
    logger.info('Get trade notifications on Telegram.');
    logger.info('Leave blank to skip.\n');

    const setupTelegram = (await prompt(rl, 'Setup Telegram? (y/N):')).trim().toLowerCase();
    if (setupTelegram === 'y' || setupTelegram === 'yes') {
      config.telegramBotToken = await prompt(rl, 'Telegram Bot Token:') || '';
      config.telegramChatId = await prompt(rl, 'Telegram Chat ID:') || '';
      if (config.telegramBotToken && config.telegramChatId) {
        logger.info('✅ Telegram configured\n');
      } else {
        logger.info('⚠️  Skipping Telegram\n');
      }
    }

    // Generate .env file
    logger.info('━━━ Saving Configuration ━━━\n');
    saveConfiguration(config);

    logger.info('\n✅ Setup complete!\n');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    logger.info('Next steps:');
    logger.info('  1. Run `npm run quickstart` to start trading');
    logger.info('  2. Monitor logs for trade signals');
    logger.info('  3. Check /dashboard for real-time stats\n');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } finally {
    rl.close();
  }
}

function saveConfiguration(config: Partial<SetupConfig>): void {
  const envContent = generateEnvContent(config);
  writeFileSync(ENV_PATH, envContent);
  logger.info(`✅ Configuration saved to: ${ENV_PATH}`);

  // Also update .env.example if it exists
  if (existsSync(ENV_EXAMPLE_PATH)) {
    const exampleContent = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');
    const updatedExample = mergeWithExample(exampleContent, config);
    writeFileSync(ENV_EXAMPLE_PATH, updatedExample);
    logger.info(`✅ Updated: ${ENV_EXAMPLE_PATH}`);
  }
}

function generateEnvContent(config: Partial<SetupConfig>): string {
  const timestamp = new Date().toISOString();
  return `# Algo Trader Configuration
# Generated: ${timestamp}
# WARNING: Never commit this file to version control

# Exchange API Keys
EXCHANGE_API_KEY=${config.exchangeApiKey || 'your-api-key-here'}
EXCHANGE_SECRET=${config.exchangeSecret || 'your-secret-here'}

# Trading Mode
TRADING_MODE=${config.tradingMode || 'dry-run'}
DRY_RUN=${config.tradingMode === 'dry-run' ? 'true' : 'false'}

# Risk Management
RISK_PER_TRADE=${config.riskPerTrade || 1}
MAX_DAILY_LOSS=${config.maxDailyLoss || 5}

# Telegram Notifications (Optional)
TELEGRAM_BOT_TOKEN=${config.telegramBotToken || ''}
TELEGRAM_CHAT_ID=${config.telegramChatId || ''}

# Bot Configuration
ENABLE_BACKTESTING=true
ENABLE_LIVE_TRADING=${config.tradingMode === 'live'}
LOG_LEVEL=info
`;
}

function mergeWithExample(example: string, config: Partial<SetupConfig>): string {
  let updated = example;

  const replacements: Record<string, string> = {
    'EXCHANGE_API_KEY=.*': `EXCHANGE_API_KEY=${config.exchangeApiKey || 'your-api-key-here'}`,
    'EXCHANGE_SECRET=.*': `EXCHANGE_SECRET=${config.exchangeSecret || 'your-secret-here'}`,
    'TRADING_MODE=.*': `TRADING_MODE=${config.tradingMode || 'dry-run'}`,
    'DRY_RUN=.*': `DRY_RUN=${config.tradingMode === 'dry-run' ? 'true' : 'false'}`,
    'RISK_PER_TRADE=.*': `RISK_PER_TRADE=${config.riskPerTrade || 1}`,
    'MAX_DAILY_LOSS=.*': `MAX_DAILY_LOSS=${config.maxDailyLoss || 5}`,
  };

  for (const [pattern, value] of Object.entries(replacements)) {
    const regex = new RegExp(pattern, 'g');
    if (updated.match(regex)) {
      updated = updated.replace(regex, value);
    }
  }

  return updated;
}
