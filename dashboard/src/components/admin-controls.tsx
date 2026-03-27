/**
 * Admin Controls Component - Halt/Resume trading with circuit breaker status
 */
import { useState } from 'react';
import type { AdminStatus } from '../types/api';

interface AdminControlsProps {
  status: AdminStatus | null;
  halt: (reason: string) => Promise<boolean>;
  resume: () => Promise<boolean>;
  loading?: boolean;
  error?: string | null;
  onRefresh?: () => void;
}

export function AdminControls({ status, halt, resume, loading, error, onRefresh }: AdminControlsProps) {
  const [showHaltModal, setShowHaltModal] = useState(false);
  const [haltReason, setHaltReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const isTrading = status?.trading ?? false;
  const circuitState = status?.circuitBreaker.state ?? 'CLOSED';

  const handleHalt = async () => {
    if (!haltReason.trim()) return;

    setActionLoading(true);
    const success = await halt(haltReason);
    setActionLoading(false);

    if (success) {
      setShowHaltModal(false);
      setHaltReason('');
    }
  };

  const handleResume = async () => {
    setActionLoading(true);
    await resume();
    setActionLoading(false);
  };

  const getCircuitColor = () => {
    switch (circuitState) {
      case 'CLOSED':
        return 'text-profit';
      case 'OPEN':
        return 'text-loss';
      case 'HALF_OPEN':
        return 'text-warning';
      default:
        return 'text-muted';
    }
  };

  const getCircuitLabel = () => {
    switch (circuitState) {
      case 'CLOSED':
        return 'Normal';
      case 'OPEN':
        return 'TRIPPED';
      case 'HALF_OPEN':
        return 'Testing';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-white text-sm font-semibold">Admin Controls</h3>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-accent hover:underline text-xs"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Status Display */}
      <div className="space-y-3 mb-4">
        {/* Trading Status */}
        <div className="flex items-center justify-between">
          <span className="text-muted text-xs">Trading Status</span>
          <div className={`
            flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold
            ${isTrading
              ? 'bg-profit/10 text-profit border border-profit/40'
              : 'bg-loss/10 text-loss border border-loss/40'
            }
          `}>
            <span className={`w-2 h-2 rounded-full ${isTrading ? 'bg-profit animate-pulse' : 'bg-loss'}`} />
            {isTrading ? 'Trading Active' : 'Trading Halted'}
          </div>
        </div>

        {/* Circuit Breaker */}
        <div className="flex items-center justify-between">
          <span className="text-muted text-xs">Circuit Breaker</span>
          <span className={`text-xs font-semibold ${getCircuitColor()}`}>
            {getCircuitLabel()}
          </span>
        </div>

        {/* Drawdown Monitor */}
        {status?.drawdown && (
          <div className="flex items-center justify-between">
            <span className="text-muted text-xs">Drawdown Monitor</span>
            <span className={`text-xs font-semibold ${
              status.drawdown.isHalted ? 'text-loss' : 'text-profit'
            }`}>
              {status.drawdown.isHalted ? 'HALTED' : 'Active'}
            </span>
          </div>
        )}

        {/* Drawdown Values */}
        {status?.drawdown && (
          <div className="bg-bg-subtle rounded p-3 text-xs">
            <div className="flex justify-between mb-1">
              <span className="text-muted">Current Drawdown</span>
              <span className="text-white font-mono">
                {(status.drawdown.currentDrawdown * 100).toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Max Drawdown</span>
              <span className="text-white font-mono">
                {(status.drawdown.maxDrawdown * 100).toFixed(2)}%
              </span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-loss/10 border border-loss/40 rounded p-3">
            <p className="text-loss text-xs">{error}</p>
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        {isTrading ? (
          <button
            onClick={() => setShowHaltModal(true)}
            disabled={loading || actionLoading}
            className="flex-1 px-4 py-2 bg-loss/20 border border-loss/40 text-loss rounded text-xs font-semibold
                       hover:bg-loss/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading || actionLoading ? 'Halting...' : 'Halt Trading'}
          </button>
        ) : (
          <button
            onClick={handleResume}
            disabled={loading || actionLoading}
            className="flex-1 px-4 py-2 bg-profit/20 border border-profit/40 text-profit rounded text-xs font-semibold
                       hover:bg-profit/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading || actionLoading ? 'Resuming...' : 'Resume Trading'}
          </button>
        )}
      </div>

      {/* Halt Modal */}
      {showHaltModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-bg-card border border-bg-border rounded-lg p-6 max-w-md w-full mx-4">
            <h4 className="text-white text-sm font-semibold mb-4">Halt Trading</h4>
            <p className="text-muted text-xs mb-4">
              This will immediately stop all trading activity. Provide a reason for the halt.
            </p>
            <textarea
              value={haltReason}
              onChange={(e) => setHaltReason(e.target.value)}
              placeholder="Enter reason for halting trading..."
              className="w-full bg-bg-subtle border border-bg-border rounded p-3 text-white text-sm
                         focus:outline-none focus:border-accent resize-none"
              rows={4}
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setShowHaltModal(false);
                  setHaltReason('');
                }}
                disabled={actionLoading}
                className="flex-1 px-4 py-2 bg-bg-subtle text-muted rounded text-xs font-semibold
                           hover:bg-bg-border disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleHalt}
                disabled={!haltReason.trim() || actionLoading}
                className="flex-1 px-4 py-2 bg-loss text-white rounded text-xs font-semibold
                           hover:bg-loss/80 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {actionLoading ? 'Halting...' : 'Confirm Halt'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
