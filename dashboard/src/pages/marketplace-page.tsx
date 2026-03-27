/**
 * Strategies page: MM strategy catalogue.
 * Active: Market Making. Coming soon: Listing Arb, Cross-Platform Arb.
 */
import { Link } from 'react-router-dom';

interface Strategy {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'coming-soon';
  tag: string;
  stats?: { label: string; value: string }[];
}

const STRATEGIES: Strategy[] = [
  {
    id: 'mm',
    name: 'Market Making',
    description:
      'Posts bid/ask orders around the fair-value mid-price on Polymarket prediction markets. Earns the spread on every matched fill. Safety limits cap daily loss and inventory exposure.',
    status: 'active',
    tag: 'Live',
    stats: [
      { label: 'Avg spread earned', value: '0.08–0.12' },
      { label: 'Requote latency', value: '< 2s' },
      { label: 'Safety heartbeat', value: '5s' },
    ],
  },
  {
    id: 'listing-arb',
    name: 'Listing Arbitrage',
    description:
      'Detects newly listed Polymarket markets before liquidity concentrates. Places early orders at favourable prices before the crowd narrows the spread.',
    status: 'coming-soon',
    tag: 'Soon',
  },
  {
    id: 'cross-platform-arb',
    name: 'Cross-Platform Arbitrage',
    description:
      'Identifies price discrepancies for the same event across Polymarket and other prediction market venues. Buys low on one side, hedges on the other.',
    status: 'coming-soon',
    tag: 'Soon',
  },
];

function StatusBadge({ status }: { status: Strategy['status'] }) {
  if (status === 'active') {
    return (
      <span className="flex items-center gap-1.5 text-xs font-mono text-profit border border-profit/30 bg-profit/10 px-2 py-0.5 rounded">
        <span className="w-1.5 h-1.5 rounded-full bg-profit animate-pulse" />
        Live
      </span>
    );
  }
  return (
    <span className="text-xs font-mono text-muted border border-bg-border bg-bg-border/30 px-2 py-0.5 rounded">
      Coming Soon
    </span>
  );
}

export function MarketplacePage() {
  return (
    <div className="space-y-6 font-mono">
      <div>
        <h1 className="text-white text-2xl font-bold tracking-tight">Strategies</h1>
        <p className="text-muted text-xs mt-1">Automated market making and arbitrage strategies for Polymarket.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {STRATEGIES.map((s) => (
          <div
            key={s.id}
            className={`bg-bg-card border rounded-lg p-5 flex flex-col gap-4 transition-colors ${
              s.status === 'active'
                ? 'border-accent/30 hover:border-accent/60'
                : 'border-bg-border opacity-60'
            }`}
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-white font-semibold text-sm leading-snug">{s.name}</h2>
              <StatusBadge status={s.status} />
            </div>

            {/* Description */}
            <p className="text-muted text-xs leading-relaxed flex-1">{s.description}</p>

            {/* Stats (active only) */}
            {s.stats && (
              <div className="grid grid-cols-1 gap-1.5 border-t border-bg-border pt-3">
                {s.stats.map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between text-xs">
                    <span className="text-muted">{label}</span>
                    <span className="text-accent font-mono">{value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            {s.status === 'active' ? (
              <Link
                to="/app/settings"
                className="text-center text-xs font-bold bg-accent text-bg py-2 rounded hover:bg-accent/80 transition-colors"
              >
                Configure
              </Link>
            ) : (
              <span className="text-center text-xs font-bold border border-bg-border text-muted py-2 rounded cursor-not-allowed">
                Not available yet
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default MarketplacePage;
