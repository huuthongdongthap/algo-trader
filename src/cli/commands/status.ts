// Show current bot status: positions, P&L, recent trades
// Usage: algo-trade status [--strategy <name>]

import { Command } from 'commander';
import { loadConfig } from '../../core/config.js';
import { getDatabase } from '../../data/database.js';
import type { PositionRow, TradeRow, PnlSnapshotRow } from '../../data/database.js';

interface StatusOptions {
  strategy?: string;
  limit: string;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString();
}

function padEnd(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str + ' '.repeat(len - str.length);
}

function printPositionsTable(positions: PositionRow[]): void {
  if (positions.length === 0) {
    console.log('  No open positions.\n');
    return;
  }
  console.log('  OPEN POSITIONS:');
  console.log(`  ${'Strategy'.padEnd(20)} ${'Market'.padEnd(16)} ${'Side'.padEnd(6)} ${'Size'.padEnd(12)} ${'Entry'.padEnd(12)} ${'Unreal PnL'.padEnd(12)}`);
  console.log('  ' + '-'.repeat(82));
  for (const p of positions) {
    const pnl = parseFloat(p.unrealized_pnl);
    const pnlStr = pnl >= 0 ? `+${pnl.toFixed(4)}` : pnl.toFixed(4);
    console.log(
      `  ${padEnd(p.strategy, 20)} ${padEnd(p.market, 16)} ${padEnd(p.side, 6)} ${padEnd(p.size, 12)} ${padEnd(p.entry_price, 12)} ${pnlStr}`
    );
  }
  console.log('');
}

function printTradesTable(trades: TradeRow[]): void {
  if (trades.length === 0) {
    console.log('  No recent trades.\n');
    return;
  }
  console.log('  RECENT TRADES:');
  console.log(`  ${'Strategy'.padEnd(20)} ${'Market'.padEnd(16)} ${'Side'.padEnd(6)} ${'Price'.padEnd(12)} ${'Size'.padEnd(10)} ${'Time'}`);
  console.log('  ' + '-'.repeat(86));
  for (const t of trades) {
    console.log(
      `  ${padEnd(t.strategy, 20)} ${padEnd(t.market, 16)} ${padEnd(t.side, 6)} ${padEnd(t.price, 12)} ${padEnd(t.size, 10)} ${formatTimestamp(t.timestamp)}`
    );
  }
  console.log('');
}

function printPnlSummary(snaps: PnlSnapshotRow[]): void {
  if (snaps.length === 0) return;
  const latest = snaps[0];
  if (!latest) return;
  console.log('  P&L SUMMARY (latest snapshot):');
  console.log(`  Strategy   : ${latest.strategy}`);
  console.log(`  Equity     : $${parseFloat(latest.equity).toFixed(2)}`);
  console.log(`  Daily PnL  : $${parseFloat(latest.daily_pnl).toFixed(2)}`);
  console.log(`  Cumul. PnL : $${parseFloat(latest.cumulative_pnl).toFixed(2)}`);
  console.log(`  As of      : ${formatTimestamp(latest.timestamp)}`);
  console.log('');
}

export const statusCommand = new Command('status')
  .description('Show running strategies, positions, and P&L')
  .option('-s, --strategy <name>', 'filter by strategy name')
  .option('-l, --limit <n>', 'number of recent trades to show', '10')
  .action((opts: StatusOptions) => {
    let config;
    try {
      config = loadConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`Config error: ${msg}`);
      process.exit(1);
    }

    const db = getDatabase(config.dbPath);
    const limit = parseInt(opts.limit, 10) || 10;

    console.log('\n  === algo-trade status ===\n');

    const positions = db.getOpenPositions(opts.strategy);
    printPositionsTable(positions);

    const trades = db.getTrades(opts.strategy, limit);
    printTradesTable(trades);

    if (opts.strategy) {
      const snaps = db.getPnlHistory(opts.strategy, 1);
      printPnlSummary(snaps);
    }

    db.close();
  });
