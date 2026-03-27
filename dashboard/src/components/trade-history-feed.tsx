/**
 * Trade history feed — scrollable table of recent executed trades
 * with strategy, side, price, P&L, and dry-run indicator.
 */
import { TradeRecord } from '../stores/trading-store';

interface Props {
  trades: TradeRecord[];
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function TradeHistoryFeed({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="text-center text-muted text-sm py-8 font-mono">
        No trades yet — waiting for bot signals
      </div>
    );
  }

  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-xs font-mono">
        <thead className="sticky top-0 bg-bg-card">
          <tr className="text-muted text-[10px] uppercase tracking-widest border-b border-bg-border">
            <th className="text-left py-2 px-3">Time</th>
            <th className="text-left py-2 px-3">Strategy</th>
            <th className="text-left py-2 px-3">Side</th>
            <th className="text-left py-2 px-3">Symbol</th>
            <th className="text-right py-2 px-3">Price</th>
            <th className="text-right py-2 px-3">Size</th>
            <th className="text-right py-2 px-3">P&L</th>
            <th className="text-center py-2 px-3">Mode</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t) => (
            <tr key={t.id} className="border-b border-bg-border/50 hover:bg-bg-border/20 transition-colors">
              <td className="py-2 px-3 text-muted whitespace-nowrap">
                <span className="text-white">{formatTime(t.timestamp)}</span>
                <span className="ml-1 text-muted/60">{formatDate(t.timestamp)}</span>
              </td>
              <td className="py-2 px-3 text-white truncate max-w-[120px]">{t.strategy}</td>
              <td className="py-2 px-3">
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                  t.side === 'BUY'
                    ? 'bg-profit/20 text-profit'
                    : 'bg-loss/20 text-loss'
                }`}>
                  {t.side}
                </span>
              </td>
              <td className="py-2 px-3 text-white truncate max-w-[100px]">{t.symbol}</td>
              <td className="py-2 px-3 text-right text-white">${t.price.toFixed(4)}</td>
              <td className="py-2 px-3 text-right text-white">{t.size}</td>
              <td className={`py-2 px-3 text-right font-semibold ${
                t.pnl >= 0 ? 'text-profit' : 'text-loss'
              }`}>
                {t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}
              </td>
              <td className="py-2 px-3 text-center">
                {t.dryRun ? (
                  <span className="text-accent text-[10px]">DRY</span>
                ) : (
                  <span className="text-profit text-[10px]">LIVE</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
