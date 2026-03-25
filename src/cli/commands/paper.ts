// Paper trading CLI command
// Usage: algo paper [--capital <amount>] [--interval <ms>] [--db <path>]
// Runs prediction loop in paper mode: scan → estimate → rank → log to SQLite

import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { logger } from '../../core/logger.js';
import { TradingPipeline } from '../../polymarket/trading-pipeline.js';
import { PredictionLoop, type RankedSignal } from '../../polymarket/prediction-loop.js';
import { MarketScanner } from '../../polymarket/market-scanner.js';
import { ClobClient } from '../../polymarket/clob-client.js';
import { getDecisionLogger } from '../../openclaw/decision-logger.js';

interface PaperOptions {
  capital?: string;
  interval?: string;
  db?: string;
}

const DASHBOARD_EVERY = 5; // print summary every N cycles

function printBanner(capital: string, intervalMs: number, dbPath: string): void {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║       PAPER TRADING LOOP             ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log(`  Mode     : PAPER (no real orders)`);
  console.log(`  Capital  : $${capital}`);
  console.log(`  Interval : ${(intervalMs / 60_000).toFixed(1)} min`);
  console.log(`  DB       : ${dbPath}`);
  console.log('');
}

function printDashboard(cycle: number, allSignals: RankedSignal[][], dbPath: string): void {
  const totalSignals = allSignals.reduce((s, arr) => s + arr.length, 0);
  const allFlat = allSignals.flat();

  const buyYes = allFlat.filter(s => s.direction === 'buy_yes').length;
  const buyNo = allFlat.filter(s => s.direction === 'buy_no').length;
  const skipped = allFlat.filter(s => s.direction === 'skip').length;

  const avgEdge = allFlat.length > 0
    ? allFlat.reduce((s, sig) => s + Math.abs(sig.edge), 0) / allFlat.length
    : 0;
  const avgConf = allFlat.length > 0
    ? allFlat.reduce((s, sig) => s + sig.confidence, 0) / allFlat.length
    : 0;

  // Simulated P&L: sum of edges * confidence as proxy (no real execution)
  const simulatedPnl = allFlat
    .filter(s => s.direction !== 'skip')
    .reduce((s, sig) => s + sig.edge * sig.confidence * 100, 0);

  const decisionLogger = getDecisionLogger(dbPath);
  const stats = decisionLogger.getStats();

  console.log('');
  console.log('  ┌─────────────────────────────────────┐');
  console.log(`  │  Dashboard (after cycle #${cycle})`.padEnd(39) + '│');
  console.log('  ├─────────────────────────────────────┤');
  console.log(`  │  Total signals : ${totalSignals}`.padEnd(39) + '│');
  console.log(`  │  Buy YES       : ${buyYes}`.padEnd(39) + '│');
  console.log(`  │  Buy NO        : ${buyNo}`.padEnd(39) + '│');
  console.log(`  │  Skipped       : ${skipped}`.padEnd(39) + '│');
  console.log(`  │  Avg |edge|    : ${(avgEdge * 100).toFixed(1)}%`.padEnd(39) + '│');
  console.log(`  │  Avg confidence: ${avgConf.toFixed(2)}`.padEnd(39) + '│');
  console.log(`  │  Sim P&L (est) : $${simulatedPnl.toFixed(2)}`.padEnd(39) + '│');
  console.log('  ├─────────────────────────────────────┤');
  console.log(`  │  DB decisions  : ${stats.total}`.padEnd(39) + '│');
  console.log(`  │  Avg latency   : ${stats.avgLatencyMs.toFixed(0)}ms`.padEnd(39) + '│');
  console.log('  └─────────────────────────────────────┘');
  console.log('');
}

export const paperCommand = new Command('paper')
  .description('Run paper trading loop')
  .option('-c, --capital <amount>', 'initial capital in USD (default: 1000)', '1000')
  .option('-i, --interval <ms>', 'cycle interval in milliseconds (default: 900000 = 15min)', '900000')
  .option('--db <path>', 'SQLite database path', 'data/algo-trade.db')
  .action(async (opts: PaperOptions) => {
    // Load config
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Config error: ${msg}`);
      process.exit(1);
    }

    logger.setLevel(config.logLevel);

    const capital = opts.capital ?? '1000';
    const intervalMs = parseInt(opts.interval ?? '900000', 10);
    const dbPath = opts.db ?? 'data/algo-trade.db';

    printBanner(capital, intervalMs, dbPath);

    // Initialize pipeline in paper mode
    const pipeline = new TradingPipeline({
      paperTrading: true,
      capitalUsdc: capital,
      dbPath,
    });

    // Initialize prediction loop separately for direct control
    // Use a deterministic dummy key for paper mode (never signs real transactions)
    const paperKey = '0x0000000000000000000000000000000000000000000000000000000000000001';
    const clobClient = new ClobClient(paperKey, config.polymarket?.chainId ?? 137);
    const scanner = new MarketScanner(clobClient);
    const predictionLoop = new PredictionLoop(scanner, undefined, {
      dbPath,
      intervalMs,
    });

    let cycleCount = 0;
    const signalHistory: RankedSignal[][] = [];
    let stopLoop: (() => void) | null = null;
    let shuttingDown = false;

    // SIGINT handler — graceful shutdown
    const handleShutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;

      console.log('\n  Shutting down paper trading...');

      if (stopLoop) stopLoop();

      // Final dashboard
      if (cycleCount > 0) {
        console.log('\n  ── Final Summary ──');
        printDashboard(cycleCount, signalHistory, dbPath);
      }

      const decisionLogger = getDecisionLogger(dbPath);
      decisionLogger.close();

      pipeline.stop().then(() => {
        console.log('  Paper trading stopped. State saved to DB.');
        process.exit(0);
      }).catch(() => {
        process.exit(1);
      });
    };

    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);

    // Start the prediction loop
    logger.info('Starting paper trading prediction loop', 'cli:paper');

    stopLoop = predictionLoop.start((signals) => {
      cycleCount++;
      signalHistory.push(signals);

      // Log cycle summary
      logger.info(`Cycle #${cycleCount}: ${signals.length} signals`, 'cli:paper');

      if (signals.length > 0) {
        const top = signals[0];
        console.log(`  Cycle #${cycleCount}: ${signals.length} signals | top: ${top.description?.slice(0, 50)} (edge: ${(top.edge * 100).toFixed(1)}%)`);
      } else {
        console.log(`  Cycle #${cycleCount}: no actionable signals`);
      }

      // Dashboard every N cycles
      if (cycleCount % DASHBOARD_EVERY === 0) {
        printDashboard(cycleCount, signalHistory, dbPath);
      }
    });
  });
