/**
 * Signals Panel Component - Live arbitrage opportunities table
 * Displays signals sorted by spread percentage
 */
import { useState, useMemo } from 'react';
import type { Signal } from '../types/api';

interface SignalsPanelProps {
  signals: Signal[];
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

type SortKey = 'spread' | 'latency' | 'timestamp' | 'symbol';
type SortDirection = 'asc' | 'desc';

export function SignalsPanel({ signals, loading, error, onRefresh }: SignalsPanelProps) {
  const [sortKey, setSortKey] = useState<SortKey>('spread');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortDirection('desc');
    }
  };

  const sortedSignals = useMemo(() => {
    return [...signals].sort((a, b) => {
      let comparison = 0;
      switch (sortKey) {
        case 'spread':
          comparison = b.spread - a.spread;
          break;
        case 'latency':
          comparison = a.latency - b.latency;
          break;
        case 'timestamp':
          comparison = b.timestamp - a.timestamp;
          break;
        case 'symbol':
          comparison = a.symbol.localeCompare(b.symbol);
          break;
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [signals, sortKey, sortDirection]);

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return '↕';
    return sortDirection === 'desc' ? '↓' : '↑';
  };

  if (loading) {
    return (
      <div className="bg-bg-card border border-bg-border rounded-lg p-8 text-center">
        <p className="text-muted text-sm">Loading signals...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-bg-card border border-bg-border rounded-lg p-8 text-center">
        <p className="text-loss text-sm mb-2">{error}</p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-accent hover:underline text-sm"
          >
            Retry
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="bg-bg-card border border-bg-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
        <h3 className="text-white text-sm font-semibold">
          Arbitrage Signals
          <span className="text-[10px] text-muted ml-2">({signals.length} opportunities)</span>
        </h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-accent hover:underline text-xs"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-bg-subtle text-muted uppercase tracking-wider">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Symbol</th>
              <th className="px-4 py-2 text-left font-medium">Buy Exchange</th>
              <th className="px-4 py-2 text-left font-medium">Sell Exchange</th>
              <th className="px-4 py-2 text-right font-medium">Buy Price</th>
              <th className="px-4 py-2 text-right font-medium">Sell Price</th>
              <th
                className="px-4 py-2 text-right font-medium cursor-pointer hover:text-white"
                onClick={() => handleSort('spread')}
              >
                {getSortIcon('spread')} Spread %
              </th>
              <th
                className="px-4 py-2 text-right font-medium cursor-pointer hover:text-white"
                onClick={() => handleSort('latency')}
              >
                {getSortIcon('latency')} Latency (ms)
              </th>
              <th className="px-4 py-2 text-right font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {sortedSignals.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  No arbitrage opportunities found
                </td>
              </tr>
            ) : (
              sortedSignals.map((signal) => (
                <tr
                  key={signal.id}
                  className="border-t border-bg-border hover:bg-bg-subtle/50"
                >
                  <td className="px-4 py-3 font-semibold text-white">
                    {signal.symbol}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {signal.buyExchange}
                  </td>
                  <td className="px-4 py-3 text-muted">
                    {signal.sellExchange}
                  </td>
                  <td className="px-4 py-3 text-right text-profit">
                    ${signal.buyPrice.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right text-loss">
                    ${signal.sellPrice.toFixed(2)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-accent">
                    {signal.spread.toFixed(3)}%
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {signal.latency}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {formatAge(signal.timestamp)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatAge(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return '<1s';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  return `${Math.floor(diff / 3600000)}h`;
}
