// Terminal dashboard - text-based status display for algo-trade platform
// Shows equity, drawdown, active strategies, recent trades
// Refresh on demand (call renderDashboard() or use --watch flag via CLI)

import { getDatabase } from '../data/database.js';
import type { PositionRow, TradeRow, PnlSnapshotRow } from '../data/database.js';
import type { AppConfig } from '../core/types.js';

// ANSI color helpers - keep simple, no external deps
const GREEN = (s: string) => `\x1b[32m${s}\x1b[0m`;
const RED   = (s: string) => `\x1b[31m${s}\x1b[0m`;
const CYAN  = (s: string) => `\x1b[36m${s}\x1b[0m`;
const BOLD  = (s: string) => `\x1b[1m${s}\x1b[0m`;
const DIM   = (s: string) => `\x1b[2m${s}\x1b[0m`;

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function colorPnl(pnlStr: string): string {
  const v = parseFloat(pnlStr);
  const formatted = v >= 0 ? `+${v.toFixed(4)}` : v.toFixed(4);
  return v >= 0 ? GREEN(formatted) : RED(formatted);
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

export interface DashboardData {
  positions: PositionRow[];
  recentTrades: TradeRow[];
  pnlSnapshots: PnlSnapshotRow[];
}

/** Load fresh data from SQLite for dashboard render */
export function loadDashboardData(config: AppConfig, strategy?: string): DashboardData {
  const db = getDatabase(config.dbPath);
  const data: DashboardData = {
    positions:    db.getOpenPositions(strategy),
    recentTrades: db.getTrades(strategy, 8),
    pnlSnapshots: strategy ? db.getPnlHistory(strategy, 5) : [],
  };
  db.close();
  return data;
}

function renderHeader(): void {
  const now = new Date().toLocaleString();
  console.log('');
  console.log(BOLD(CYAN('  ╔══════════════════════════════════════════════════╗')));
  console.log(BOLD(CYAN('  ║          ALGO-TRADE  DASHBOARD                   ║')));
  console.log(BOLD(CYAN(`  ║  ${DIM(now.padEnd(47))}║`)));
  console.log(BOLD(CYAN('  ╚══════════════════════════════════════════════════╝')));
  console.log('');
}

function renderEquitySummary(snaps: PnlSnapshotRow[]): void {
  console.log(BOLD('  EQUITY SUMMARY'));
  console.log('  ' + '─'.repeat(54));

  if (snaps.length === 0) {
    console.log(DIM('  No P&L snapshots recorded yet.\n'));
    return;
  }

  // Aggregate across strategies
  let totalEquity = 0;
  let totalCumPnl = 0;
  let totalDailyPnl = 0;
  const seen = new Set<string>();

  for (const s of snaps) {
    if (!seen.has(s.strategy)) {
      seen.add(s.strategy);
      totalEquity   += parseFloat(s.equity);
      totalCumPnl   += parseFloat(s.cumulative_pnl);
      totalDailyPnl += parseFloat(s.daily_pnl);
    }
  }

  const drawdown = totalCumPnl < 0
    ? `${((totalCumPnl / (totalEquity - totalCumPnl)) * 100).toFixed(2)}%`
    : '0.00%';

  console.log(`  Total Equity  : ${BOLD('$' + totalEquity.toFixed(2))}`);
  console.log(`  Daily PnL     : ${colorPnl(totalDailyPnl.toFixed(4))}`);
  console.log(`  Cumulative    : ${colorPnl(totalCumPnl.toFixed(4))}`);
  console.log(`  Est. Drawdown : ${parseFloat(drawdown) < 0 ? RED(drawdown) : DIM(drawdown)}`);
  console.log('');
}

function renderPositions(positions: PositionRow[]): void {
  console.log(BOLD('  OPEN POSITIONS'));
  console.log('  ' + '─'.repeat(72));

  if (positions.length === 0) {
    console.log(DIM('  No open positions.\n'));
    return;
  }

  console.log(DIM(`  ${pad('Strategy', 18)} ${pad('Market', 14)} ${pad('Side', 6)} ${pad('Size', 10)} ${pad('Entry', 10)} PnL`));
  for (const p of positions) {
    const side = p.side === 'long' ? GREEN(pad(p.side, 6)) : RED(pad(p.side, 6));
    console.log(
      `  ${pad(p.strategy, 18)} ${pad(p.market, 14)} ${side} ${pad(p.size, 10)} ${pad(p.entry_price, 10)} ${colorPnl(p.unrealized_pnl)}`
    );
  }
  console.log('');
}

function renderRecentTrades(trades: TradeRow[]): void {
  console.log(BOLD('  RECENT TRADES'));
  console.log('  ' + '─'.repeat(72));

  if (trades.length === 0) {
    console.log(DIM('  No recent trades.\n'));
    return;
  }

  console.log(DIM(`  ${pad('Strategy', 18)} ${pad('Market', 14)} ${pad('Side', 5)} ${pad('Price', 10)} ${pad('Size', 8)} Time`));
  for (const t of trades) {
    const side = t.side === 'buy' ? GREEN(pad(t.side, 5)) : RED(pad(t.side, 5));
    console.log(
      `  ${pad(t.strategy, 18)} ${pad(t.market, 14)} ${side} ${pad(t.price, 10)} ${pad(t.size, 8)} ${formatTs(t.timestamp)}`
    );
  }
  console.log('');
}

/** Render full dashboard to stdout - call anytime to refresh */
export function renderDashboard(data: DashboardData): void {
  renderHeader();
  renderEquitySummary(data.pnlSnapshots);
  renderPositions(data.positions);
  renderRecentTrades(data.recentTrades);
  console.log(DIM('  Press Ctrl+C to exit.\n'));
}
