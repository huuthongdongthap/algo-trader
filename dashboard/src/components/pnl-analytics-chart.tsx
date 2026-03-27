/**
 * P&L Analytics Chart Component - Recharts-based performance visualization
 * Supports day/week/month time range tabs
 */
import { useState } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Bar,
  ComposedChart,
} from 'recharts';
import type { PerformanceMetrics, TimeRange } from '../types/api';

interface PnLAnalyticsChartProps {
  metrics: PerformanceMetrics | null;
  loading?: boolean;
  error?: string | null;
}

interface ChartData {
  name: string;
  pnl: number;
  trades: number;
  cumulative: number;
}

// Mock data generator for demonstration (replace with real API data)
function generateMockData(range: TimeRange): ChartData[] {
  const days = range === 'day' ? 24 : range === 'week' ? 7 : 30;
  const data: ChartData[] = [];
  let cumulative = 0;

  for (let i = 0; i < days; i++) {
    const pnl = (Math.random() - 0.45) * 500; // Slight positive bias
    cumulative += pnl;
    data.push({
      name: range === 'day'
        ? `${i}:00`
        : `Day ${i + 1}`,
      pnl: parseFloat(pnl.toFixed(2)),
      trades: Math.floor(Math.random() * 10),
      cumulative: parseFloat(cumulative.toFixed(2)),
    });
  }

  return data;
}

export function PnLAnalyticsChart({ metrics, loading, error }: PnLAnalyticsChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('week');
  const data = generateMockData(timeRange);

  if (loading) {
    return (
      <div className="bg-bg-card border border-bg-border rounded-lg p-8 text-center">
        <p className="text-muted text-sm">Loading analytics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-bg-card border border-bg-border rounded-lg p-8 text-center">
        <p className="text-loss text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4">
      {/* Header with Time Range Tabs */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-white text-sm font-semibold">P&L Analytics</h3>
          {metrics && (
            <p className="text-[10px] text-muted mt-0.5">
              Win Rate: {(metrics.winRate * 100).toFixed(1)}% | Sharpe: {metrics.sharpeRatio.toFixed(2)}
            </p>
          )}
        </div>
        <div className="flex gap-1">
          {(['day', 'week', 'month'] as TimeRange[]).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`
                px-3 py-1 text-xs rounded transition-colors
                ${timeRange === range
                  ? 'bg-accent text-white'
                  : 'text-muted hover:text-white hover:bg-bg-subtle'
                }
              `}
            >
              {range.charAt(0).toUpperCase() + range.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Metrics Summary Cards */}
      {metrics && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
          <MetricCard label="Total P&L" value={formatUsd(metrics.totalPnl)} />
          <MetricCard label="Daily P&L" value={formatUsd(metrics.dailyPnl)} />
          <MetricCard label="Weekly P&L" value={formatUsd(metrics.weeklyPnl)} />
          <MetricCard label="Win Rate" value={`${(metrics.winRate * 100).toFixed(1)}%`} />
          <MetricCard label="Avg Trade" value={formatUsd(metrics.avgTrade)} />
        </div>
      )}

      {/* Chart */}
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="name"
              stroke="#9CA3AF"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#9CA3AF"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `$${value}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1F2937',
                border: '1px solid #374151',
                borderRadius: '0.5rem',
              }}
              labelStyle={{ color: '#F9FAFB' }}
              formatter={(value) => [`$${Number(value).toFixed(2)}`, '']}
            />
            <Bar dataKey="trades" fill="#F59E0B" opacity={0.3} yAxisId={1} />
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="#10B981"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="pnl"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted">
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-emerald-500" />
          <span>Cumulative P&L</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-0.5 bg-blue-500" />
          <span>Daily P&L</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-amber-500/30" />
          <span>Trade Count</span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-subtle rounded p-2 text-center">
      <p className="text-[9px] text-muted uppercase tracking-wider">{label}</p>
      <p className="text-sm font-semibold text-white mt-0.5">{value}</p>
    </div>
  );
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  return `${sign}$${abs.toFixed(2)}`;
}
