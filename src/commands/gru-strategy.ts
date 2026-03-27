/**
 * GRU Strategy CLI Command
 *
 * Run GRU neural network trading strategy live or in backtest mode.
 */

import { GruStrategy } from '../strategies/GruStrategy';
import { logger } from '../utils/logger';
import { DataPreprocessor, OhlcvData } from '../ml/gru/data-preprocessor';

export interface GruCommandOptions {
  inputSteps: number;
  gruUnits: number;
  epochs: number;
  confidenceThreshold: number;
  symbol: string;
  interval: string;
  mode: 'live' | 'backtest';
}

export async function runGruStrategy(options: Partial<GruCommandOptions> = {}): Promise<void> {
  const config: GruCommandOptions = {
    inputSteps: options.inputSteps || 60,
    gruUnits: options.gruUnits || 64,
    epochs: options.epochs || 50,
    confidenceThreshold: options.confidenceThreshold || 0.7,
    symbol: options.symbol || 'BTC/USDT',
    interval: options.interval || '1h',
    mode: options.mode || 'backtest',
  };

  logger.info('='.repeat(60));
  logger.info('  GRU Neural Network Trading Strategy');
  logger.info('='.repeat(60));
  logger.info(`Symbol: ${config.symbol}`);
  logger.info(`Interval: ${config.interval}`);
  logger.info(`Mode: ${config.mode.toUpperCase()}`);
  logger.info(`Input Steps: ${config.inputSteps}`);
  logger.info(`GRU Units: ${config.gruUnits}`);
  logger.info(`Epochs: ${config.epochs}`);
  logger.info(`Confidence Threshold: ${(config.confidenceThreshold * 100).toFixed(0)}%`);
  logger.info('='.repeat(60));

  try {
    // Initialize strategy
    const strategy = new GruStrategy({
      inputSteps: config.inputSteps,
      gruUnits: config.gruUnits,
      epochs: config.epochs,
      confidenceThreshold: config.confidenceThreshold,
    });

    logger.info('\n[1/3] Initializing GRU model...');
    await strategy.initialize();

    // Generate mock historical data for demo
    logger.info('\n[2/3] Loading historical data...');
    const historicalData = generateMockData(config.inputSteps + 20);
    logger.info(`Loaded ${historicalData.length} candles`);

    // Train model
    logger.info('\n[3/3] Training GRU model...');
    await strategy.train(historicalData);

    logger.info('\n' + '='.repeat(60));
    logger.info('  Training Complete - Ready for Trading');
    logger.info('='.repeat(60));

    // Run live or backtest
    if (config.mode === 'live') {
      logger.info('\n🔴 LIVE TRADING MODE - Simulated');
      logger.info('Watching for new candles...\n');

      // Simulate a few trading cycles
      for (let i = 0; i < 5; i++) {
        const newCandle = generateMockCandle(historicalData[historicalData.length - 1]);
        const signal = await strategy.execute([newCandle]);

        logger.info(`\n[${new Date().toISOString()}] ${config.symbol}`);
        logger.info(`  Price: $${newCandle.close.toFixed(2)}`);
        logger.info(`  Signal: ${signal.action.toUpperCase()}`);
        logger.info(`  Confidence: ${(signal.confidence * 100).toFixed(1)}%`);
        logger.info(`  Reason: ${signal.reason}`);

        await sleep(1000);
      }
    } else {
      logger.info('\n📊 BACKTEST MODE');
      logger.info('Running on historical data...\n');

      let wins = 0;
      let losses = 0;

      for (let i = 20; i < historicalData.length; i++) {
        const inputCandles = historicalData.slice(i - config.inputSteps, i);
        const nextCandle = historicalData[i];

        const signal = await strategy.execute(inputCandles);

        if (signal.action !== 'wait') {
          const predictedUp = signal.action === 'buy';
          const actualUp = nextCandle.close > inputCandles[inputCandles.length - 1].close;

          if (predictedUp === actualUp) {
            wins++;
            logger.info(`✓ Candle ${i}: ${signal.action.toUpperCase()} - Correct!`);
          } else {
            losses++;
            logger.info(`✗ Candle ${i}: ${signal.action.toUpperCase()} - Wrong`);
          }
        }
      }

      logger.info('\n' + '='.repeat(60));
      logger.info('  Backtest Results');
      logger.info('='.repeat(60));
      logger.info(`Wins: ${wins}`);
      logger.info(`Losses: ${losses}`);
      logger.info(`Win Rate: ${((wins / (wins + losses)) * 100).toFixed(1)}%`);
    }

    // Cleanup
    strategy.dispose?.();

    logger.info('\n✅ GRU Strategy session complete.\n');
  } catch (error) {
    logger.error('\n❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Helper functions
function generateMockData(count: number): OhlcvData[] {
  const data: OhlcvData[] = [];
  let price = 50000; // Starting BTC price

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48) * 1000; // Slight upward bias
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * 200;
    const low = Math.min(open, close) - Math.random() * 200;
    const volume = Math.random() * 10000 + 5000;

    data.push({
      timestamp: Date.now() - (count - i) * 3600000,
      open,
      high,
      low,
      close,
      volume,
    });

    price = close;
  }

  return data;
}

function generateMockCandle(prev: OhlcvData): OhlcvData {
  const change = (Math.random() - 0.48) * 500;
  const open = prev.close;
  const close = open + change;

  return {
    timestamp: Date.now(),
    open,
    high: Math.max(open, close) + Math.random() * 100,
    low: Math.min(open, close) - Math.random() * 100,
    close,
    volume: Math.random() * 10000 + 5000,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
