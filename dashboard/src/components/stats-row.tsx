/**
 * Stats Row Component - 4 stat cards for dashboard
 * Displays: Total Equity, Open Positions, Today's P&L, Active Strategies
 */
import type { PerformanceMetrics } from '../types/api';

interface StatsRowProps {
  totalEquity?: number;
  openPositions?: number;
  todayPnl?: number;
  activeStrategies?: number;
  metrics?: PerformanceMetrics | null;
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const s = abs >= 1000
    ? abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : abs.toFixed(2);
  return (n < 0 ? '-' : '') + '$' + s;
}

export function StatsRow({ totalEquity, openPositions, todayPnl, activeStrategies, metrics }: StatsRowProps) {
  const pnlValue = todayPnl ?? metrics?.dailyPnl ?? 0;
  const pnlPositive = pnlValue >= 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Total Equity */}
      <div className="bg-bg-card border border-bg-border rounded-lg p-4">
        <p className="text-muted text-[10px] uppercase tracking-widest mb-1">Total Equity</p>
        <p className="text-xl font-bold text-white">
          {totalEquity ? formatUsd(totalEquity) : '—'}
        </p>
      </div>

      {/* Open Positions */}
      <div className="bg-bg-card border border-bg-border rounded-lg p-4">
        <p className="text-muted text-[10px] uppercase tracking-widest mb-1">Open Positions</p>
        <p className="text-xl font-bold text-white">
          {openPositions ?? '—'}
        </p>
      </div>

      {/* Today's P&L */}
      <div className="bg-bg-card border border-bg-border rounded-lg p-4">
        <p className="text-muted text-[10px] uppercase tracking-widest mb-1">Today's P&L</p>
        <p className={`text-xl font-bold ${pnlPositive ? 'text-profit' : 'text-loss'}`}>
          {formatUsd(pnlValue)}
        </p>
      </div>

      {/* Active Strategies */}
      <div className="bg-bg-card border border-bg-border rounded-lg p-4">
        <p className="text-muted text-[10px] uppercase tracking-widest mb-1">Active Strategies</p>
        <p className="text-xl font-bold text-accent">
          {activeStrategies ?? '—'}
        </p>
      </div>
    </div>
  );
}
