/**
 * Strategy status panel — shows 3 trading strategies with
 * live/dry-run/stopped status, signal count, and last activity.
 */
import { StrategyStatus, BotStatus } from '../stores/trading-store';

interface Props {
  strategies: StrategyStatus[];
  botStatus: BotStatus | null;
}

function formatUptime(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

const MODE_STYLES: Record<string, { dot: string; text: string; bg: string }> = {
  live:     { dot: 'bg-profit animate-pulse', text: 'text-profit', bg: 'border-profit/30 bg-profit/5' },
  'dry-run': { dot: 'bg-accent', text: 'text-accent', bg: 'border-accent/30 bg-accent/5' },
  stopped:  { dot: 'bg-muted', text: 'text-muted', bg: 'border-bg-border bg-bg-card' },
};

export function StrategyStatusPanel({ strategies, botStatus }: Props) {
  const mode = botStatus?.mode ?? 'stopped';
  const style = MODE_STYLES[mode] ?? MODE_STYLES.stopped;

  return (
    <div className="space-y-3">
      {/* Bot status header */}
      <div className={`flex items-center justify-between p-3 rounded-lg border ${style.bg}`}>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${style.dot}`} />
          <span className={`text-sm font-semibold ${style.text}`}>
            Bot: {mode.toUpperCase()}
          </span>
        </div>
        {botStatus && botStatus.running && (
          <div className="flex items-center gap-4 text-xs text-muted font-mono">
            <span>Up: {formatUptime(botStatus.uptime)}</span>
            <span>Signals: {botStatus.totalSignals}</span>
            <span>Trades: {botStatus.executedTrades}</span>
            <span className={botStatus.dailyPnl >= 0 ? 'text-profit' : 'text-loss'}>
              P&L: {botStatus.dailyPnl >= 0 ? '+' : ''}${botStatus.dailyPnl.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Strategy cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {strategies.length === 0 ? (
          <div className="col-span-3 text-center text-muted text-sm py-6">
            No strategy data — bot offline or API not connected
          </div>
        ) : (
          strategies.map((s) => {
            const sMode = s.enabled ? (botStatus?.mode ?? 'stopped') : 'stopped';
            const sStyle = MODE_STYLES[sMode] ?? MODE_STYLES.stopped;
            return (
              <div key={s.name} className={`p-3 rounded-lg border ${sStyle.bg}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white text-sm font-semibold truncate">{s.name}</span>
                  <span className={`w-2 h-2 rounded-full ${sStyle.dot}`} />
                </div>
                <div className="space-y-1 text-xs font-mono text-muted">
                  <div className="flex justify-between">
                    <span>Signals</span>
                    <span className="text-white">{s.signalCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Last</span>
                    <span className="text-white">{formatTimeAgo(s.lastSignalAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status</span>
                    <span className={sStyle.text}>{s.enabled ? 'Active' : 'Paused'}</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
