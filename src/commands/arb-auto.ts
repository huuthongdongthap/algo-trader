/**
 * ARB:AUTO Command - Autonomous Arbitrage Trading
 * Full autonomous trading loop with WS feeds, spread detection, atomic execution
 */

import { TradingLoop } from '../arbitrage/trading-loop';
import { logger } from '../utils/logger';
import { existsSync } from 'fs';
import { join } from 'path';

const ENV_PATH = join(process.cwd(), '.env');

export interface AutoCommandOptions {
  symbols?: string;
  exchanges?: string;
  minSpread?: number;
  dryRun?: boolean;
  verbose?: boolean;
}

export async function runArbAuto(options: AutoCommandOptions = {}): Promise<void> {
  logger.info('\n⚡ ARB:AUTO — Autonomous Arbitrage Trading\n');
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Check configuration
  if (!existsSync(ENV_PATH)) {
    logger.info('⚠️  No .env found. Please run `algo-trader setup` first.\n');
    logger.info('Or create .env with:\n');
    logger.info('  EXCHANGE_API_KEY=your_api_key');
    logger.info('  EXCHANGE_SECRET=your_secret');
    logger.info('  REDIS_URL=redis://localhost:6379');
    logger.info('  DATABASE_URL=postgresql://...\n');
    process.exit(1);
  }

  // Parse options
  const symbols = options.symbols
    ? options.symbols.split(',').map((s) => s.trim())
    : ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'];

  const exchanges = options.exchanges
    ? options.exchanges.split(',').map((e) => e.trim().toLowerCase())
    : ['binance', 'okx', 'bybit'];

  const minSpread = options.minSpread || 0.05;
  const dryRun = options.dryRun ?? true;
  const verbose = options.verbose ?? true;

  logger.info('📋 Configuration:');
  logger.info(`  Symbols: ${symbols.join(', ')}`);
  logger.info(`  Exchanges: ${exchanges.join(', ')}`);
  logger.info(`  Min Spread: ${minSpread}%`);
  logger.info(`  Mode: ${dryRun ? 'DRY-RUN' : 'LIVE'}`);
  logger.info(`  Verbose: ${verbose ? 'Yes' : 'No'}\n`);

  if (dryRun) {
    logger.info('📝 DRY-RUN MODE — No real trades will be executed\n');
  } else {
    logger.info('⚠️  LIVE MODE — Real money at risk!\n');
    const confirm = await promptConfirmation();
    if (!confirm) {
      logger.info('\n⚠️  Live trading cancelled. Exiting.\n');
      process.exit(0);
    }
  }

  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Initialize trading loop
  const tradingLoop = new TradingLoop({
    symbols,
    exchanges: exchanges as ('binance' | 'okx' | 'bybit')[],
    minSpreadPercent: minSpread,
    enableDryRun: dryRun,
    enableLogging: verbose,
    checkIntervalMs: 100,
  });

  // Setup event handlers
  tradingLoop.on('started', (data) => {
    logger.info(`\n✅ Trading loop started`);
    logger.info(`   Symbols: ${data.symbols.length}`);
    logger.info(`   Exchanges: ${data.exchanges.length}\n`);
  });

  tradingLoop.on('opportunity', (opp) => {
    logger.info(`\n🎯 OPPORTUNITY DETECTED`);
    logger.info(`   ID: ${opp.id}`);
    logger.info(`   Symbol: ${opp.symbol}`);
    logger.info(`   Buy: ${opp.buyExchange} @ $${opp.buyPrice}`);
    logger.info(`   Sell: ${opp.sellExchange} @ $${opp.sellPrice}`);
    logger.info(`   Spread: ${opp.spreadPercent.toFixed(4)}%`);
    logger.info(`   Score: ${opp.score || 'N/A'}`);
    logger.info(`   Confidence: ${opp.confidence || 'N/A'}\n`);
  });

  tradingLoop.on('execution', ({ opportunity, result }) => {
    if (result.success) {
      logger.info(`\n✅ EXECUTION SUCCESS`);
      logger.info(`   Opportunity: ${opportunity.id}`);
      logger.info(`   Profit: $${result.actualProfit.toFixed(2)} (${result.actualProfitPct.toFixed(4)}%)\n`);
    } else {
      logger.info(`\n❌ EXECUTION FAILED`);
      logger.info(`   Opportunity: ${opportunity.id}`);
      logger.info(`   Error: ${result.error}\n`);
    }
  });

  tradingLoop.on('stopped', (metrics) => {
    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📊 TRADING LOOP STOPPED');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info(`   Uptime: ${metrics.uptimeMs}ms`);
    logger.info(`   Opportunities: ${metrics.opportunitiesFound}`);
    logger.info(`   Executed: ${metrics.opportunitiesExecuted}`);
    logger.info(`   Total Profit: $${metrics.totalProfit.toFixed(2)}`);
    logger.info(`   Avg Latency: ${metrics.avgLatencyMs}ms`);
    logger.info(`   P95 Latency: ${metrics.p95LatencyMs}ms`);
    logger.info(`   Errors: ${metrics.errors}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  });

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('\n\n🛑 Shutdown requested...\n');
    await tradingLoop.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start trading loop
  try {
    await tradingLoop.start();

    logger.info('🔍 Scanning markets for arbitrage opportunities...\n');
    logger.info('Press Ctrl+C to stop\n');

    // Print metrics periodically
    setInterval(() => {
      const metrics = tradingLoop.getMetrics();
      if (metrics.isRunning) {
        logger.info(`\n📈 METRICS: Opps=${metrics.opportunitiesFound} Exec=${metrics.opportunitiesExecuted} P95=${metrics.p95LatencyMs}ms Profit=$${metrics.totalProfit.toFixed(2)}\n`);
      }
    }, 60000); // Every minute

  } catch (error) {
    logger.error('\n❌ TRADING LOOP ERROR\n');
    logger.error(error instanceof Error ? error.message : String(error));
    logger.error('\nPlease check your configuration and try again.\n');
    await tradingLoop.stop();
    process.exit(1);
  }
}

async function promptConfirmation(): Promise<boolean> {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    readline.question('Confirm live trading with real money? (y/N): ', (answer: string) => {
      readline.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}
